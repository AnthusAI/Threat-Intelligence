from __future__ import annotations

import time
import json
import re
from urllib.parse import quote
from dataclasses import dataclass
from typing import Any

from .services import KnowledgeQueryServices, NoopSemanticSearchProvider, normalize_anchor
from .ranking import (
    QUALITY_RELATION_KEYS,
    allocate_token_budgets,
    normalize_ranking_config,
    quality_signal_from_relations,
    ranking_sort_key,
    record_key,
    score_record,
)


VALID_OUTPUT_FORMATS = {"structured", "markdown", "both"}
VALID_PROFILES = {"researcher", "reporter", "editor", "reviewer", "chat"}

PROFILE_DEFAULTS = {
    "researcher": {"depth": 2, "topK": 18, "insightBias": 1.25},
    "reporter": {"depth": 1, "topK": 12, "insightBias": 1.0},
    "editor": {"depth": 2, "topK": 20, "insightBias": 1.15},
    "reviewer": {"depth": 2, "topK": 20, "insightBias": 1.35},
    "chat": {"depth": 1, "topK": 10, "insightBias": 1.0},
}

EVIDENCE_RELATION_KEYS = {"uses_evidence", "uses_signal", "supports", "contradicts", "derived_from"}
TOPIC_RELATION_KEYS = {"classified_as", "authoritative_label", "mentions", "broader_than", "narrower_than", "digital_object_identifier_is"}
OPERATIONAL_RELATION_DOMAINS = {"commentary", "workflow", "publication"}
OPERATIONAL_RELATION_KEYS = {"comment", "ingestion_rationale", "requests_work_on", "produces", "blocked_by", "planned_for_edition", "targets_lane", "targets_section"}
SUMMARY_RELATION_RE = re.compile(r"^reference_summary_(\d+)_tokens$")
PASSAGE_HEADING_BOOSTS = {
    "abstract": 8,
    "introduction": 4,
    "evaluation": 5,
    "results": 5,
    "findings": 5,
    "discussion": 3,
    "conclusion": 3,
}
PASSAGE_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into", "is", "it", "of", "on",
    "or", "our", "that", "the", "their", "this", "to", "we", "what", "with",
}


def _default_see_also_max_tokens(max_tokens: int | None) -> int:
    if not max_tokens:
        return 300
    return min(300, max(0, int(max_tokens * 0.12)))


@dataclass(frozen=True)
class ContextBlock:
    block_id: str
    section: str
    title: str
    text: str
    priority: float
    required: bool = False
    provenance: dict[str, Any] | None = None

    def as_dict(self, token_count: int | None = None) -> dict[str, Any]:
        payload = {
            "id": self.block_id,
            "section": self.section,
            "title": self.title,
            "text": self.text,
            "priority": self.priority,
            "required": self.required,
            "provenance": self.provenance or {},
        }
        if token_count is not None:
            payload["tokens"] = token_count
        return payload


def run_knowledge_query(input: dict[str, Any], services: KnowledgeQueryServices | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    services = services or KnowledgeQueryServices()
    request, warnings = _normalize_request(input)
    services.token_counter = services.token_counter.with_model(request["tokenizerModel"])
    tokenizer_metadata = services.token_counter.metadata()
    if tokenizer_metadata.get("provider") == "regex" and services.token_counter.use_tiktoken:
        warnings.append("Tiktoken tokenizer unavailable; using regex token budget fallback")
    semantic_provider = services.semantic or NoopSemanticSearchProvider()
    graph_provider = services.graph
    structured = {
        "request": {
            "anchors": request["anchors"],
            "semanticQuery": request["semanticQuery"],
            "semanticQuerySource": request["semanticQuerySource"],
            "scope": request["scope"],
            "profile": request["profile"],
            "ranking": request["ranking"],
            "relationPolicy": request["relationPolicy"],
            "includeExtracts": request["includeExtracts"],
        },
        "anchors": [],
        "semanticMatches": [],
        "semanticPassages": [],
        "expandedObjects": [],
        "relations": [],
        "operationalRelations": [],
        "referenceAttachments": [],
        "qualityRelations": [],
        "referenceSummaries": [],
        "rankingWarnings": [],
        "referenceTokenBudgets": {},
        "evidencePassages": [],
        "relatedRecords": [],
        "contextBlocks": [],
        "_sourceTexts": [],
    }
    provenance = {
        "engine": "papyrus_knowledge_query",
        "profile": request["profile"],
        "graphProvider": getattr(graph_provider, "name", "none"),
        "semanticProvider": getattr(semantic_provider, "name", "none"),
        "corpusTextProvider": getattr(services.corpus_text, "name", "none"),
    }

    for index, anchor in enumerate(request["anchors"]):
        resolved = normalize_anchor(anchor)
        if graph_provider:
            try:
                resolved = graph_provider.resolve_anchor(anchor) or resolved
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not resolve anchor {anchor_ref(anchor)}: {exc}")
        resolved["queryAnchorRank"] = index + 1
        _assign_object_uri(resolved)
        structured["anchors"].append(resolved)
        if graph_provider:
            try:
                expansion = graph_provider.expand_anchor(resolved, request["scope"])
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not expand anchor {anchor_ref(resolved)}: {exc}")
            else:
                structured["expandedObjects"].extend(expansion.get("objects") or [])
                structured["relations"].extend(expansion.get("relations") or [])
                structured["operationalRelations"].extend(expansion.get("excludedRelations") or [])
                warnings.extend(str(item) for item in expansion.get("warnings") or [])

    if not request["semanticQuery"] and structured["anchors"]:
        derived_query = _derive_semantic_query_from_anchors(structured["anchors"], services)
        if derived_query:
            request["semanticQuery"] = derived_query
            request["semanticQuerySource"] = "anchor_derived"
            structured["request"]["semanticQuery"] = derived_query
            structured["request"]["semanticQuerySource"] = "anchor_derived"

    if request["semanticQuery"]:
        try:
            structured["semanticMatches"] = semantic_provider.search(
                request["semanticQuery"],
                request["scope"],
                int(request["scope"]["topK"]),
            )
        except Exception as exc:
            warnings.append(f"Semantic search failed: {exc}")

    _normalize_semantic_matches(structured, request, services)
    if request["semanticQuery"] and not request["anchors"] and graph_provider:
        _expand_semantic_seed_matches(structured, request, graph_provider, warnings)

    structured["expandedObjects"] = _dedupe_by_ref(structured["expandedObjects"])
    structured["relations"] = _dedupe_by_id(structured["relations"])
    structured["operationalRelations"] = _dedupe_by_id(structured["operationalRelations"])
    _assign_object_uris(structured)
    _collect_quality_ratings(structured, request, services, warnings)
    _rank_structured_records(structured, request)
    structured["referenceTokenBudgets"] = _reference_excerpt_token_budgets(structured, request)
    _collect_reference_summaries(structured, services, warnings)
    _seed_evidence_from_reference_summaries(structured, request, services)
    _seed_evidence_from_semantic_passages(structured)
    _collect_reference_evidence(structured, request, services, warnings)
    structured["evidencePassages"] = _dedupe_passages(structured["evidencePassages"])
    _rank_structured_records(structured, request)
    structured["relatedRecords"] = _build_related_records(structured, request, services)
    blocks = _build_context_blocks(structured, request, services)
    structured["contextBlocks"] = [
        block.as_dict(services.token_counter.count(block.text))
        for block in blocks
        if block.section != "full_source_text"
    ]

    context = None
    if request["outputFormat"] in {"markdown", "both"}:
        context = _render_markdown_context(blocks, request["maxTokens"], services, request["seeAlsoMaxTokens"])

    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    public_structured = _public_structured(structured)
    source_text_mode = context.get("sourceTextMode") if isinstance(context, dict) else _source_text_mode_for_blocks(blocks)
    return {
        "structured": public_structured,
        "context": context,
        "warnings": warnings,
        "provenance": provenance,
        "debug": {
            "elapsedMs": elapsed_ms,
            "anchorCount": len(public_structured["anchors"]),
            "semanticMatchCount": len(public_structured["semanticMatches"]),
            "semanticPassageCount": len(public_structured["semanticPassages"]),
            "relatedRecordCount": len(public_structured["relatedRecords"]),
            "relationCount": len(public_structured["relations"]),
            "operationalRelationCount": len(public_structured["operationalRelations"]),
            "evidencePassageCount": len(public_structured["evidencePassages"]),
            "contextBlockCount": len(blocks),
            "maxTokens": request["maxTokens"],
            "seeAlsoMaxTokens": request["seeAlsoMaxTokens"],
            "outputFormat": request["outputFormat"],
            "semanticQuery": request["semanticQuery"],
            "semanticQuerySource": request["semanticQuerySource"],
            "rankingProfile": request["ranking"]["profile"],
            "relationPolicy": request["relationPolicy"],
            "sourceTextMode": source_text_mode,
            "rankingWarningCount": len(public_structured.get("rankingWarnings") or []),
            "tokenizerProvider": tokenizer_metadata.get("provider"),
            "tokenizerEncoding": tokenizer_metadata.get("encoding"),
            "tokenizerModel": tokenizer_metadata.get("model"),
        },
    }


def _normalize_request(input: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(input, dict):
        raise TypeError("knowledge query input must be a JSON object")
    warnings: list[str] = []
    profile = str(input.get("profile") or "researcher").strip()
    if profile not in VALID_PROFILES:
        warnings.append(f"Unknown profile '{profile}', using researcher")
        profile = "researcher"
    defaults = PROFILE_DEFAULTS[profile]
    raw_scope = input.get("scope") if isinstance(input.get("scope"), dict) else {}
    scope = dict(raw_scope)
    scope["depth"] = int(scope.get("depth") if scope.get("depth") is not None else defaults["depth"])
    scope["topK"] = int(scope.get("topK") if scope.get("topK") is not None else defaults["topK"])
    scope["depth"] = max(0, min(scope["depth"], 3))
    scope["topK"] = max(1, min(scope["topK"], 100))
    for key, default, upper in (("semanticSeedLimit", 5, 20), ("relatedRecordLimit", 8, 30)):
        try:
            scope[key] = max(0, min(int(scope.get(key, default)), upper))
        except (TypeError, ValueError):
            warnings.append(f"scope.{key} must be an integer; using {default}")
            scope[key] = default
    anchors = input.get("anchors") or []
    if isinstance(anchors, dict):
        anchors = [anchors]
    if not isinstance(anchors, list):
        warnings.append("anchors must be a list; ignoring anchors")
        anchors = []
    normalized_anchors = [normalize_anchor(anchor) for anchor in anchors if isinstance(anchor, dict)]
    output = input.get("output") if isinstance(input.get("output"), dict) else {}
    scope.setdefault("relationPolicy", "knowledge_only")
    output_format = str(output.get("format") or input.get("format") or "structured").strip()
    if output_format not in VALID_OUTPUT_FORMATS:
        warnings.append(f"Unknown output format '{output_format}', using structured")
        output_format = "structured"
    max_tokens = output.get("maxTokens", input.get("maxTokens"))
    if max_tokens is not None:
        try:
            max_tokens = max(1, int(max_tokens))
        except (TypeError, ValueError):
            warnings.append("output.maxTokens must be an integer; ignoring token budget")
            max_tokens = None
    explicit_see_also_max_tokens = output.get("seeAlsoMaxTokens", input.get("seeAlsoMaxTokens"))
    if explicit_see_also_max_tokens is not None:
        try:
            see_also_max_tokens = max(0, int(explicit_see_also_max_tokens))
        except (TypeError, ValueError):
            warnings.append("output.seeAlsoMaxTokens must be an integer; using default see also budget")
            see_also_max_tokens = _default_see_also_max_tokens(max_tokens)
    else:
        see_also_max_tokens = _default_see_also_max_tokens(max_tokens)
    semantic_query = str(input.get("semanticQuery") or "").strip()
    if not normalized_anchors and not semantic_query:
        warnings.append("No anchors or semanticQuery supplied; returned context will be empty")
    max_passages = output.get("maxPassages", input.get("maxPassages"))
    max_passage_tokens = output.get("maxPassageTokens", input.get("maxPassageTokens"))
    try:
        max_passages = max(1, min(int(max_passages), 20)) if max_passages is not None else 5
    except (TypeError, ValueError):
        warnings.append("output.maxPassages must be an integer; using 5")
        max_passages = 5
    try:
        max_passage_tokens = max(40, min(int(max_passage_tokens), 500)) if max_passage_tokens is not None else 160
    except (TypeError, ValueError):
        warnings.append("output.maxPassageTokens must be an integer; using 160")
        max_passage_tokens = 160
    include_extracts = output.get("includeExtracts", True)
    if isinstance(include_extracts, str):
        include_extracts = include_extracts.lower() not in {"0", "false", "no"}
    include_provenance_appendix = bool(output.get("includeProvenanceAppendix"))
    ranking_config = normalize_ranking_config(input, warnings)
    return {
        "anchors": normalized_anchors,
        "semanticQuery": semantic_query,
        "scope": scope,
        "profile": profile,
        "ranking": ranking_config,
        "outputFormat": output_format,
        "maxTokens": max_tokens,
        "seeAlsoMaxTokens": see_also_max_tokens,
        "includeExtracts": bool(include_extracts),
        "maxPassages": max_passages,
        "maxPassageTokens": max_passage_tokens,
        "includeProvenanceAppendix": include_provenance_appendix,
        "relationPolicy": str(scope.get("relationPolicy") or "knowledge_only"),
        "tokenizerModel": str(output.get("tokenizerModel") or scope.get("tokenizerModel") or "").strip(),
        "semanticQuerySource": "explicit" if semantic_query else "none",
    }, warnings


def _derive_semantic_query_from_anchors(anchors: list[dict[str, Any]], services: KnowledgeQueryServices) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for anchor in anchors:
        for text in _anchor_semantic_text_parts(anchor):
            normalized = " ".join(text.split())
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            parts.append(normalized)
    if not parts:
        return ""
    return services.token_counter.truncate(". ".join(parts), 96)


def _anchor_semantic_text_parts(anchor: dict[str, Any]) -> list[str]:
    parts: list[str] = []
    title = object_title(anchor)
    if title:
        parts.append(title)
    for key in ("headline", "displayName", "deck", "subtitle", "description", "summary", "categoryKey", "nodeKey"):
        value = anchor.get(key)
        if isinstance(value, str) and value.strip() and value.strip() != title:
            parts.append(value.strip())
    authors = anchor.get("authors")
    if isinstance(authors, list) and authors:
        parts.append(" ".join(str(author) for author in authors[:4] if str(author).strip()))
    return parts


def _build_context_blocks(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
) -> list[ContextBlock]:
    blocks: list[ContextBlock] = []
    semantic_query = request["semanticQuery"]
    evidence_passages = structured.get("evidencePassages") or []
    source_references = _reference_objects(structured)
    target_references = _target_reference_objects(structured)
    target_reference_keys = {_reference_key(reference) for reference in target_references}
    primary_reference = None
    if len(target_references) == 1:
        primary_reference = target_references[0]
    elif not target_references and len(source_references) == 1:
        primary_reference = source_references[0]
    primary_reference_key = _object_key(primary_reference) if primary_reference else None
    if primary_reference:
        blocks.append(
            ContextBlock(
                block_id=f"source.header.{primary_reference.get('id') or primary_reference.get('lineageId')}",
                section="source_header",
                title=object_title(primary_reference) or "Source",
                text=source_header_text(primary_reference),
                priority=150,
                required=True,
                provenance={
                    "source": "reference",
                    "kind": "reference",
                    "id": primary_reference.get("id"),
                    "lineageId": primary_reference.get("lineageId"),
                    "objectUri": primary_reference.get("objectUri"),
                    "ranking": primary_reference.get("ranking"),
                },
            )
        )
    summary_text = _knowledge_summary_text(semantic_query, evidence_passages, target_references or source_references)
    blocks.append(
        ContextBlock(
            block_id="knowledge.summary",
            section="context_summary" if primary_reference else "knowledge_summary",
            title="",
            text=summary_text,
            priority=125,
            required=True,
            provenance={"source": "knowledge_query"},
        )
    )
    full_source = _full_source_text_for_reference(structured, primary_reference) if primary_reference else None
    if full_source and _full_source_fits(blocks, full_source, request["maxTokens"], services):
        blocks.append(
            ContextBlock(
                block_id=f"full_source.{primary_reference.get('id') or primary_reference.get('lineageId')}",
                section="full_source_text",
                title="",
                text=full_source["text"],
                priority=140,
                required=True,
                provenance={
                    "source": "extracted_text",
                    "referenceId": full_source.get("referenceId"),
                    "referenceLineageId": full_source.get("referenceLineageId"),
                    "objectUri": full_source.get("objectUri"),
                    "storagePath": full_source.get("storagePath"),
                    "reason": "full_source_fits_budget",
                },
            )
        )
    else:
        for passage in evidence_passages:
            if target_reference_keys and _passage_reference_key(passage) not in target_reference_keys:
                continue
            blocks.append(
                ContextBlock(
                    block_id=f"passage.{passage['id']}",
                    section="source_excerpts",
                    title=passage.get("referenceTitle") or "Source excerpt",
                    text=passage["text"],
                    priority=115 + (float((passage.get("ranking") or {}).get("finalScore", 0.0)) * 25),
                    provenance={
                        "source": passage.get("selectionReason") or "extracted_text",
                        "referenceId": passage.get("referenceId"),
                        "referenceLineageId": passage.get("referenceLineageId"),
                        "objectUri": passage.get("objectUri"),
                        "storagePath": passage.get("storagePath"),
                        "startChar": passage.get("startChar"),
                        "endChar": passage.get("endChar"),
                        "reason": passage.get("selectionReason"),
                        "truncated": passage.get("truncated"),
                        "ranking": passage.get("ranking"),
                    },
                )
            )
    for anchor in structured["anchors"]:
        if anchor.get("kind") == "reference":
            continue
        title = object_title(anchor) or anchor_ref(anchor)
        blocks.append(
            ContextBlock(
                block_id=f"anchor.{anchor_ref(anchor)}",
                section="related_concepts_and_topics",
                title=title,
                text=_text_with_object_uri(object_summary(anchor), anchor),
                priority=80,
                required=True,
                provenance={"source": "input.anchor", "kind": anchor.get("kind"), "id": anchor.get("id")},
            )
        )
    for record in structured.get("relatedRecords") or []:
        if primary_reference_key and _object_key(record) == primary_reference_key:
            continue
        blocks.append(
            ContextBlock(
                block_id=f"related.{record.get('objectUri') or record.get('id') or record.get('rank')}",
                section="related_records",
                title=record.get("title") or record.get("objectUri") or "Related record",
                text=related_record_summary(record),
                priority=55 + (float((record.get("ranking") or {}).get("finalScore", 0.0)) * 10),
                provenance=record.get("provenance") or {},
            )
        )
    related_keys = {_object_key(record) for record in structured.get("relatedRecords") or []}
    for relation in structured["relations"]:
        relation_key = relation.get("relationTypeKey") or relation.get("predicate") or "related_to"
        if relation_key in QUALITY_RELATION_KEYS:
            continue
        if relation_key in TOPIC_RELATION_KEYS:
            continue
        section = "relevant_evidence" if relation_key in EVIDENCE_RELATION_KEYS else "related_concepts_and_topics"
        blocks.append(
            ContextBlock(
                block_id=f"relation.{relation.get('id') or relation_key}",
                section=section,
                title=knowledge_relation_title(relation),
                text=knowledge_relation_summary(relation),
                priority=140 if request["scope"].get("relationTypes") else (88 if section == "relevant_evidence" else 68),
                provenance={"source": "semantic_relation", "relationId": relation.get("id"), "relationTypeKey": relation_key},
            )
        )
    for obj in structured["expandedObjects"]:
        if _object_key(obj) in related_keys:
            continue
        if obj.get("kind") in {"reference", "message", "assignment"}:
            continue
        if not _is_related_record_candidate(obj):
            continue
        blocks.append(
            ContextBlock(
                block_id=f"object.{anchor_ref(obj)}",
                section="related_concepts_and_topics",
                title=object_title(obj) or anchor_ref(obj),
                text=_text_with_object_uri(object_summary(obj), obj),
                priority=50,
                provenance={"source": "graph_expansion", "kind": obj.get("kind"), "id": obj.get("id")},
            )
        )
    if len(target_references) > 1:
        references_to_render = target_references
        source_section = "target_records"
    elif primary_reference:
        references_to_render = []
        source_section = "sources"
    else:
        references_to_render = source_references
        source_section = "sources"
    for reference in references_to_render:
        if primary_reference_key and _object_key(reference) == primary_reference_key:
            continue
        blocks.append(
            ContextBlock(
                block_id=f"source.{reference.get('id') or reference.get('lineageId')}",
                section=source_section,
                title=object_title(reference) or "Source",
                text=source_summary(reference),
                priority=60 + (float((reference.get("ranking") or {}).get("finalScore", 0.0)) * 10),
                provenance={
                    "source": "reference",
                    "kind": "reference",
                    "id": reference.get("id"),
                    "lineageId": reference.get("lineageId"),
                    "objectUri": reference.get("objectUri"),
                    "ranking": reference.get("ranking"),
                },
            )
        )
    gap_text = _gaps_text(structured, request)
    if gap_text:
        blocks.append(
            ContextBlock(
                block_id="gaps.limits",
                section="gaps_and_limits",
                title="",
                text=gap_text,
                priority=20,
                provenance={"source": "knowledge_query"},
            )
        )
    if request["includeProvenanceAppendix"]:
        for relation in structured.get("operationalRelations") or []:
            blocks.append(
                ContextBlock(
                    block_id=f"operational.{relation.get('id') or relation.get('predicate')}",
                    section="provenance_appendix",
                    title=relation_title(relation),
                    text=relation_summary(relation),
                    priority=10,
                    provenance={"source": "operational_relation", "relationId": relation.get("id")},
                )
            )
    return _dedupe_blocks(blocks)


def _render_markdown_context(
    blocks: list[ContextBlock],
    max_tokens: int | None,
    services: KnowledgeQueryServices,
    see_also_max_tokens: int | None = None,
) -> dict[str, Any]:
    fitted = _fit_blocks(blocks, max_tokens, services)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for block in fitted["includedBlocks"]:
        grouped.setdefault(block["section"], []).append(block)
    section_order = [
        "source_header",
        "context_summary",
        "knowledge_summary",
        "relevant_evidence",
        "full_source_text",
        "target_records",
        "source_excerpts",
        "related_records",
        "related_concepts_and_topics",
        "sources",
        "gaps_and_limits",
        "provenance_appendix",
    ]
    lines: list[str] = []
    grouped_target_context = bool(grouped.get("target_records"))
    grouped_source_context = bool(grouped.get("sources") and len(grouped.get("sources") or []) > 1)
    source_context_keys = {
        _source_block_key(block)
        for block in [*(grouped.get("sources") or []), *(grouped.get("source_excerpts") or [])]
    } if grouped_source_context else set()
    for section in [*section_order, *[key for key in grouped if key not in section_order]]:
        section_blocks = grouped.get(section)
        if not section_blocks:
            continue
        if grouped_target_context and section == "target_records":
            _append_grouped_source_context_section(
                lines,
                section_blocks,
                _matching_excerpt_blocks(grouped.get("source_excerpts") or [], section_blocks),
                heading="Target Records",
            )
            continue
        if grouped_target_context and section == "source_excerpts":
            continue
        if grouped_source_context and section in {"source_excerpts", "sources"}:
            if section == "source_excerpts":
                _append_grouped_source_context_section(lines, grouped.get("sources") or [], section_blocks)
            elif not grouped.get("source_excerpts"):
                _append_grouped_source_context_section(lines, section_blocks, [])
            continue
        if grouped_source_context and section == "related_records":
            section_blocks = [block for block in section_blocks if _source_block_key(block) not in source_context_keys]
            if not section_blocks:
                continue
        if section == "source_header":
            block = section_blocks[0]
            lines.append(f"# {block['title']}")
            if block["text"]:
                lines.append(block["text"])
            lines.append("")
            continue
        if section == "source_excerpts":
            _append_source_excerpt_section(lines, section_blocks)
            continue
        if section == "related_records":
            _append_see_also_section(lines, section_blocks, see_also_max_tokens, services)
            continue
        lines.append(f"## {_section_heading(section)}")
        seen_titles: set[str] = set()
        for block in section_blocks:
            title = str(block.get("title") or "")
            if title and not (section == "source_excerpts" and title in seen_titles):
                lines.append(f"### {title}")
                seen_titles.add(title)
            lines.append(block["text"])
        lines.append("")
    text = "\n\n".join(line for line in lines if line != "").strip()
    if max_tokens and services.token_counter.count(text) > max_tokens:
        text = services.token_counter.truncate(text, max_tokens)
    return {
        "format": "markdown",
        "text": text,
        "maxTokens": max_tokens,
        "seeAlsoMaxTokens": see_also_max_tokens,
        "totalTokens": services.token_counter.count(text),
        "tokenizer": services.token_counter.metadata(),
        "sourceTextMode": _source_text_mode_for_block_dicts(fitted["includedBlocks"]),
        "includedBlocks": fitted["includedBlocks"],
        "droppedBlocks": fitted["droppedBlocks"],
    }


def _fit_blocks(blocks: list[ContextBlock], max_tokens: int | None, services: KnowledgeQueryServices) -> dict[str, Any]:
    counter = services.token_counter
    if not max_tokens:
        return {
            "includedBlocks": [block.as_dict(counter.count(block.text)) for block in blocks],
            "droppedBlocks": [],
        }
    scored = list(enumerate(blocks))
    selected_indexes: set[int] = set()
    total = 0
    for index, block in scored:
        if not block.required:
            continue
        rendered = _block_markdown(block)
        block_tokens = counter.count(rendered)
        if total + block_tokens <= max_tokens:
            selected_indexes.add(index)
            total += block_tokens
        else:
            selected_indexes.add(index)
            total = max_tokens
            break
    for index, block in sorted(scored, key=lambda item: (-item[1].priority, item[0])):
        if index in selected_indexes:
            continue
        rendered = _block_markdown(block)
        block_tokens = counter.count(rendered)
        if total + block_tokens <= max_tokens:
            selected_indexes.add(index)
            total += block_tokens
    included: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for index, block in scored:
        if index in selected_indexes:
            included.append(block.as_dict(counter.count(block.text)))
        else:
            dropped.append(block.as_dict(counter.count(block.text)))
    rendered_text = "\n\n".join(_block_markdown(blocks[index]) for index in sorted(selected_indexes))
    overflow = counter.count(rendered_text) - max_tokens
    if overflow > 0 and included:
        last = included[-1]
        last["text"] = counter.truncate(last["text"], max(1, counter.count(last["text"]) - overflow - 4))
        last["tokens"] = counter.count(last["text"])
        provenance = last.get("provenance") if isinstance(last.get("provenance"), dict) else {}
        provenance["truncated"] = True
        last["provenance"] = provenance
    return {"includedBlocks": included, "droppedBlocks": dropped}


def _block_markdown(block: ContextBlock) -> str:
    return f"### {block.title}\n{block.text}" if block.title else block.text


def _section_heading(section: str) -> str:
    return {
        "context_summary": "Context Summary",
        "knowledge_summary": "Knowledge Summary",
        "relevant_evidence": "Relevant Evidence",
        "full_source_text": "Full Source Text",
        "target_records": "Target Records",
        "related_records": "Related Records",
        "related_concepts_and_topics": "Related Concepts and Topics",
        "sources": "Sources",
        "gaps_and_limits": "Gaps and Limits",
        "provenance_appendix": "Provenance Appendix",
    }.get(section, section.replace("_", " ").title())


def _append_source_excerpt_section(lines: list[str], section_blocks: list[dict[str, Any]]) -> None:
    lines.append("## Source Excerpts")
    seen_titles: set[str] = set()
    previous_end_by_source: dict[str, int] = {}
    for block in section_blocks:
        title = str(block.get("title") or "")
        if title and title not in seen_titles:
            lines.append(f"### {title}")
            seen_titles.add(title)
        source_key = _source_block_key(block)
        lines.append(_excerpt_display_text(block, previous_end_by_source.get(source_key)))
        previous_end = _excerpt_end(block)
        if previous_end is not None:
            previous_end_by_source[source_key] = previous_end
    lines.append("")


def _append_grouped_source_context_section(
    lines: list[str],
    source_blocks: list[dict[str, Any]],
    excerpt_blocks: list[dict[str, Any]],
    heading: str = "Source Context",
) -> None:
    lines.append(f"## {heading}")
    excerpts_by_source: dict[str, list[dict[str, Any]]] = {}
    for block in excerpt_blocks:
        excerpts_by_source.setdefault(_source_block_key(block), []).append(block)
    seen_keys: set[str] = set()
    for source in source_blocks:
        key = _source_block_key(source)
        seen_keys.add(key)
        _append_one_source_context(lines, source, excerpts_by_source.get(key) or [])
    for key, excerpts in excerpts_by_source.items():
        if key in seen_keys:
            continue
        _append_one_source_context(lines, excerpts[0], excerpts)
    lines.append("")


def _matching_excerpt_blocks(
    excerpt_blocks: list[dict[str, Any]],
    source_blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    source_keys = {_source_block_key(block) for block in source_blocks}
    return [block for block in excerpt_blocks if _source_block_key(block) in source_keys]


def _append_see_also_section(
    lines: list[str],
    section_blocks: list[dict[str, Any]],
    max_tokens: int | None,
    services: KnowledgeQueryServices,
) -> None:
    if not section_blocks:
        return
    budget = 300 if max_tokens is None else max(0, int(max_tokens))
    if budget <= 0:
        return
    counter = services.token_counter
    section_lines = ["## See Also"]
    for block in section_blocks:
        title = str(block.get("title") or "Related record").strip() or "Related record"
        body = _sanitize_see_also_body(str(block.get("text") or ""))
        rendered = f"### {title}\n{body}" if body else f"### {title}"
        if counter.count("\n\n".join([*section_lines, rendered])) <= budget:
            section_lines.append(rendered)
            continue
        if body:
            truncated = body
            for remaining in range(max(1, counter.count(body) - 1), 0, -1):
                truncated = counter.truncate(body, remaining)
                rendered = f"### {title}\n{truncated}"
                if counter.count("\n\n".join([*section_lines, rendered])) <= budget:
                    section_lines.append(rendered)
                    break
        break
    if len(section_lines) > 1:
        lines.extend(section_lines)
        lines.append("")


def _sanitize_see_also_body(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("Object:", "Why related:")):
            lines.append(stripped)
            continue
        cleaned = _sanitize_excerpt_markdown(stripped)
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


def _append_one_source_context(
    lines: list[str],
    source_block: dict[str, Any],
    excerpt_blocks: list[dict[str, Any]],
) -> None:
    title = str(source_block.get("title") or "Source").strip() or "Source"
    lines.append(f"### {title}")
    metadata = _source_metadata_text(source_block)
    if metadata:
        lines.append(metadata)
    if excerpt_blocks:
        previous_end: int | None = None
        for excerpt in excerpt_blocks:
            lines.append(_excerpt_display_text(excerpt, previous_end))
            next_previous_end = _excerpt_end(excerpt)
            if next_previous_end is not None:
                previous_end = next_previous_end


def _source_metadata_text(source_block: dict[str, Any]) -> str:
    title = str(source_block.get("title") or "").strip()
    text = str(source_block.get("text") or "").strip()
    if not text:
        return ""
    lines = text.splitlines()
    if lines and title and lines[0].strip() == title:
        lines = lines[1:]
    return "\n".join(line for line in lines if line.strip()).strip()


def _source_block_key(block: dict[str, Any]) -> str:
    provenance = block.get("provenance") if isinstance(block.get("provenance"), dict) else {}
    for key in ("objectUri", "referenceLineageId", "lineageId", "referenceId", "id"):
        value = provenance.get(key)
        if isinstance(value, str) and value.strip():
            return f"{key}:{value.strip()}"
    title = block.get("title")
    if isinstance(title, str) and title.strip():
        return f"title:{title.strip()}"
    return f"block:{block.get('id') or id(block)}"


def _excerpt_display_text(block: dict[str, Any], previous_end: int | None = None) -> str:
    provenance = block.get("provenance") if isinstance(block.get("provenance"), dict) else {}
    text = _sanitize_excerpt_markdown(str(block.get("text") or ""))
    if not text:
        return ""
    start = _int_or_none(provenance.get("startChar"))
    end = _int_or_none(provenance.get("endChar"))
    if start is None:
        prefix = False
    elif previous_end is None:
        prefix = start > 0
    else:
        prefix = not (previous_end - 2 <= start <= previous_end + 2)
    suffix = bool(provenance.get("truncated"))
    if prefix and not text.startswith("..."):
        text = f"... {text}"
    if suffix and not text.endswith("..."):
        text = text.rstrip(" .") + " ..."
    return text


def _sanitize_excerpt_markdown(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:[-*+]\s+|[•‣◦]\s+|\d{1,3}[.)]\s+)", "", cleaned)
    cleaned = re.sub(r"\s*[•‣◦]\s*", " ", cleaned)
    return cleaned.strip()


def _excerpt_end(block: dict[str, Any]) -> int | None:
    provenance = block.get("provenance") if isinstance(block.get("provenance"), dict) else {}
    return _int_or_none(provenance.get("endChar"))


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def excerpt_provenance_label(reason: str) -> str:
    return {
        "semantic_vector": "Semantic vector match",
        "query_overlap": "Extracted-text query match",
        "first_available_passage": "Extracted-text fallback",
    }.get(reason, "")


def _full_source_text_for_reference(structured: dict[str, Any], reference: dict[str, Any] | None) -> dict[str, Any] | None:
    if not reference:
        return None
    lineage_id = str(reference.get("lineageId") or "")
    reference_id = str(reference.get("id") or "")
    for source_text in structured.get("_sourceTexts") or []:
        if (
            str(source_text.get("referenceLineageId") or "") == lineage_id
            or str(source_text.get("referenceId") or "") == reference_id
        ):
            return source_text
    return None


def _full_source_fits(
    existing_blocks: list[ContextBlock],
    source_text: dict[str, Any],
    max_tokens: int | None,
    services: KnowledgeQueryServices,
) -> bool:
    if not source_text.get("text"):
        return False
    if not max_tokens:
        return True
    counter = services.token_counter
    rendered_parts = []
    for block in existing_blocks:
        if not block.required:
            continue
        if block.section == "source_header":
            rendered_parts.append(f"# {block.title}\n\n{block.text}")
        elif block.section == "context_summary":
            rendered_parts.append(f"## Context Summary\n\n{block.text}")
        else:
            rendered_parts.append(_block_markdown(block))
    rendered_parts.append("## Full Source Text\n\n" + str(source_text["text"]))
    rendered = "\n\n".join(rendered_parts)
    return counter.count(rendered) + 32 <= max_tokens


def _source_text_mode_for_blocks(blocks: list[ContextBlock]) -> str:
    sections = {block.section for block in blocks}
    if "full_source_text" in sections:
        return "full"
    if "source_excerpts" in sections:
        return "excerpted"
    return "metadata"


def _source_text_mode_for_block_dicts(blocks: list[dict[str, Any]]) -> str:
    sections = {str(block.get("section") or "") for block in blocks}
    if "full_source_text" in sections:
        return "full"
    if "source_excerpts" in sections:
        return "excerpted"
    return "metadata"


def _public_structured(structured: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in structured.items() if not key.startswith("_")}


def _normalize_semantic_matches(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
) -> None:
    normalized_matches = []
    semantic_passages = []
    for match in structured.get("semanticMatches") or []:
        if not isinstance(match, dict):
            continue
        normalized = dict(match)
        metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
        for key, metadata_key in (
            ("kind", "kind"),
            ("id", "id"),
            ("lineageId", "lineageId"),
            ("title", "title"),
            ("summary", "summary"),
        ):
            if normalized.get(key) in {None, ""} and metadata.get(metadata_key) not in {None, ""}:
                normalized[key] = metadata.get(metadata_key)
        _assign_object_uri(normalized)
        normalized_matches.append(normalized)
        passage = _semantic_passage_from_match(normalized, request, services)
        if passage:
            semantic_passages.append(passage)
    structured["semanticMatches"] = normalized_matches
    structured["semanticPassages"] = _dedupe_passages(semantic_passages)


def _semantic_passage_from_match(
    match: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
) -> dict[str, Any] | None:
    metadata = match.get("metadata") if isinstance(match.get("metadata"), dict) else {}
    text = metadata.get("text") or match.get("text") or metadata.get("summary") or match.get("summary")
    storage_path = metadata.get("storagePath") or match.get("storagePath")
    has_chunk_coordinates = any(
        metadata.get(key) is not None or match.get(key) is not None
        for key in ("chunkIndex", "startChar", "endChar")
    )
    if not isinstance(text, str) or not text.strip() or not storage_path or not has_chunk_coordinates:
        return None
    clean = _clean_text(text)
    if len(clean) < 80:
        return None
    lexical_score = _passage_score(clean, str(metadata.get("heading") or match.get("heading") or ""), _keywords(request["semanticQuery"]))
    if lexical_score < -1:
        return None
    reference_lineage_id = (
        metadata.get("referenceLineageId")
        or match.get("referenceLineageId")
        or metadata.get("lineageId")
        or match.get("lineageId")
    )
    reference_id = (
        metadata.get("referenceId")
        or match.get("referenceId")
        or metadata.get("id")
        or match.get("id")
    )
    chunk_index = metadata.get("chunkIndex", match.get("chunkIndex", match.get("rank")))
    truncated = services.token_counter.count(clean) > int(request["maxPassageTokens"])
    passage_text = services.token_counter.truncate(clean, int(request["maxPassageTokens"]))
    score = _semantic_match_score(match) + max(0.0, lexical_score)
    return {
        "id": f"{reference_lineage_id or reference_id or 'semantic'}:semantic:{chunk_index}",
        "referenceId": reference_id,
        "referenceLineageId": reference_lineage_id,
        "referenceTitle": object_title(match),
        "objectUri": object_uri(match),
        "storagePath": storage_path,
        "rank": match.get("rank"),
        "score": round(float(score), 3),
        "semanticScore": match.get("score"),
        "distance": match.get("distance"),
        "heading": metadata.get("heading") or match.get("heading"),
        "chunkIndex": chunk_index,
        "startChar": metadata.get("startChar", match.get("startChar")),
        "endChar": metadata.get("endChar", match.get("endChar")),
        "selectionReason": "semantic_vector",
        "provider": "semantic_search",
        "text": passage_text,
        "tokens": services.token_counter.count(passage_text),
        "truncated": truncated,
    }


def _semantic_match_score(match: dict[str, Any]) -> float:
    score = match.get("score")
    if isinstance(score, (int, float)):
        return float(score) * 10 if 0 <= float(score) <= 1 else float(score)
    distance = match.get("distance")
    if isinstance(distance, (int, float)):
        return max(0.0, 25.0 - (float(distance) * 20.0))
    return 10.0


def _expand_semantic_seed_matches(
    structured: dict[str, Any],
    request: dict[str, Any],
    graph_provider: Any,
    warnings: list[str],
) -> None:
    seed_limit = int(request["scope"].get("semanticSeedLimit") or 0)
    if seed_limit <= 0:
        return
    seen: set[tuple[str, str]] = set()
    seeds = []
    for match in structured.get("semanticMatches") or []:
        key = _object_key(match)
        if not key or key in seen or not match.get("kind"):
            continue
        seen.add(key)
        seeds.append(match)
        if len(seeds) >= seed_limit:
            break
    for seed in seeds:
        try:
            resolved = graph_provider.resolve_anchor(seed) or normalize_anchor(seed)
        except Exception as exc:  # pragma: no cover - defensive runtime note
            warnings.append(f"Could not resolve semantic seed {anchor_ref(seed)}: {exc}")
            resolved = normalize_anchor(seed)
        resolved["semanticSeedRank"] = seed.get("rank")
        _assign_object_uri(resolved)
        structured["expandedObjects"].append(resolved)
        try:
            expansion = graph_provider.expand_anchor(resolved, request["scope"])
        except Exception as exc:  # pragma: no cover - defensive runtime note
            warnings.append(f"Could not expand semantic seed {anchor_ref(resolved)}: {exc}")
            continue
        structured["expandedObjects"].extend(expansion.get("objects") or [])
        structured["relations"].extend(expansion.get("relations") or [])
        structured["operationalRelations"].extend(expansion.get("excludedRelations") or [])
        warnings.extend(str(item) for item in expansion.get("warnings") or [])


def _assign_object_uris(structured: dict[str, Any]) -> None:
    for collection in ("anchors", "semanticMatches", "expandedObjects", "relatedRecords"):
        for obj in structured.get(collection) or []:
            _assign_object_uri(obj)
    for passage in structured.get("semanticPassages") or []:
        if not passage.get("objectUri"):
            passage["objectUri"] = object_uri({"kind": "reference", "lineageId": passage.get("referenceLineageId"), "id": passage.get("referenceId")})
    for passage in structured.get("evidencePassages") or []:
        if not passage.get("objectUri"):
            passage["objectUri"] = object_uri({"kind": "reference", "lineageId": passage.get("referenceLineageId"), "id": passage.get("referenceId")})


def _assign_object_uri(obj: dict[str, Any]) -> None:
    uri = object_uri(obj)
    if uri:
        obj["objectUri"] = uri


def _seed_evidence_from_semantic_passages(structured: dict[str, Any]) -> None:
    if not structured.get("semanticPassages"):
        return
    summary_keys = {
        str(passage.get("referenceLineageId") or passage.get("referenceId") or "")
        for passage in structured.get("evidencePassages") or []
        if passage.get("selectionReason") == "reference_summary"
    }
    for passage in structured["semanticPassages"]:
        reference_key = str(passage.get("referenceLineageId") or passage.get("referenceId") or "")
        if reference_key in summary_keys:
            summary = next(
                item for item in structured.get("evidencePassages") or []
                if item.get("selectionReason") == "reference_summary"
                and str(item.get("referenceLineageId") or item.get("referenceId") or "") == reference_key
            )
            summary_budget = int(summary.get("tokens") or 0)
            reference_budget = int((structured.get("referenceTokenBudgets") or {}).get(reference_key) or 0)
            if reference_budget <= summary_budget + 80:
                continue
        structured["evidencePassages"].append(passage)
    structured["evidencePassages"] = _dedupe_passages(structured["evidencePassages"])


def _collect_reference_summaries(
    structured: dict[str, Any],
    services: KnowledgeQueryServices,
    warnings: list[str],
) -> None:
    graph = services.graph
    if not graph or not hasattr(graph, "list_incoming_relations"):
        return
    summaries: list[dict[str, Any]] = []
    for reference in _reference_objects(structured):
        lineage_id = str(reference.get("lineageId") or reference.get("id") or "")
        if not lineage_id:
            continue
        try:
            incoming = graph.list_incoming_relations(reference)  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover - defensive runtime note
            warnings.append(f"Could not load reference summaries for {object_title(reference) or anchor_ref(reference)}: {exc}")
            continue
        for relation in incoming:
            summary = _reference_summary_from_relation(reference, relation, graph, services)
            if summary:
                summaries.append(summary)
    structured["referenceSummaries"] = _dedupe_reference_summaries(summaries)


def _reference_summary_from_relation(
    reference: dict[str, Any],
    relation: dict[str, Any],
    graph: Any,
    services: KnowledgeQueryServices,
) -> dict[str, Any] | None:
    relation_key = str(relation.get("relationTypeKey") or relation.get("predicate") or "")
    max_tokens = _summary_tokens_from_relation_type(relation_key)
    if not max_tokens:
        return None
    if relation.get("relationState") not in {None, "", "current"}:
        return None
    if relation.get("subjectKind") != "message" or relation.get("objectKind") != "reference":
        return None
    message_id = relation.get("subjectId")
    if not message_id:
        return None
    try:
        message = graph.resolve_anchor({"kind": "message", "id": message_id, "lineageId": relation.get("subjectLineageId")}) or {}
    except Exception:  # pragma: no cover - defensive runtime fallback
        message = {}
    if message.get("messageKind") not in {None, "reference_summary"}:
        return None
    if message.get("messageDomain") not in {None, "summarization"}:
        return None
    if message.get("status") not in {None, "", "active"}:
        return None
    text = str(message.get("summary") or "").strip()
    if not text:
        return None
    metadata = _relation_metadata(relation)
    actual_tokens = metadata.get("actualTokenEstimate")
    try:
        actual_tokens = int(actual_tokens)
    except (TypeError, ValueError):
        actual_tokens = services.token_counter.count(text)
    reference_lineage_id = str(reference.get("lineageId") or reference.get("id") or relation.get("objectLineageId") or "")
    return {
        "id": relation.get("id") or f"{reference_lineage_id}:summary:{max_tokens}",
        "referenceId": reference.get("id") or relation.get("objectId"),
        "referenceLineageId": reference_lineage_id,
        "referenceTitle": object_title(reference),
        "objectUri": object_uri(reference),
        "messageId": message.get("id") or message_id,
        "messageLineageId": message.get("lineageId") or relation.get("subjectLineageId"),
        "relationId": relation.get("id"),
        "relationTypeKey": relation_key,
        "maxTokens": max_tokens,
        "actualTokens": actual_tokens,
        "createdAt": message.get("createdAt") or relation.get("importedAt"),
        "model": metadata.get("model"),
        "tokenizer": metadata.get("tokenizer"),
        "summary": text,
        "text": text,
        "tokens": services.token_counter.count(text),
    }


def _seed_evidence_from_reference_summaries(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
) -> None:
    selected = []
    summaries_by_reference: dict[str, list[dict[str, Any]]] = {}
    for summary in structured.get("referenceSummaries") or []:
        key = str(summary.get("referenceLineageId") or summary.get("referenceId") or "")
        if key:
            summaries_by_reference.setdefault(key, []).append(summary)
    for reference in _reference_objects(structured):
        reference_key = str(reference.get("lineageId") or reference.get("id") or "")
        candidates = summaries_by_reference.get(reference_key) or []
        if not candidates:
            continue
        budget = int((structured.get("referenceTokenBudgets") or {}).get(reference_key) or request["maxPassageTokens"])
        summary = _choose_reference_summary(candidates, budget, services)
        if not summary:
            continue
        text = str(summary["text"])
        truncated = services.token_counter.count(text) > budget
        if truncated:
            text = services.token_counter.truncate(text, max(1, budget))
        selected.append(
            {
                "id": f"{summary['id']}:evidence",
                "referenceId": summary.get("referenceId"),
                "referenceLineageId": summary.get("referenceLineageId"),
                "referenceTitle": summary.get("referenceTitle"),
                "objectUri": summary.get("objectUri"),
                "summaryId": summary.get("id"),
                "summaryRelationId": summary.get("relationId"),
                "summaryMessageId": summary.get("messageId"),
                "summaryMaxTokens": summary.get("maxTokens"),
                "rank": 0,
                "score": 1000 + int(summary.get("maxTokens") or 0),
                "selectionReason": "reference_summary",
                "text": text,
                "tokens": services.token_counter.count(text),
                "truncated": truncated,
            }
        )
        ranking = reference.get("ranking") if isinstance(reference.get("ranking"), dict) else {}
        ranking["summaryTokenBudget"] = budget
        ranking["selectedSummaryMaxTokens"] = summary.get("maxTokens")
        reference["ranking"] = ranking
    structured["evidencePassages"].extend(selected)


def _choose_reference_summary(
    summaries: list[dict[str, Any]],
    budget: int,
    services: KnowledgeQueryServices,
) -> dict[str, Any] | None:
    if not summaries:
        return None
    enriched = []
    for summary in summaries:
        token_count = int(summary.get("tokens") or services.token_counter.count(str(summary.get("text") or "")))
        max_tokens = int(summary.get("maxTokens") or token_count or 0)
        created_at = str(summary.get("createdAt") or "")
        enriched.append((summary, token_count, max_tokens, created_at))
    fitting = [entry for entry in enriched if entry[1] <= max(1, budget)]
    if fitting:
        return sorted(fitting, key=lambda item: (item[2], item[1], item[3]), reverse=True)[0][0]
    return sorted(enriched, key=lambda item: (item[2], item[3]))[0][0]


def _dedupe_reference_summaries(summaries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, int], dict[str, Any]] = {}
    for summary in summaries:
        key = (str(summary.get("referenceLineageId") or summary.get("referenceId") or ""), int(summary.get("maxTokens") or 0))
        existing = deduped.get(key)
        if not existing or str(summary.get("createdAt") or "") > str(existing.get("createdAt") or ""):
            deduped[key] = summary
    return sorted(deduped.values(), key=lambda summary: (str(summary.get("referenceLineageId") or ""), int(summary.get("maxTokens") or 0)))


def _summary_tokens_from_relation_type(value: str | None) -> int | None:
    if not value:
        return None
    match = SUMMARY_RELATION_RE.match(value)
    return int(match.group(1)) if match else None


def _collect_quality_ratings(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
    warnings: list[str],
) -> None:
    graph = services.graph
    references = _reference_objects(structured)
    if not references:
        return
    relation_pool = [
        relation for relation in [*(structured.get("relations") or []), *(structured.get("operationalRelations") or [])]
        if isinstance(relation, dict)
    ]
    relations_by_reference: dict[str, list[dict[str, Any]]] = {}
    for relation in relation_pool:
        if str(relation.get("subjectKind") or "") != "reference":
            continue
        lineage_id = str(relation.get("subjectLineageId") or relation.get("subjectId") or "")
        if lineage_id:
            relations_by_reference.setdefault(lineage_id, []).append(relation)
    if graph and hasattr(graph, "list_outgoing_relations"):
        for reference in references:
            lineage_id = str(reference.get("lineageId") or reference.get("id") or "")
            if not lineage_id:
                continue
            try:
                outgoing = graph.list_outgoing_relations(reference)  # type: ignore[attr-defined]
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not load quality relations for {object_title(reference) or anchor_ref(reference)}: {exc}")
                outgoing = []
            relations_by_reference.setdefault(lineage_id, []).extend(relation for relation in outgoing if isinstance(relation, dict))
    selected_relations: list[dict[str, Any]] = []
    for reference in references:
        lineage_id = str(reference.get("lineageId") or reference.get("id") or "")
        if not lineage_id:
            continue
        signal, warning = quality_signal_from_relations(
            relations_by_reference.get(lineage_id, []),
            float(request["ranking"].get("missingQuality", 0.5)),
        )
        if warning:
            warnings.append(warning)
            structured.setdefault("rankingWarnings", []).append(warning)
        if signal.get("qualityRelationId"):
            relation = next(
                (candidate for candidate in relations_by_reference.get(lineage_id, []) if candidate.get("id") == signal.get("qualityRelationId")),
                None,
            )
            if relation:
                selected_relations.append(relation)
        _apply_quality_signal_to_reference_objects(structured, lineage_id, signal)
    structured["qualityRelations"] = _dedupe_by_id([*(structured.get("qualityRelations") or []), *selected_relations])


def _apply_quality_signal_to_reference_objects(structured: dict[str, Any], lineage_id: str, signal: dict[str, Any]) -> None:
    if not lineage_id:
        return
    for collection in ("anchors", "semanticMatches", "expandedObjects"):
        for obj in structured.get(collection) or []:
            if obj.get("kind") != "reference":
                continue
            if str(obj.get("lineageId") or obj.get("id") or "") != lineage_id:
                continue
            ranking = obj.get("ranking") if isinstance(obj.get("ranking"), dict) else {}
            ranking.update(signal)
            obj["ranking"] = ranking


def _rank_structured_records(structured: dict[str, Any], request: dict[str, Any]) -> None:
    ranking_config = request["ranking"]
    anchors = structured.get("anchors") or []
    anchor_keys = {_object_key(anchor) for anchor in anchors if _object_key(anchor)}
    graph_keys = {_object_key(obj) for obj in structured.get("expandedObjects") or [] if _object_key(obj)}
    for anchor in anchors:
        _assign_record_ranking(anchor, request, ranking_config, graph_context=1.0, relevance=1.0)
    for match in structured.get("semanticMatches") or []:
        key = _object_key(match)
        graph_context = 0.0
        if key in graph_keys:
            graph_context = 0.9
        elif _shares_context_metadata(match, anchors):
            graph_context = 0.6
        _assign_record_ranking(match, request, ranking_config, graph_context=graph_context)
    for obj in structured.get("expandedObjects") or []:
        key = _object_key(obj)
        graph_context = 1.0 if key in anchor_keys else 0.8
        _assign_record_ranking(obj, request, ranking_config, graph_context=graph_context)
    for passage in structured.get("semanticPassages") or []:
        _assign_passage_ranking(passage, structured, request)
    for passage in structured.get("evidencePassages") or []:
        _assign_passage_ranking(passage, structured, request)


def _assign_record_ranking(
    record: dict[str, Any],
    request: dict[str, Any],
    ranking_config: dict[str, Any],
    *,
    graph_context: float,
    relevance: float | None = None,
) -> None:
    existing = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
    ranking = score_record(
        record,
        ranking_config=ranking_config,
        semantic_query=request["semanticQuery"],
        graph_context_score=graph_context,
        relevance_score=relevance,
    )
    ranking.update({key: value for key, value in existing.items() if key.startswith("quality") and value not in {None, ""}})
    if existing.get("qualityKnown") is not None:
        ranking = score_record(
            {**record, "ranking": ranking},
            ranking_config=ranking_config,
            semantic_query=request["semanticQuery"],
            graph_context_score=graph_context,
            relevance_score=relevance,
        )
    record["ranking"] = ranking


def _assign_passage_ranking(passage: dict[str, Any], structured: dict[str, Any], request: dict[str, Any]) -> None:
    reference_key = str(passage.get("referenceLineageId") or passage.get("referenceId") or "")
    parent = _reference_by_key(structured, reference_key)
    parent_ranking = parent.get("ranking") if isinstance(parent, dict) and isinstance(parent.get("ranking"), dict) else {}
    try:
        passage_relevance = float(passage.get("score") or 0)
    except (TypeError, ValueError):
        passage_relevance = 0.0
    if passage.get("selectionReason") == "semantic_vector":
        passage_relevance = max(passage_relevance / 25.0, float(parent_ranking.get("relevanceScore", 0.0)))
    else:
        passage_relevance = min(1.0, passage_relevance / 12.0)
    quality_score = float(parent_ranking.get("qualityScore", request["ranking"].get("missingQuality", 0.5)))
    graph_context = float(parent_ranking.get("graphContextScore", 0.0))
    weights = request["ranking"].get("weights") or {}
    final_score = (
        float(weights.get("relevance", 0.7)) * max(0.0, min(1.0, passage_relevance))
        + float(weights.get("quality", 0.25)) * max(0.0, min(1.0, quality_score))
        + float(weights.get("graphContext", 0.05)) * max(0.0, min(1.0, graph_context))
    )
    passage["ranking"] = {
        "profile": request["ranking"].get("profile", "balanced"),
        "relevanceScore": round(max(0.0, min(1.0, passage_relevance)), 4),
        "qualityScore": round(max(0.0, min(1.0, quality_score)), 4),
        "qualityRating": parent_ranking.get("qualityRating"),
        "qualityKnown": bool(parent_ranking.get("qualityKnown")),
        "qualityRelationId": parent_ranking.get("qualityRelationId"),
        "graphContextScore": round(max(0.0, min(1.0, graph_context)), 4),
        "finalScore": round(max(0.0, min(1.0, final_score)), 4),
        "tokenBudget": parent_ranking.get("tokenBudget"),
        "parentReferenceLineageId": reference_key,
    }


def _reference_by_key(structured: dict[str, Any], reference_key: str) -> dict[str, Any] | None:
    for reference in _reference_objects(structured):
        if str(reference.get("lineageId") or reference.get("id") or "") == reference_key:
            return reference
    return None


def _reference_excerpt_token_budgets(structured: dict[str, Any], request: dict[str, Any]) -> dict[str, int]:
    references = _reference_objects(structured)
    if not references:
        return {}
    max_passages = int(request["maxPassages"])
    max_passage_tokens = int(request["maxPassageTokens"])
    if request.get("maxTokens"):
        total_budget = max(max_passage_tokens, min(max_passages * max_passage_tokens, int(int(request["maxTokens"]) * 0.55)))
    else:
        total_budget = max_passages * max_passage_tokens
    budgets = allocate_token_budgets(
        references,
        total_budget,
        min_tokens=min(80, max_passage_tokens),
        max_tokens=min(1000, max(160, max_passage_tokens * 3)),
    )
    for reference in references:
        key = record_key(reference)
        if not key or key not in budgets:
            continue
        ranking = reference.get("ranking") if isinstance(reference.get("ranking"), dict) else {}
        ranking["tokenBudget"] = budgets[key]
        reference["ranking"] = ranking
    return budgets


def _build_related_records(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
) -> list[dict[str, Any]]:
    limit = int(request["scope"].get("relatedRecordLimit") or 0)
    if limit <= 0:
        return []
    anchors = structured.get("anchors") or []
    anchor_keys = {_object_key(anchor) for anchor in anchors if _object_key(anchor)}
    graph_keys = {_object_key(obj) for obj in structured.get("expandedObjects") or [] if _object_key(obj)}
    records: list[dict[str, Any]] = []
    rank = 1
    for match in structured.get("semanticMatches") or []:
        key = _object_key(match)
        if not key or key in anchor_keys:
            continue
        ranking = match.get("ranking") if isinstance(match.get("ranking"), dict) else {}
        if anchors and float(ranking.get("relevanceScore", 0.0)) < float(request["ranking"].get("relevanceGate", 0.18)):
            continue
        reason = _semantic_related_reason(match, anchors, graph_keys)
        if not reason:
            continue
        records.append(_related_record(match, rank, reason, "semantic_search", structured, services))
        rank += 1
    for obj in structured.get("expandedObjects") or []:
        key = _object_key(obj)
        if not key or key in anchor_keys:
            continue
        if not _is_related_record_candidate(obj):
            continue
        records.append(_related_record(obj, rank, "graph context expansion", "graph_expansion", structured, services))
        rank += 1
    records = _dedupe_related_records(records)[:limit]
    _allocate_related_record_budgets(records, request, services)
    return records


def _is_related_record_candidate(obj: dict[str, Any]) -> bool:
    if obj.get("kind") in {"message", "assignment"}:
        return False
    if obj.get("kind") == "semanticNode" and obj.get("status") == "generated":
        return False
    if obj.get("kind") == "semanticNode" and not any(obj.get(key) for key in ("summary", "description", "categoryKey", "categoryLineageId")):
        return False
    return True


def _semantic_related_reason(match: dict[str, Any], anchors: list[dict[str, Any]], graph_keys: set[tuple[str, str]]) -> str:
    if not anchors:
        return "semantic match for the query"
    key = _object_key(match)
    if key in graph_keys:
        return "semantic match and graph neighbor of the starting record"
    if _shares_context_metadata(match, anchors):
        return "semantic match in the same corpus or category context as the starting record"
    distance = match.get("distance")
    if isinstance(distance, (int, float)) and float(distance) <= 0.38:
        return "strong semantic match for the query"
    score = match.get("score")
    if isinstance(score, (int, float)) and float(score) >= 0.75:
        return "strong semantic match for the query"
    return ""


def _shares_context_metadata(match: dict[str, Any], anchors: list[dict[str, Any]]) -> bool:
    metadata = match.get("metadata") if isinstance(match.get("metadata"), dict) else {}
    match_values = {
        str(match.get("corpusId") or metadata.get("corpusId") or ""),
        str(match.get("categorySetId") or metadata.get("categorySetId") or ""),
        str(match.get("categoryLineageId") or metadata.get("categoryLineageId") or ""),
        str(match.get("categoryKey") or metadata.get("categoryKey") or ""),
    }
    match_values.discard("")
    if not match_values:
        return False
    for anchor in anchors:
        anchor_values = {
            str(anchor.get("corpusId") or ""),
            str(anchor.get("categorySetId") or ""),
            str(anchor.get("categoryLineageId") or ""),
            str(anchor.get("categoryKey") or ""),
        }
        anchor_values.discard("")
        if match_values & anchor_values:
            return True
    return False


def _related_record(
    obj: dict[str, Any],
    rank: int,
    why_related: str,
    source: str,
    structured: dict[str, Any],
    services: KnowledgeQueryServices,
) -> dict[str, Any]:
    record = dict(obj)
    _assign_object_uri(record)
    summary = _record_summary(record, structured, services)
    return {
        "kind": record.get("kind") or record.get("objectKind") or record.get("type") or "object",
        "id": record.get("id"),
        "lineageId": record.get("lineageId"),
        "objectUri": record.get("objectUri"),
        "title": object_title(record) or record.get("objectUri") or anchor_ref(record),
        "summary": summary,
        "whyRelated": why_related,
        "rank": rank,
        "score": record.get("score"),
        "distance": record.get("distance"),
        "ranking": record.get("ranking") if isinstance(record.get("ranking"), dict) else {},
        "provenance": {
            "source": source,
            "kind": record.get("kind"),
            "id": record.get("id"),
            "lineageId": record.get("lineageId"),
            "objectUri": record.get("objectUri"),
            "whyRelated": why_related,
            "providerRank": record.get("rank"),
            "score": record.get("score"),
            "distance": record.get("distance"),
            "qualityRelationId": (record.get("ranking") or {}).get("qualityRelationId") if isinstance(record.get("ranking"), dict) else None,
        },
    }


def _record_summary(obj: dict[str, Any], structured: dict[str, Any], services: KnowledgeQueryServices) -> str:
    kind = obj.get("kind") or obj.get("type")
    if kind == "reference":
        passage = _best_passage_for_reference(obj, structured)
        if passage:
            return services.token_counter.truncate(_best_sentence(passage["text"], structured["request"].get("semanticQuery") or ""), 90)
        return services.token_counter.truncate(source_summary(obj), 90)
    if kind == "item" or obj.get("type") == "article":
        for key in ("deck", "summary", "brief", "description"):
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return services.token_counter.truncate(value.strip(), 90)
        body = obj.get("body")
        if isinstance(body, list):
            for part in body:
                if str(part).strip():
                    return services.token_counter.truncate(str(part).strip(), 90)
        if isinstance(body, str) and body.strip():
            return services.token_counter.truncate(body.strip(), 90)
    for key in ("description", "summary", "deck", "brief"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip() and value.strip() != object_title(obj):
            return services.token_counter.truncate(value.strip(), 90)
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
    text = metadata.get("summary") or metadata.get("text")
    if isinstance(text, str) and text.strip():
        return services.token_counter.truncate(_clean_text(text), 90)
    return services.token_counter.truncate(object_summary(obj), 90)


def _best_passage_for_reference(obj: dict[str, Any], structured: dict[str, Any]) -> dict[str, Any] | None:
    lineage_id = str(obj.get("lineageId") or "")
    reference_id = str(obj.get("id") or "")
    candidates = [
        passage for passage in structured.get("evidencePassages") or []
        if str(passage.get("referenceLineageId") or "") == lineage_id
        or str(passage.get("referenceId") or "") == reference_id
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda passage: (-float(passage.get("score") or 0), int(passage.get("rank") or 999)))[0]


def _dedupe_related_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        key = _object_key(record)
        if not key:
            continue
        existing = deduped.get(key)
        if not existing or _related_record_priority(record) > _related_record_priority(existing):
            deduped[key] = record
    return sorted(deduped.values(), key=ranking_sort_key)


def _related_record_priority(record: dict[str, Any]) -> float:
    ranking = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
    if ranking.get("finalScore") is not None:
        try:
            return float(ranking.get("finalScore"))
        except (TypeError, ValueError):
            pass
    score = record.get("score")
    if isinstance(score, (int, float)):
        return float(score)
    distance = record.get("distance")
    if isinstance(distance, (int, float)):
        return 1.0 - float(distance)
    source = (record.get("provenance") or {}).get("source")
    return 0.5 if source == "semantic_search" else 0.25


def _allocate_related_record_budgets(records: list[dict[str, Any]], request: dict[str, Any], services: KnowledgeQueryServices) -> None:
    if not records:
        return
    budgets = allocate_token_budgets(
        records,
        int(request.get("seeAlsoMaxTokens") or 300),
        min_tokens=40,
        max_tokens=120,
    )
    for record in records:
        key = record_key(record)
        budget = budgets.get(key)
        if not budget:
            continue
        ranking = record.get("ranking") if isinstance(record.get("ranking"), dict) else {}
        ranking["tokenBudget"] = budget
        record["ranking"] = ranking
        # Keep room for the title, object URI, and reason lines rendered by See Also.
        summary_budget = max(16, budget - 35)
        if record.get("summary"):
            record["summary"] = services.token_counter.truncate(str(record["summary"]), summary_budget)


def related_record_summary(record: dict[str, Any]) -> str:
    lines = []
    if record.get("objectUri"):
        lines.append(f"Object: {record['objectUri']}")
    if record.get("whyRelated"):
        lines.append(f"Why related: {record['whyRelated']}.")
    if record.get("summary"):
        summary = _sanitize_excerpt_markdown(str(record["summary"]))
        if summary:
            lines.append(summary)
    return "\n".join(lines) or (record.get("objectUri") or "")


def _collect_reference_evidence(
    structured: dict[str, Any],
    request: dict[str, Any],
    services: KnowledgeQueryServices,
    warnings: list[str],
) -> None:
    if not request["includeExtracts"]:
        return
    references = _reference_objects(structured)
    if not references:
        return
    attachments_by_lineage: dict[str, list[dict[str, Any]]] = {}
    graph = services.graph
    if graph and hasattr(graph, "list_reference_attachments"):
        for reference in references:
            try:
                attachments = graph.list_reference_attachments(reference)  # type: ignore[attr-defined]
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not load attachments for {object_title(reference) or anchor_ref(reference)}: {exc}")
                attachments = []
            lineage_id = str(reference.get("lineageId") or reference.get("id") or "")
            attachments_by_lineage[lineage_id] = attachments
            structured["referenceAttachments"].extend(attachments)
    structured["referenceAttachments"] = _dedupe_by_id(structured["referenceAttachments"])

    remaining = max(0, int(request["maxPassages"]) - len(structured.get("evidencePassages") or []))
    ordered_references = sorted(references, key=ranking_sort_key)
    anchor_reference_keys = {
        str(anchor.get("lineageId") or anchor.get("id") or "")
        for anchor in structured.get("anchors") or []
        if anchor.get("kind") == "reference"
    }
    ordered_references = sorted(
        ordered_references,
        key=lambda reference: (
            0 if str(reference.get("lineageId") or reference.get("id") or "") in anchor_reference_keys else 1,
            ranking_sort_key(reference),
        ),
    )
    for reference in ordered_references:
        if reference.get("curationStatus") not in {None, "accepted"}:
            continue
        lineage_id = str(reference.get("lineageId") or reference.get("id") or "")
        attachments = attachments_by_lineage.get(lineage_id, [])
        text_attachments = [
            attachment for attachment in attachments
            if attachment.get("role") == "extracted_text" and attachment.get("storagePath")
        ]
        if not text_attachments:
            if reference.get("curationStatus") == "accepted":
                warnings.append(f"No extracted text attachment found for {object_title(reference) or anchor_ref(reference)}")
            continue
        if not services.corpus_text:
            warnings.append(f"No corpus text provider configured for {object_title(reference) or anchor_ref(reference)}")
            continue
        for attachment in text_attachments:
            storage_path = str(attachment.get("storagePath") or "")
            try:
                text = services.corpus_text.read_text(storage_path)
            except Exception as exc:  # pragma: no cover - defensive runtime note
                warnings.append(f"Could not read extracted text for {object_title(reference) or anchor_ref(reference)}: {exc}")
                continue
            if not text:
                warnings.append(f"Extracted text was empty for {object_title(reference) or anchor_ref(reference)}")
                continue
            structured.setdefault("_sourceTexts", []).append(
                {
                    "referenceId": reference.get("id"),
                    "referenceLineageId": reference.get("lineageId"),
                    "referenceTitle": object_title(reference),
                    "objectUri": object_uri(reference),
                    "storagePath": storage_path,
                    "text": text.strip(),
                    "tokens": services.token_counter.count(text),
                }
            )
            if remaining <= 0:
                continue
            reference_budget = int((structured.get("referenceTokenBudgets") or {}).get(lineage_id) or request["maxPassageTokens"])
            summary = _selected_summary_passage(structured, lineage_id)
            if summary:
                reference_budget = max(0, reference_budget - int(summary.get("tokens") or 0))
                if reference_budget < 80:
                    continue
            max_for_reference = max(1, min(remaining, (reference_budget + int(request["maxPassageTokens"]) - 1) // int(request["maxPassageTokens"])))
            if _reference_needs_evidence(structured, reference):
                max_for_reference = max(1, max_for_reference)
            max_passage_tokens = max(40, min(500, reference_budget // max_for_reference))
            selected = _select_passages(
                text,
                reference,
                request["semanticQuery"],
                storage_path,
                max_passages=max_for_reference,
                max_passage_tokens=max_passage_tokens,
                services=services,
            )
            structured["evidencePassages"].extend(selected)
            remaining -= len(selected)
            reference_key = str(reference.get("lineageId") or reference.get("id") or "")
            summary = _selected_summary_passage(structured, reference_key)
            if summary:
                used = int(summary.get("tokens") or 0) + sum(int(passage.get("tokens") or 0) for passage in selected)
                for obj in _reference_objects(structured):
                    if str(obj.get("lineageId") or obj.get("id") or "") == reference_key:
                        ranking = obj.get("ranking") if isinstance(obj.get("ranking"), dict) else {}
                        ranking["remainingPassageTokenBudget"] = max(0, int((structured.get("referenceTokenBudgets") or {}).get(reference_key) or request["maxPassageTokens"]) - used)
                        obj["ranking"] = ranking


def _selected_summary_passage(structured: dict[str, Any], reference_key: str) -> dict[str, Any] | None:
    for passage in structured.get("evidencePassages") or []:
        if passage.get("selectionReason") != "reference_summary":
            continue
        if str(passage.get("referenceLineageId") or passage.get("referenceId") or "") == reference_key:
            return passage
    return None


def _reference_needs_evidence(structured: dict[str, Any], reference: dict[str, Any]) -> bool:
    anchor_keys = {
        str(anchor.get("lineageId") or anchor.get("id") or "")
        for anchor in structured.get("anchors") or []
        if anchor.get("kind") == "reference"
    }
    reference_key = str(reference.get("lineageId") or reference.get("id") or "")
    if not reference_key or reference_key not in anchor_keys:
        return False
    for passage in structured.get("evidencePassages") or []:
        passage_key = str(passage.get("referenceLineageId") or passage.get("referenceId") or "")
        if passage_key == reference_key:
            return False
    return True


def _reference_objects(structured: dict[str, Any]) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    for collection in ("anchors", "expandedObjects", "semanticMatches"):
        for obj in structured.get(collection) or []:
            if obj.get("kind") == "reference":
                references.append(obj)
    seen: dict[str, dict[str, Any]] = {}
    for reference in references:
        key = str(reference.get("lineageId") or reference.get("id") or len(seen))
        if key not in seen or len(reference) > len(seen[key]):
            seen[key] = reference
    return list(seen.values())


def _target_reference_objects(structured: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        anchor for anchor in structured.get("anchors") or []
        if anchor.get("kind") == "reference"
    ]


def _reference_key(reference: dict[str, Any]) -> str:
    return str(reference.get("lineageId") or reference.get("id") or "")


def _passage_reference_key(passage: dict[str, Any]) -> str:
    return str(passage.get("referenceLineageId") or passage.get("referenceId") or "")


def _select_passages(
    text: str,
    reference: dict[str, Any],
    semantic_query: str,
    storage_path: str,
    max_passages: int,
    max_passage_tokens: int,
    services: KnowledgeQueryServices,
) -> list[dict[str, Any]]:
    keywords = _keywords(" ".join([semantic_query, object_title(reference) or "", " ".join(reference.get("authors") or [])]))
    scored = []
    for index, chunk in enumerate(_chunk_text(text)):
        clean = _clean_text(chunk["text"])
        if len(clean) < 80:
            continue
        score = _passage_score(clean, chunk.get("heading") or "", keywords)
        if score <= 0 and keywords:
            continue
        scored.append((score, index, chunk, clean))
    if not scored:
        scored = [
            (1.0, index, chunk, _clean_text(chunk["text"]))
            for index, chunk in enumerate(_chunk_text(text)[:max_passages])
            if len(_clean_text(chunk["text"])) >= 80
        ]
    selected = []
    for rank, (score, index, chunk, clean) in enumerate(sorted(scored, key=lambda item: (-item[0], item[1]))[:max_passages], start=1):
        truncated = services.token_counter.count(clean) > max_passage_tokens
        passage_text = services.token_counter.truncate(clean, max_passage_tokens)
        selected.append(
            {
                "id": f"{reference.get('lineageId') or reference.get('id')}:passage:{index}",
                "referenceId": reference.get("id"),
                "referenceLineageId": reference.get("lineageId"),
                "referenceTitle": object_title(reference),
                "objectUri": object_uri(reference),
                "storagePath": storage_path,
                "rank": rank,
                "score": round(float(score), 3),
                "heading": chunk.get("heading"),
                "startChar": chunk.get("start"),
                "endChar": chunk.get("end"),
                "selectionReason": "query_overlap" if keywords else "first_available_passage",
                "text": passage_text,
                "tokens": services.token_counter.count(passage_text),
                "truncated": truncated,
            }
        )
    return selected


def _chunk_text(text: str, target_words: int = 180) -> list[dict[str, Any]]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    chunks: list[dict[str, Any]] = []
    buffer: list[str] = []
    heading = ""
    start = 0
    cursor = 0
    for line in lines:
        raw = line
        stripped = line.strip()
        is_heading = _looks_like_heading(stripped)
        if is_heading and buffer:
            chunks.append({"heading": heading, "text": "\n".join(buffer), "start": start, "end": cursor})
            buffer = []
            start = cursor
        if is_heading:
            heading = stripped
        if stripped:
            if not buffer:
                start = cursor
            buffer.append(raw)
        if len(" ".join(buffer).split()) >= target_words:
            chunks.append({"heading": heading, "text": "\n".join(buffer), "start": start, "end": cursor + len(raw)})
            buffer = []
            start = cursor + len(raw)
        cursor += len(raw) + 1
    if buffer:
        chunks.append({"heading": heading, "text": "\n".join(buffer), "start": start, "end": cursor})
    return chunks


def _looks_like_heading(line: str) -> bool:
    if not line or len(line) > 90:
        return False
    lowered = line.lower().strip(" .:")
    if lowered in PASSAGE_HEADING_BOOSTS or lowered in {"references", "bibliography", "appendix"}:
        return True
    return bool(re.match(r"^(\d+(\.\d+)*)\.\s+[A-Z]", line))


def _passage_score(text: str, heading: str, keywords: set[str]) -> float:
    lowered_heading = heading.lower()
    if lowered_heading.startswith("references") or lowered_heading.startswith("bibliography"):
        return -10
    lowered_text = text.lower()
    if any(marker in lowered_text for marker in ("correspondence to:", "project co-leads", "uc berkeley", "ibm research")):
        return -5
    if lowered_text.count("url http") >= 2 or lowered_text.count("arxiv.org/abs") >= 2 or "references " in lowered_text[:40]:
        return -8
    tokens = _keywords(text)
    overlap = len(tokens & keywords) if keywords else 0
    score = float(overlap)
    for heading_key, boost in PASSAGE_HEADING_BOOSTS.items():
        if heading_key in lowered_heading:
            score += boost
    if "arxiv:" in lowered_text or lowered_text.startswith("(figure"):
        score -= 5
    if any(term in tokens for term in {"reliability", "evaluation", "production", "agents", "practitioners"}):
        score += 2
    return score


def _keywords(text: str) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text or "")
        if token.lower() not in PASSAGE_STOPWORDS
    }


def _clean_text(text: str) -> str:
    text = re.sub(r"-\s*\n\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _knowledge_summary_text(semantic_query: str, passages: list[dict[str, Any]], references: list[dict[str, Any]]) -> str:
    lines = []
    if semantic_query:
        lines.append(f"Query focus: {semantic_query}.")
    if len(references) > 1:
        return "\n".join(lines)
    if passages:
        lines.append("Selected evidence says:")
        for passage in passages[:4]:
            sentence = _best_sentence(passage["text"], semantic_query)
            source = passage.get("referenceTitle") or "source"
            lines.append(f"- {sentence} ({source})")
    elif references:
        lines.append("No extracted source passages were selected; only source metadata is available for this request.")
    else:
        lines.append("No accepted reference evidence was available for this request.")
    return "\n".join(lines)


def source_header_text(reference: dict[str, Any]) -> str:
    lines = []
    uri = reference.get("objectUri") or object_uri(reference)
    if uri:
        lines.append(f"Papyrus URI: {uri}")
    source_uri = reference.get("sourceUri")
    if isinstance(source_uri, str) and source_uri.strip():
        lines.append(f"Source URI: {source_uri.strip()}")
    authors = reference.get("authors")
    if isinstance(authors, list) and authors:
        lines.append("Authors: " + ", ".join(str(author) for author in authors[:6]) + (" et al." if len(authors) > 6 else ""))
    date = reference.get("sourcePublishedAt") or reference.get("sourceUpdatedAt")
    if date:
        lines.append(f"Published: {date}")
    return "\n".join(lines)


def source_brief(reference: dict[str, Any]) -> str:
    pieces = []
    authors = reference.get("authors")
    if isinstance(authors, list) and authors:
        pieces.append("by " + ", ".join(str(author) for author in authors[:3]) + (" et al." if len(authors) > 3 else ""))
    date = reference.get("sourcePublishedAt") or reference.get("sourceUpdatedAt")
    if date:
        pieces.append(str(date))
    source_uri = reference.get("sourceUri")
    if isinstance(source_uri, str) and source_uri.strip():
        pieces.append(source_uri.strip())
    return "; ".join(pieces)


def _best_sentence(text: str, semantic_query: str) -> str:
    keywords = _keywords(semantic_query)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    if not sentences:
        return text.strip()
    if not keywords:
        return sentences[0]
    return max(sentences[:8], key=lambda sentence: len(_keywords(sentence) & keywords))


def _gaps_text(structured: dict[str, Any], request: dict[str, Any]) -> str:
    gaps = []
    if _reference_objects(structured) and request["includeExtracts"] and not structured.get("evidencePassages"):
        gaps.append("No extracted source passages were available or selected.")
    return "\n".join(f"- {gap}" for gap in gaps)


def source_summary(reference: dict[str, Any]) -> str:
    pieces = []
    title = object_title(reference)
    if title:
        pieces.append(title)
    authors = reference.get("authors")
    if isinstance(authors, list) and authors:
        pieces.append("Authors: " + ", ".join(str(author) for author in authors[:6]) + (" et al." if len(authors) > 6 else ""))
    date = reference.get("sourcePublishedAt") or reference.get("sourceUpdatedAt") or reference.get("importedAt")
    if date:
        pieces.append(f"Date: {date}")
    if reference.get("sourceUri"):
        pieces.append(f"URI: {reference['sourceUri']}")
    if reference.get("objectUri") or object_uri(reference):
        pieces.append(f"Papyrus URI: {reference.get('objectUri') or object_uri(reference)}")
    return "\n".join(pieces) or object_summary(reference)


def knowledge_relation_title(relation: dict[str, Any]) -> str:
    relation_key = relation.get("relationTypeKey") or relation.get("predicate") or "related_to"
    return str(relation_key).replace("_", " ").title()


def knowledge_relation_summary(relation: dict[str, Any]) -> str:
    relation_key = relation.get("relationTypeKey") or relation.get("predicate") or "related_to"
    subject = relation.get("subjectKind") or "subject"
    obj = relation.get("objectKind") or "object"
    lines = [f"{subject} {str(relation_key).replace('_', ' ')} {obj}."]
    metadata = _relation_metadata(relation)
    for key in ("summary", "rationale", "note", "label", "title"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(value.strip())
            break
    score = relation.get("score") or relation.get("confidence")
    if score is not None:
        lines.append(f"Score: {score}")
    return "\n".join(lines)


def object_title(obj: dict[str, Any]) -> str:
    for key in ("title", "headline", "displayName", "summary", "nodeKey", "categoryKey", "externalItemId", "id"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def object_summary(obj: dict[str, Any]) -> str:
    pieces = []
    label = object_title(obj)
    kind = obj.get("kind") or obj.get("nodeKind") or obj.get("type")
    if kind or label:
        pieces.append(": ".join(str(part) for part in (kind, label) if part))
    object_meta = []
    for key in ("messageKind", "messageDomain", "source", "authorLabel", "createdAt"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            object_meta.append(f"{key}: {value.strip()}")
    if object_meta:
        pieces.append("\n".join(object_meta))
    for key in ("description", "summary", "deck", "brief", "curationStatus", "status", "sourceUri"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip() and value.strip() != label:
            pieces.append(value.strip())
    body = obj.get("body")
    if isinstance(body, list):
        pieces.extend(str(part).strip() for part in body[:2] if str(part).strip())
    elif isinstance(body, str) and body.strip():
        pieces.append(body.strip())
    if not pieces:
        pieces.append(anchor_ref(obj))
    return "\n".join(pieces)


def relation_title(relation: dict[str, Any]) -> str:
    relation_key = relation.get("relationTypeKey") or relation.get("predicate") or "related_to"
    return f"{relation.get('subjectKind')} {relation_key} {relation.get('objectKind')}"


def relation_summary(relation: dict[str, Any]) -> str:
    relation_key = relation.get("relationTypeKey") or relation.get("predicate") or "related_to"
    lines = [
        f"{relation.get('subjectKind')}#{relation.get('subjectLineageId') or relation.get('subjectId')} {relation_key} "
        f"{relation.get('objectKind')}#{relation.get('objectLineageId') or relation.get('objectId')}"
    ]
    metadata = _relation_metadata(relation)
    if metadata:
        appended_metadata = False
        for key in ("summary", "rationale", "note", "label"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                lines.append(value.strip())
                appended_metadata = True
                break
        if not appended_metadata:
            metadata_parts = []
            for key in ("curationStatus", "action", "reasonCode", "messageKind", "externalItemId", "corpusId"):
                value = metadata.get(key)
                if value is not None and str(value).strip():
                    metadata_parts.append(f"{key}: {value}")
            if metadata_parts:
                lines.append("; ".join(metadata_parts))
    score = relation.get("score") or relation.get("confidence")
    if score is not None:
        lines.append(f"score: {score}")
    return "\n".join(lines)


def _relation_metadata(relation: dict[str, Any]) -> dict[str, Any]:
    metadata = relation.get("metadata")
    if isinstance(metadata, dict):
        return metadata
    if isinstance(metadata, str) and metadata.strip():
        try:
            parsed = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def anchor_ref(obj: dict[str, Any]) -> str:
    kind = obj.get("kind") or obj.get("objectKind") or "object"
    object_id = obj.get("lineageId") or obj.get("id") or obj.get("objectId") or "unknown"
    return f"{kind}:{object_id}"


def object_uri(obj: dict[str, Any]) -> str:
    kind = obj.get("kind") or obj.get("objectKind") or obj.get("type")
    object_id = obj.get("lineageId") or obj.get("id") or obj.get("objectId")
    if not kind or not object_id:
        return ""
    return f"papyrus://{quote(str(kind), safe='')}/{quote(str(object_id), safe='')}"


def _text_with_object_uri(text: str, obj: dict[str, Any]) -> str:
    uri = obj.get("objectUri") or object_uri(obj)
    if not uri:
        return text
    if uri in text:
        return text
    return f"Object: {uri}\n{text}" if text else f"Object: {uri}"


def _object_key(obj: dict[str, Any]) -> tuple[str, str] | None:
    kind = obj.get("kind") or obj.get("objectKind") or obj.get("type")
    object_id = obj.get("lineageId") or obj.get("id") or obj.get("objectId")
    if not kind or not object_id:
        return None
    return (str(kind), str(object_id))


def _dedupe_passages(passages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for index, passage in enumerate(passages):
        key = (
            str(passage.get("referenceLineageId") or passage.get("referenceId") or ""),
            str(passage.get("storagePath") or ""),
            str(passage.get("chunkIndex") if passage.get("chunkIndex") is not None else passage.get("startChar") or ""),
            str(passage.get("endChar") or passage.get("id") or index),
        )
        existing = deduped.get(key)
        if not existing or _passage_priority(passage) > _passage_priority(existing):
            deduped[key] = passage
    return sorted(deduped.values(), key=lambda passage: (-_passage_priority(passage), int(passage.get("rank") or 999)))


def _passage_priority(passage: dict[str, Any]) -> float:
    score = float(passage.get("score") or 0)
    if passage.get("selectionReason") == "semantic_vector":
        score += 100
    return score


def _dedupe_blocks(blocks: list[ContextBlock]) -> list[ContextBlock]:
    seen = set()
    result = []
    for block in blocks:
        key = block.block_id
        if key in seen:
            continue
        seen.add(key)
        result.append(block)
    return result


def _dedupe_by_id(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(records):
        key = str(record.get("id") or record.get("relationId") or index)
        deduped[key] = record
    return list(deduped.values())


def _dedupe_by_ref(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for index, record in enumerate(records):
        key = (str(record.get("kind") or record.get("objectKind") or "object"), str(record.get("lineageId") or record.get("id") or index))
        existing = deduped.get(key)
        if not existing:
            deduped[key] = record
            continue
        if existing.get("semanticSeedRank") is not None and record.get("semanticSeedRank") is None:
            continue
        if record.get("semanticSeedRank") is not None and existing.get("semanticSeedRank") is None:
            deduped[key] = {**existing, **record}
            continue
        if len(record) > len(existing):
            deduped[key] = record
    return list(deduped.values())

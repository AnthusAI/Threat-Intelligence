from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .node_lib_bridge import call_node_export
from .options import normalize_non_negative_integer, normalize_positive_integer, normalize_string, parse_options, parse_repeated_option
from .steering import load_steering_config, require_corpus_config

DISCOVERY_MODULE = "scripts/lib/papyrus-reference-discovery.cjs"


def _default_query_terms() -> list[str]:
    terms = call_node_export(DISCOVERY_MODULE, "DEFAULT_QUERY_TERMS")
    return list(terms or [])


def run_citation_led_discovery(flags: list[str]) -> None:
    options = parse_options(flags)
    steering_config = load_steering_config(options.get("config"))
    anchor_corpus_key = (
        options.get("anchor-corpus-key")
        or options.get("corpus-key")
        or (steering_config.get("canonicalTopicSet") or {}).get("corpusKey")
        or "AI-ML-research"
    )
    anchor_corpus = require_corpus_config(steering_config, anchor_corpus_key, "--anchor-corpus-key")
    anchor_corpus_path = str(Path(anchor_corpus["path"]).resolve())
    query_terms = parse_repeated_option(flags, "query") or _default_query_terms()
    discovery = call_node_export(
        DISCOVERY_MODULE,
        "runCitationLedDiscovery",
        {
            "runId": normalize_string(options.get("run-id")),
            "anchorCorpusPath": anchor_corpus_path,
            "fromYear": normalize_non_negative_integer(options.get("from-year"), "--from-year") or 2023,
            "toYear": normalize_non_negative_integer(options.get("to-year"), "--to-year") or 2026,
            "anchorLimit": normalize_positive_integer(options.get("anchor-limit"), "--anchor-limit") or 40,
            "citationsPerAnchor": normalize_positive_integer(options.get("citations-per-anchor"), "--citations-per-anchor")
            or 12,
            "feedLimit": normalize_positive_integer(options.get("feed-limit"), "--feed-limit") or 20,
            "queryTerms": query_terms,
        },
    )
    if options.get("output"):
        output_path = Path(options["output"])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(discovery["files"]["rankedCatalog"], output_path)
    report = discovery.get("report") or {}
    counts_by_route = report.get("counts_by_route_corpus") or {}
    counts_by_confidence = report.get("counts_by_confidence_tier") or {}
    totals = report.get("totals") or {}
    files = discovery.get("files") or {}
    print(f"references\tdiscover-citation-led\trun-id\t{discovery.get('runId')}")
    print(f"references\tdiscover-citation-led\tanchors\t{discovery.get('anchorsCount')}")
    print(f"references\tdiscover-citation-led\traw\t{discovery.get('rawCount')}")
    print(f"references\tdiscover-citation-led\tscored\t{discovery.get('scoredCount')}")
    print(f"references\tdiscover-citation-led\tranked\t{discovery.get('rankedCount')}")
    print(f"references\tdiscover-citation-led\tresearch\t{counts_by_route.get('AI-ML-research', 0)}")
    print(f"references\tdiscover-citation-led\tjournalism\t{counts_by_route.get('AI-ML-journalism', 0)}")
    print(f"references\tdiscover-citation-led\thigh\t{counts_by_confidence.get('high', 0)}")
    print(f"references\tdiscover-citation-led\tmedium\t{counts_by_confidence.get('medium', 0)}")
    print(f"references\tdiscover-citation-led\tlow\t{counts_by_confidence.get('low', 0)}")
    print(f"references\tdiscover-citation-led\terrors\t{totals.get('errors', 0)}")
    print(f"references\tdiscover-citation-led\tanchors-file\t{files.get('anchors')}")
    print(f"references\tdiscover-citation-led\traw-file\t{files.get('raw')}")
    print(f"references\tdiscover-citation-led\tscored-file\t{files.get('scored')}")
    print(f"references\tdiscover-citation-led\tranked-file\t{files.get('rankedCatalog')}")
    print(f"references\tdiscover-citation-led\treport-file\t{files.get('report')}")
    if options.get("output"):
        print(f"references\tdiscover-citation-led\toutput\t{options['output']}")

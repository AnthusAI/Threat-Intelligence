from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from papyrus_content.graphql_authoring import create_authoring_client
from papyrus_content.records import apply_record_changes, build_record_changes_targeted_by_id
from papyrus_content.seed_edition import (
    compact_dict,
    published_item_id,
    record,
    to_aws_json,
    with_version_fields,
)
from publications.threat_intelligence.videoml.video_pipeline import (
    EDITION_OVERVIEW_SLUG,
    build_babulus_xml,
    build_edition_overview_xml,
    lead_video_articles,
    load_ti_seed_payload,
    resolve_openai_tts_defaults,
    retheme_vml_xml,
)

VideoScriptTargetKind = Literal["article", "edition"]


def videoml_target_slug(target_slug: str) -> str:
    normalized = target_slug.strip()
    if not normalized:
        raise ValueError("Video target slug is required.")
    return normalized


def videoml_item_slug(target_slug: str) -> str:
    return f"{videoml_target_slug(target_slug)}--videoml"


def videoml_item_id(target_slug: str) -> str:
    return f"item-videoml-{videoml_target_slug(target_slug)}"


def build_video_script_editorial(
    *,
    dsl: str,
    target_kind: VideoScriptTargetKind,
    target_slug: str,
    edition_lineage_id: str | None = None,
    generated_from_article_version: int | None = None,
) -> dict[str, Any]:
    target: dict[str, Any] = {"kind": target_kind}
    if target_kind == "article":
        target["articleSlug"] = target_slug
    if edition_lineage_id:
        target["editionLineageId"] = edition_lineage_id
    payload: dict[str, Any] = {
        "dsl": dsl,
        "theme": "both",
        "target": target,
    }
    if generated_from_article_version is not None:
        payload["generatedFromArticleVersion"] = generated_from_article_version
    return payload


def parse_video_script_editorial(editorial: Any) -> dict[str, Any] | None:
    if editorial is None:
        return None
    if isinstance(editorial, str):
        try:
            editorial = json.loads(editorial)
        except json.JSONDecodeError:
            return None
    if not isinstance(editorial, dict):
        return None
    video_script = editorial.get("videoScript")
    if not isinstance(video_script, dict):
        return None
    dsl = video_script.get("dsl")
    if not isinstance(dsl, str) or not dsl.strip():
        return None
    return video_script


def build_videoml_item_records(
    *,
    target_slug: str,
    target_kind: VideoScriptTargetKind,
    dsl: str,
    headline: str,
    section: str | None,
    published_at: str,
    edition_date: str,
    edition_lineage_id: str | None = None,
) -> list[dict[str, Any]]:
    item_id = videoml_item_id(target_slug)
    slug = videoml_item_slug(target_slug)
    section_slug = (section or "general").lower().replace(" ", "-")
    editorial_payload = build_video_script_editorial(
        dsl=dsl,
        target_kind=target_kind,
        target_slug=target_slug,
        edition_lineage_id=edition_lineage_id,
    )
    item_record = with_version_fields(
        compact_dict(
            {
                "id": item_id,
                "type": "videoml",
                "status": "published",
                "typeStatus": "videoml#published",
                "slug": slug,
                "section": section,
                "sectionStatus": f"{section_slug}#published",
                "title": headline,
                "headline": headline,
                "deck": "VideoML script",
                "body": [],
                "publishedAt": published_at,
                "editionDate": edition_date,
                "sortTitle": headline,
                "editorial": to_aws_json({"videoScript": editorial_payload}),
            }
        ),
        lineage_id=item_id,
        version_created_at=published_at,
        version_created_by="papyrus-videos",
        change_reason="videoml script upsert",
    )
    published_record = compact_dict(
        {
            "id": published_item_id(item_id),
            "sourceItemId": item_record["id"],
            "itemLineageId": item_record["lineageId"],
            "versionNumber": item_record["versionNumber"],
            "type": "videoml",
            "status": "published",
            "typeStatus": "videoml#published",
            "slug": slug,
            "section": section,
            "sectionStatus": f"{section_slug}#published",
            "title": headline,
            "headline": headline,
            "deck": "VideoML script",
            "body": [],
            "publishedAt": published_at,
            "editionDate": edition_date,
            "sortTitle": headline,
            "editorial": to_aws_json({"videoScript": editorial_payload}),
        }
    )
    return [record("Item", item_record), record("PublishedItem", published_record)]


def upsert_videoml_records(records: list[dict[str, Any]]) -> dict[str, int]:
    client, _claims = create_authoring_client()
    changes = build_record_changes_targeted_by_id(client, records)
    apply_record_changes(client, changes)
    summary = {"create": 0, "update": 0, "noop": 0}
    for change in changes:
        action = str(change.get("action") or "noop")
        summary[action] = summary.get(action, 0) + 1
    return summary


def fetch_videoml_dsl(client: Any, target_slug: str) -> str | None:
    item = client.get_record("Item", videoml_item_id(target_slug))
    if not item:
        published = client.get_record("PublishedItem", published_item_id(videoml_item_id(target_slug)))
        if published:
            item = published
    if not item:
        return None
    video_script = parse_video_script_editorial(item.get("editorial"))
    if not video_script:
        return None
    return str(video_script["dsl"])


def update_videoml_dsl(target_slug: str, dsl: str) -> dict[str, Any]:
    client, _claims = create_authoring_client()
    item_id = videoml_item_id(target_slug)
    current = client.get_record("Item", item_id)
    if not current:
        raise ValueError(f"No videoml Item exists for target '{target_slug}'. Run `poetry run papyrus videos generate-dsl` first.")

    video_script = parse_video_script_editorial(current.get("editorial")) or {}
    target = video_script.get("target") if isinstance(video_script.get("target"), dict) else {"kind": "article", "articleSlug": target_slug}
    editorial_payload = build_video_script_editorial(
        dsl=dsl,
        target_kind=str(target.get("kind") or "article"),  # type: ignore[arg-type]
        target_slug=target_slug,
        edition_lineage_id=str(target.get("editionLineageId") or "") or None,
        generated_from_article_version=(
            int(video_script["generatedFromArticleVersion"])
            if isinstance(video_script.get("generatedFromArticleVersion"), int)
            else None
        ),
    )
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    updated_item = {
        **current,
        "editorial": to_aws_json({"videoScript": editorial_payload}),
        "updatedAt": now,
    }
    updated_published = {
        **(client.get_record("PublishedItem", published_item_id(item_id)) or {}),
        "id": published_item_id(item_id),
        "sourceItemId": item_id,
        "editorial": to_aws_json({"videoScript": editorial_payload}),
    }
    records = [record("Item", updated_item), record("PublishedItem", compact_dict(updated_published))]
    summary = upsert_videoml_records(records)
    return {"ok": True, "slug": videoml_item_slug(target_slug), "changes": summary}


def generate_article_videoml_dsl(article: dict[str, Any], *, theme: str = "dark") -> str:
    defaults = resolve_openai_tts_defaults()
    payload = load_ti_seed_payload()
    return build_babulus_xml(
        article,
        voice=str(defaults["voice"]),
        model=str(defaults["model"]),
        publish_date=str(payload.get("publishDate") or "").strip() or None,
        theme=theme,
    )


def generate_edition_videoml_dsl(payload: dict[str, Any] | None = None, *, theme: str = "dark") -> str:
    defaults = resolve_openai_tts_defaults()
    edition = payload if payload is not None else load_ti_seed_payload()
    return build_edition_overview_xml(
        edition,
        voice=str(defaults["voice"]),
        model=str(defaults["model"]),
        theme=theme,
    )


def generate_videoml_items_from_seed(*, edition_lineage_id: str | None = None) -> list[dict[str, Any]]:
    payload = load_ti_seed_payload()
    publish_date = str(payload.get("publishDate") or "2026-07-04").strip()
    published_at = f"{publish_date}T12:00:00.000Z"
    edition_id = edition_lineage_id or str(payload.get("id") or "edition-current")
    records: list[dict[str, Any]] = []

    edition_dsl = generate_edition_videoml_dsl(payload)
    records.extend(
        build_videoml_item_records(
            target_slug=EDITION_OVERVIEW_SLUG,
            target_kind="edition",
            dsl=edition_dsl,
            headline=str(payload.get("title") or "Edition overview"),
            section="Edition",
            published_at=published_at,
            edition_date=publish_date,
            edition_lineage_id=edition_id,
        )
    )

    for article in lead_video_articles():
        slug = str(article.get("slug") or "").strip()
        if not slug:
            continue
        records.extend(
            build_videoml_item_records(
                target_slug=slug,
                target_kind="article",
                dsl=generate_article_videoml_dsl(article),
                headline=str(article.get("headline") or slug),
                section=str(article.get("section") or "Anthus Threat Intelligence"),
                published_at=published_at,
                edition_date=publish_date,
                edition_lineage_id=edition_id,
            )
        )
    return records


def resolve_videoml_dsl_for_render(
    *,
    target_slug: str,
    theme: str,
    from_article: bool,
    article: dict[str, Any] | None = None,
    edition_payload: dict[str, Any] | None = None,
) -> str:
    if not from_article:
        client, _claims = create_authoring_client()
        stored = fetch_videoml_dsl(client, target_slug)
        if stored:
            return retheme_vml_xml(stored, theme)
    if target_slug == EDITION_OVERVIEW_SLUG:
        return generate_edition_videoml_dsl(edition_payload, theme=theme)
    if article is None:
        raise ValueError(f"Article payload is required to render '{target_slug}' from article copy.")
    return generate_article_videoml_dsl(article, theme=theme)

from __future__ import annotations

import json

from .env import load_dotenv
from .options import normalize_string, parse_boolean_option, parse_options
from .video_pipeline import (
    article_output_mp4,
    edition_overview_output_mp4,
    lead_video_articles,
    load_ti_seed_articles,
    load_ti_seed_payload,
    probe_openai_key,
    render_edition_overview,
    render_video,
)


def videos_render(flags: list[str]) -> None:
    options = parse_options(flags)
    slug = normalize_string(options.get("article"))
    edition_overview = parse_boolean_option(options.get("edition-overview"), False, "--edition-overview")
    if edition_overview:
        probe = parse_boolean_option(options.get("probe-only"), False, "--probe-only")
        if probe:
            print(json.dumps({"probe": probe_openai_key()}, indent=2))
            return
        probe_openai_key()
        output = render_edition_overview()
        print(json.dumps({"ok": True, "slug": "edition-overview", "output": str(output)}, indent=2))
        return

    if not slug:
        raise ValueError("videos render requires --article <slug> or --edition-overview.")

    articles = load_ti_seed_articles()
    article = next((entry for entry in articles if str(entry.get("slug", "")).strip() == slug), None)
    if article is None:
        raise ValueError(f"Article '{slug}' was not found in the Threat Intelligence seed edition.")

    probe = parse_boolean_option(options.get("probe-only"), False, "--probe-only")
    if probe:
        print(json.dumps({"probe": probe_openai_key()}, indent=2))
        return

    probe_openai_key()
    output = render_video(article)
    print(json.dumps({"ok": True, "slug": slug, "output": str(output)}, indent=2))


def videos_seed(flags: list[str]) -> None:
    options = parse_options(flags)
    probe_only = parse_boolean_option(options.get("probe-only"), False, "--probe-only")
    if probe_only:
        print(json.dumps({"probe": probe_openai_key()}, indent=2))
        return

    probe_openai_key()
    rendered: list[dict[str, str]] = []
    overview_output = render_edition_overview(payload=load_ti_seed_payload())
    rendered.append({"slug": "edition-overview", "output": str(overview_output)})
    for article in lead_video_articles():
        slug = str(article.get("slug", "")).strip()
        output = render_video(article)
        rendered.append({"slug": slug, "output": str(output)})

    print(
        json.dumps(
            {
                "ok": True,
                "count": len(rendered),
                "videos": rendered,
            },
            indent=2,
        )
    )


def videos_attach(flags: list[str]) -> None:
    options = parse_options(flags)
    slug = normalize_string(options.get("article"))
    if not slug:
        raise ValueError("videos attach requires --article <slug>.")

    load_dotenv()
    from .graphql_authoring import create_authoring_client
    from .records import apply_record_changes, build_record_changes_targeted_by_id
    from .seed_edition import build_seed_edition_records, load_seed_payload, resolve_seed_content_path

    seed_path, _profile = resolve_seed_content_path({"profile": "threat-intelligence"})
    payload = load_seed_payload(seed_path)
    article = next((entry for entry in payload["articles"] if str(entry.get("slug", "")).strip() == slug), None)
    if article is None:
        raise ValueError(f"Article '{slug}' was not found in seed edition content.")

    mp4 = article_output_mp4(article)
    if not mp4.exists():
        raise ValueError(f"Rendered video not found at {mp4}. Run `poetry run papyrus videos render --article {slug}` first.")

    records = build_seed_edition_records(payload)
    client, _claims = create_authoring_client()
    changes = build_record_changes_targeted_by_id(client, records)
    apply_record_changes(client, changes)
    print(json.dumps({"ok": True, "slug": slug, "attachedVia": "content seed-edition records refresh"}, indent=2))

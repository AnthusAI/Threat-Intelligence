from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from papyrus_content.env import PAPYRUS_ROOT, load_dotenv
from papyrus_content.papyrus_config import resolve_openai_api_key, resolve_openai_tts_defaults

DEFAULT_VIDEOML_CLI = Path.home() / "Projects" / "VideoML" / "cli"
DEFAULT_BABULUS_ROOT = Path.home() / "Projects" / "Babulus"
TI_BROWSER_BUNDLE = PAPYRUS_ROOT / "public" / "videoml" / "ti-browser-bundle.js"
TI_SEED_PROFILE = "threat-intelligence"
TI_VIDEO_OUTPUT_DIR = PAPYRUS_ROOT / "public" / "seed-art" / "threat-intelligence" / "videos"
TI_SEED_CONTENT_PATH = (
    PAPYRUS_ROOT / "publications" / "threat_intelligence" / "seed" / "seed-edition-content.json"
)
EDITION_OVERVIEW_SLUG = "edition-overview"
LEAD_VIDEO_SLUGS = (
    "the-balance-of-power-is-shifting",
    "how-our-newsroom-learns",
    "audit-aws-exposure-before-attackers-do",
    "audit-azure-blast-radius-before-attackers-do",
    "treat-openai-accounts-like-production-infrastructure",
    "how-to-play-games-securely",
)

# Video canvas rhythm: 24px rows on the 720px-tall frame (30 rows).
TI_VIDEO_RHYTHM_UNIT = 6
TI_VIDEO_COPY_ROW_MULTIPLE = 4
TI_VIDEO_ROW_HEIGHT = TI_VIDEO_RHYTHM_UNIT * TI_VIDEO_COPY_ROW_MULTIPLE
TI_VIDEO_PAINT_BUFFER = 3


def ti_video_rows(rows: int) -> int:
    return rows * TI_VIDEO_ROW_HEIGHT


TI_VIDEO_LAYOUT = {
    "padding": ti_video_rows(4),
    "gap": ti_video_rows(1),
    "column_gap": ti_video_rows(2),
    "eyebrow_size": ti_video_rows(1),
    "title_size": ti_video_rows(3),
    "title_size_briefing": ti_video_rows(2),
    "title_size_teaser": ti_video_rows(2),
    "subtitle_size": ti_video_rows(1),
    "subtitle_size_closing": ti_video_rows(2),
    "closing_title_size": ti_video_rows(4),
    "pictogram_size": ti_video_rows(18),
    "pictogram_size_briefing": ti_video_rows(15),
    "pictogram_size_edition": ti_video_rows(18),
    "title_line_height": ti_video_rows(3),
    "subtitle_line_height": ti_video_rows(2),
}


def ti_video_rhythm_vars() -> dict[str, str]:
    return {
        "--ti-rhythm": f"{TI_VIDEO_RHYTHM_UNIT}px",
        "--ti-row-height": f"{TI_VIDEO_ROW_HEIGHT}px",
        "--ti-paint-buffer": f"{TI_VIDEO_PAINT_BUFFER}px",
        "--ti-paint-height": f"{TI_VIDEO_ROW_HEIGHT + TI_VIDEO_PAINT_BUFFER}px",
    }


def _merge_scene_style_vars(base: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged["vars"] = {**ti_video_rhythm_vars(), **dict(base.get("vars") or {})}
    return merged


TI_SCENE_STYLES_DARK: dict[str, Any] = _merge_scene_style_vars({
    "background": "#111110",
    "color": "#eeeeec",
    "vars": {
        "--color-bg": "#111110",
        "--color-bg-subtle": "#191918",
        "--color-surface": "#111110",
        "--color-surface-strong": "#222221",
        "--color-text": "#eeeeec",
        "--color-text-muted": "#b5b3ad",
        "--color-primary": "#eeeeec",
        "--color-accent": "#e54d2e",
        "--color-secondary": "#222221",
        "--ti-section-rule": "#e54d2e",
        "--ti-alarm-red": "#e54d2e",
        "--ti-headline-color": "#eeeeec",
        "--ti-body-color": "#b5b3ad",
        "--ti-cta-red": "#e54d2e",
        "--ti-cta-background": "#853a2d",
        "--ti-cta-foreground": "#eeeeec",
        "--ti-inverted-alert": "#ff977d",
        "--background": "#111110",
        "--foreground": "#b5b3ad",
        "--foreground-strong": "#eeeeec",
        "--foreground-muted": "#7c7b74",
        "--extra-muted-foreground": "#3b3a37",
        "--faintly-muted": "#222221",
        "--ti-hrule-foreground": "#3b3a37",
        "--ti-pictogram-edge": "#363a3f",
        "--ti-pictogram-node": "#2e3135",
        "--ti-pictogram-muted": "#43484e",
        "--ti-pictogram-throb": "#ac4d39",
        "--ti-pictogram-compromised": "#e54d2e",
        "--ti-pictogram-accent-glow": "rgba(251, 146, 60, 0.2)",
        "--grass-8": "#30a46c",
        "--amber-8": "#f59e0b",
        "--sand-8": "#62605b",
        "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
        "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
        "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    },
})

TI_BACKGROUND_PROPS_DARK: dict[str, Any] = {
    "variant": "solid",
    "color": "#111110",
}

# Matches Threat Intelligence blog light mode (Radix sand-light + tomato-9 accent).
# Uses the same --sand-1 / --sand-12 / --tomato-9 scale as the website.
TI_SCENE_STYLES_LIGHT: dict[str, Any] = _merge_scene_style_vars({
    "background": "#fdfdfc",
    "color": "#21201c",
    "vars": {
        "--color-bg": "#fdfdfc",
        "--color-bg-subtle": "#f9f9f8",
        "--color-surface": "#fdfdfc",
        "--color-surface-strong": "#f1f0ef",
        "--color-text": "#21201c",
        "--color-text-muted": "#63635e",
        "--color-primary": "#21201c",
        "--color-accent": "#e54d2e",
        "--color-secondary": "#f1f0ef",
        "--ti-section-rule": "#e54d2e",
        "--ti-alarm-red": "#e54d2e",
        "--ti-headline-color": "#21201c",
        "--ti-body-color": "#63635e",
        "--ti-cta-red": "#e54d2e",
        "--ti-cta-background": "#e54d2e",
        "--ti-cta-foreground": "#fdfdfc",
        "--ti-inverted-alert": "#e54d2e",
        "--background": "#fdfdfc",
        "--foreground": "#63635e",
        "--foreground-strong": "#21201c",
        "--foreground-muted": "#82827c",
        "--extra-muted-foreground": "#cfceca",
        "--faintly-muted": "#f1f0ef",
        "--ti-hrule-foreground": "#cfceca",
        "--ti-pictogram-edge": "#b9bbc6",
        "--ti-pictogram-node": "#b9bbc6",
        "--ti-pictogram-muted": "#d9d9e0",
        "--ti-pictogram-throb": "#ec8e7b",
        "--ti-pictogram-compromised": "#e54d2e",
        "--ti-pictogram-accent-glow": "rgba(234, 88, 12, 0.18)",
        "--grass-8": "#30a46c",
        "--amber-8": "#f59e0b",
        "--sand-8": "#bcbbb5",
        "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
        "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
        "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    },
})

TI_BACKGROUND_PROPS_LIGHT: dict[str, Any] = {
    "variant": "solid",
    "color": "#fdfdfc",
}

# Backward-compatible aliases (dark is the default theme).
TI_SCENE_STYLES = TI_SCENE_STYLES_DARK
TI_BACKGROUND_PROPS = TI_BACKGROUND_PROPS_DARK

THEMES = ("dark", "light")


def scene_styles_for_theme(theme: str) -> dict[str, Any]:
    return TI_SCENE_STYLES_LIGHT if theme == "light" else TI_SCENE_STYLES_DARK


def background_props_for_theme(theme: str) -> dict[str, Any]:
    return TI_BACKGROUND_PROPS_LIGHT if theme == "light" else TI_BACKGROUND_PROPS_DARK


def retheme_vml_xml(dsl_xml: str, theme: str) -> str:
    if theme == "dark":
        return dsl_xml
    updated = dsl_xml.replace(props_attr(TI_SCENE_STYLES_DARK), props_attr(TI_SCENE_STYLES_LIGHT))
    updated = updated.replace(props_attr(TI_BACKGROUND_PROPS_DARK), props_attr(TI_BACKGROUND_PROPS_LIGHT))
    if any(token in updated for token in ("#111110", "#191918", "#222221", "#2a2926")):
        updated = _swap_ti_light_palette_tokens(updated)
    return updated


def _swap_ti_light_palette_tokens(dsl_xml: str) -> str:
    # Context-aware fixes for legacy dark palette tokens whose hex values
    # collide with new light palette tokens.  #21201c was the old dark
    # --color-surface but is also the new light --color-text / --foreground-
    # strong (sand-12 light).  A blind global replace would turn light text
    # into the light background.  Swap only within the specific CSS variable
    # keys where the old dark value appeared.
    targeted = (
        ('"--color-surface":"#21201c"', '"--color-surface":"#fdfdfc"'),
        ('"--color-surface-strong":"#2a2926"', '"--color-surface-strong":"#f1f0ef"'),
        ('"--color-secondary":"#7f7e77"', '"--color-secondary":"#f1f0ef"'),
        ('"--sand-8":"#9090a0"', '"--sand-8":"#bcbbb5"'),
    )
    updated = dsl_xml
    for dark, light in targeted:
        updated = updated.replace(dark, light)

    # Unambiguous dark -> light mappings (safe to replace globally).
    replacements = (
        ("rgba(251, 146, 60, 0.2)", "rgba(234, 88, 12, 0.18)"),
        ("#111110", "#fdfdfc"),
        ("#191918", "#f9f9f8"),
        ("#222221", "#f1f0ef"),
        ("#2a2a28", "#e9e8e6"),
        ("#2a2926", "#f1f0ef"),
        ("#3b3a37", "#cfceca"),
        ("#7c7b74", "#82827c"),
        ("#b5b3ad", "#63635e"),
        ("#eeeeec", "#21201c"),
        ("#62605b", "#bcbbb5"),
        ("#7f7e77", "#f1f0ef"),
        ("#853a2d", "#e54d2e"),
        ("#ff977d", "#e54d2e"),
        ("#363a3f", "#b9bbc6"),
        ("#2e3135", "#b9bbc6"),
        ("#43484e", "#d9d9e0"),
        ("#ac4d39", "#ec8e7b"),
        ("#9090a0", "#bcbbb5"),
    )
    for dark_token, light_token in replacements:
        updated = updated.replace(dark_token, light_token)
    return updated
    updated = dsl_xml
    for dark_token, light_token in replacements:
        updated = updated.replace(dark_token, light_token)
    return updated

TI_TAGLINE = "Practical advice for staying secure as the threat landscape shifts."


def load_ti_seed_payload() -> dict[str, Any]:
    payload = json.loads(TI_SEED_CONTENT_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Seed content at {TI_SEED_CONTENT_PATH} must be a JSON object.")
    return payload


def load_ti_seed_articles() -> list[dict[str, Any]]:
    payload = load_ti_seed_payload()
    articles = payload.get("articles")
    if not isinstance(articles, list):
        raise ValueError(f"Seed content at {TI_SEED_CONTENT_PATH} must define articles as an array.")
    return [article for article in articles if isinstance(article, dict)]


def lead_video_articles(articles: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    source = articles if articles is not None else load_ti_seed_articles()
    selected = [article for article in source if str(article.get("slug", "")).strip() in LEAD_VIDEO_SLUGS]
    if not selected:
        raise ValueError("No lead-video articles found in the Threat Intelligence seed edition.")
    order = {slug: index for index, slug in enumerate(LEAD_VIDEO_SLUGS)}
    selected.sort(key=lambda article: order.get(str(article.get("slug", "")).strip(), 999))
    return selected


def article_output_mp4(article: dict[str, Any], *, output_dir: Path | None = None, theme: str = "dark") -> Path:
    slug = str(article.get("slug", "")).strip()
    if not slug:
        raise ValueError("Seed article is missing slug.")
    target_dir = output_dir or TI_VIDEO_OUTPUT_DIR
    suffix = "-light" if theme == "light" else ""
    return target_dir / f"{slug}{suffix}.mp4"


def edition_overview_output_mp4(*, output_dir: Path | None = None, theme: str = "dark") -> Path:
    target_dir = output_dir or TI_VIDEO_OUTPUT_DIR
    suffix = "-light" if theme == "light" else ""
    return target_dir / f"{EDITION_OVERVIEW_SLUG}{suffix}.mp4"


def props_attr(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    # Emitted inside single-quoted XML attributes: escape the quote character
    # (and angle brackets) or an apostrophe in content breaks the attribute.
    return raw.replace("&", "&amp;").replace("'", "&#39;").replace("<", "&lt;")


def truncate_display(text: str, max_len: int = 240) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_len:
        return cleaned
    trimmed = cleaned[: max_len - 1].rsplit(" ", 1)[0]
    return f"{trimmed}…"


def first_sentence(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        return ""
    match = re.split(r"(?<=[.!?])\s+", cleaned, maxsplit=1)
    return match[0]


def ensure_videoml_browser_bundle() -> Path:
    if not TI_BROWSER_BUNDLE.exists():
        build_script = PAPYRUS_ROOT / "scripts" / "videoml" / "build-browser-bundle.mjs"
        if not build_script.exists():
            raise ValueError(f"VideoML browser bundle is missing and build script was not found: {build_script}")
        result = subprocess.run(
            ["npm", "run", "videoml:bundle"],
            cwd=str(PAPYRUS_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Failed to build the Threat Intelligence VideoML browser bundle.\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
    if not TI_BROWSER_BUNDLE.exists():
        raise ValueError(f"VideoML browser bundle is missing at {TI_BROWSER_BUNDLE}. Run npm run videoml:bundle.")
    return TI_BROWSER_BUNDLE


def title_slide_layer(
    *,
    pictogram_slug: str | None = None,
    eyebrow: str | None = None,
    masthead_eyebrow: str | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    title_word_split: bool = False,
    horizontal_align: str = "left",
    logo_size: int | None = None,
    title_size: int | None = None,
    subtitle_size: int | None = None,
    title_color: str | None = None,
    title_weight: int | None = None,
    eyebrow_weight: int | None = None,
    eyebrow_letter_spacing: float | None = None,
    eyebrow_size: int | None = None,
    eyebrow_rule: bool = False,
    padding: int | None = None,
    gap: int | None = None,
    column_gap: int | None = None,
    title_line_height: int | None = None,
    subtitle_line_height: int | None = None,
) -> str:
    props: dict[str, Any] = {
        "verticalAlign": "center",
        "horizontalAlign": horizontal_align,
        "entranceStartFrame": -999,
        "background": "transparent",
        "padding": padding if padding is not None else TI_VIDEO_LAYOUT["padding"],
        "gap": gap if gap is not None else TI_VIDEO_LAYOUT["gap"],
        "columnGap": column_gap if column_gap is not None else TI_VIDEO_LAYOUT["column_gap"],
        "titleSize": title_size if title_size is not None else TI_VIDEO_LAYOUT["title_size"],
        "subtitleSize": subtitle_size if subtitle_size is not None else TI_VIDEO_LAYOUT["subtitle_size"],
        "titleLineHeight": title_line_height if title_line_height is not None else TI_VIDEO_LAYOUT["title_line_height"],
        "subtitleLineHeight": subtitle_line_height if subtitle_line_height is not None else TI_VIDEO_LAYOUT["subtitle_line_height"],
    }
    if eyebrow:
        props["eyebrow"] = eyebrow
    if masthead_eyebrow:
        props["mastheadEyebrow"] = masthead_eyebrow
    if title:
        props["title"] = title
    if subtitle:
        props["subtitle"] = subtitle
    if title_word_split:
        props["titleWordSplit"] = True
    if title_color:
        props["titleColor"] = title_color
    if title_weight is not None:
        props["titleWeight"] = title_weight
    if eyebrow_weight is not None:
        props["eyebrowWeight"] = eyebrow_weight
    if eyebrow_letter_spacing is not None:
        props["eyebrowLetterSpacing"] = eyebrow_letter_spacing
    resolved_eyebrow_size = eyebrow_size if eyebrow_size is not None else TI_VIDEO_LAYOUT["eyebrow_size"]
    if resolved_eyebrow_size != TI_VIDEO_LAYOUT["eyebrow_size"]:
        props["eyebrowSize"] = resolved_eyebrow_size
    if eyebrow_rule:
        props["eyebrowRule"] = True
    if pictogram_slug:
        props["pictogramSlug"] = pictogram_slug
        props["pictogramSize"] = logo_size if logo_size is not None else TI_VIDEO_LAYOUT["pictogram_size"]
    tag = "ti-title-slide" if (pictogram_slug or eyebrow_rule or masthead_eyebrow) else "title-slide"
    return f"""    <layer id="content" z="10">
      <{tag} props='{props_attr(props)}' />
    </layer>"""


def quote_card_layer(
    *,
    quote: str,
    attribution: str = "",
    accent_color: str = "var(--ti-alarm-red)",
    quote_size: int | None = None,
    quote_line_height: int | None = None,
) -> str:
    props: dict[str, Any] = {
        "quote": quote,
        "accentColor": accent_color,
    }
    if attribution:
        props["attribution"] = attribution
    if quote_size is not None:
        props["quoteSize"] = quote_size
    if quote_line_height is not None:
        props["quoteLineHeight"] = quote_line_height
    return f"""    <layer id="content" z="10">
      <ti-quote-card props='{props_attr(props)}' />
    </layer>"""


def closing_cta_layer(*, slide_date: str) -> str:
    return title_slide_layer(
        masthead_eyebrow="Anthus AI Solutions",
        title="THREAT INTELLIGENCE",
        title_word_split=True,
        subtitle=TI_TAGLINE,
        horizontal_align="center",
        title_size=TI_VIDEO_LAYOUT["closing_title_size"],
        subtitle_size=TI_VIDEO_LAYOUT["subtitle_size_closing"],
        title_color="var(--ti-alarm-red)",
        title_weight=900,
    )


def closing_cta_voice(slide_date: str) -> str:
    return f"To learn more, check out the {slide_date} edition of Anthus Threat Intelligence. {TI_TAGLINE}"


def render_scene(
    scene_id: str,
    scene_title: str,
    content_layer: str,
    cue_xml: str,
    *,
    styles: dict[str, Any] | None = None,
    background_props: dict[str, Any] | None = None,
) -> str:
    resolved_styles = styles if styles is not None else TI_SCENE_STYLES_DARK
    resolved_background = background_props if background_props is not None else TI_BACKGROUND_PROPS_DARK
    return f"""  <scene id="{escape(scene_id)}" title="{escape(scene_title)}" styles='{props_attr(resolved_styles)}'>
    <layer id="background" z="0">
      <video-background props='{props_attr(resolved_background)}' />
    </layer>
{content_layer}
    {cue_xml}
  </scene>"""


def format_voice_edition_date(publish_date: str) -> str:
    try:
        parsed = date.fromisoformat(publish_date)
    except ValueError:
        return publish_date
    month = parsed.strftime("%B")
    day = parsed.day
    suffix = "th"
    if day % 10 == 1 and day != 11:
        suffix = "st"
    elif day % 10 == 2 and day != 12:
        suffix = "nd"
    elif day % 10 == 3 and day != 13:
        suffix = "rd"
    return f"{month} {day}{suffix}, {parsed.year}"


def format_slide_edition_date(publish_date: str) -> str:
    try:
        parsed = date.fromisoformat(publish_date)
    except ValueError:
        return publish_date
    return f"{parsed.strftime('%B')} {parsed.day}, {parsed.year}"


def resolve_publish_date(publish_date: str | None = None) -> str:
    if publish_date and publish_date.strip():
        return publish_date.strip()
    return str(load_ti_seed_payload().get("publishDate") or "2026-07-04").strip()


def branded_title_slide_layer(
    *,
    pictogram_slug: str | None,
    eyebrow: str | None,
    title: str | None,
    subtitle: str | None,
    horizontal_align: str = "left",
    logo_size: int | None = None,
    title_size: int | None = None,
    subtitle_size: int | None = None,
) -> str:
    return title_slide_layer(
        pictogram_slug=pictogram_slug,
        eyebrow=eyebrow,
        title=title,
        subtitle=subtitle,
        horizontal_align=horizontal_align,
        logo_size=logo_size,
        title_size=title_size,
        subtitle_size=subtitle_size,
        title_weight=900,
        eyebrow_weight=900,
        eyebrow_letter_spacing=0.09,
        eyebrow_rule=True,
    )


def authored_video_scenes(video_meta: Any) -> list[dict[str, Any]]:
    if not isinstance(video_meta, dict):
        return []
    scenes = video_meta.get("scenes")
    if not isinstance(scenes, list):
        return []
    return [scene for scene in scenes if isinstance(scene, dict)]


def authored_scene_xml(
    scene: dict[str, Any],
    index: int,
    *,
    scene_renderer,
    default_quote_size: int | None = None,
    default_quote_line_height: int | None = None,
) -> str:
    kind = str(scene.get("kind") or "slide").strip().lower()
    voice_text = str(scene.get("voice") or "").strip()
    if not voice_text:
        raise ValueError(f"Authored video scene {index} is missing voice narration.")
    scene_id = f"scene-{index}"
    cue = f"""<cue id="{scene_id}-cue">
      <voice>{escape(voice_text)}</voice>
    </cue>"""
    if kind == "quote":
        quote = str(scene.get("quote") or "").strip()
        if not quote:
            raise ValueError(f"Authored quote scene {index} is missing its quote text.")
        attribution = str(scene.get("attribution") or "").strip()
        scene_quote_size = scene.get("quoteSize") or scene.get("quote_size")
        scene_quote_line_height = scene.get("quoteLineHeight") or scene.get("quote_line_height")
        quote_size = int(scene_quote_size) if scene_quote_size else default_quote_size
        quote_line_height = (
            int(scene_quote_line_height) if scene_quote_line_height else default_quote_line_height
        )
        layer = quote_card_layer(
            quote=quote,
            attribution=attribution,
            quote_size=quote_size,
            quote_line_height=quote_line_height,
        )
        return scene_renderer(scene_id, str(scene.get("title") or "Quote"), layer, cue)
    if kind != "slide":
        raise ValueError(f"Authored video scene {index} has unknown kind: {kind!r}")
    layer = branded_title_slide_layer(
        pictogram_slug=str(scene.get("pictogram") or "").strip() or None,
        eyebrow=str(scene.get("eyebrow") or "").strip() or None,
        title=str(scene.get("title") or "").strip() or None,
        subtitle=str(scene.get("subtitle") or "").strip() or None,
        horizontal_align="left",
    )
    return scene_renderer(scene_id, str(scene.get("title") or f"Scene {index}"), layer, cue)


def post_roll_scene(slide_date: str, scene_renderer, voice_text: str | None = None) -> str:
    """The standardized branding block. Appended by the pipeline to every
    scenes-driven video; never authored per-video. The end screen never varies;
    the spoken line over it may be overridden via the seed `video.postRollVoice`
    when a video's narrative needs a custom closing CTA."""
    resolved_voice = (voice_text or "").strip() or closing_cta_voice(slide_date)
    return scene_renderer(
        "post-roll",
        "Post-roll",
        closing_cta_layer(slide_date=slide_date),
        f"""<cue id="post-roll-cue">
      <voice>{escape(resolved_voice)}</voice>
    </cue>""",
    )


def post_roll_voice_override(video_meta: Any) -> str | None:
    if not isinstance(video_meta, dict):
        return None
    override = str(video_meta.get("postRollVoice") or "").strip()
    return override or None


def build_babulus_xml(
    article: dict[str, Any],
    *,
    voice: str,
    model: str,
    publish_date: str | None = None,
    theme: str = "dark",
) -> str:
    slug = slugify(str(article.get("slug") or "article"))
    headline = str(article.get("headline") or slug)
    deck = str(article.get("deck") or "").strip()
    excerpt = str(article.get("excerpt") or "").strip()
    section = str(article.get("section") or "Anthus Threat Intelligence").strip()
    pull_quotes = [str(entry).strip() for entry in (article.get("pullQuotes") or []) if str(entry).strip()][:2]
    pictogram_slug = slug if slug in LEAD_VIDEO_SLUGS else None
    slide_date = format_slide_edition_date(resolve_publish_date(publish_date))
    closing_voice = closing_cta_voice(slide_date)
    styles = scene_styles_for_theme(theme)
    bg_props = background_props_for_theme(theme)

    def _scene(scene_id: str, scene_title: str, content_layer: str, cue_xml: str) -> str:
        return render_scene(scene_id, scene_title, content_layer, cue_xml, styles=styles, background_props=bg_props)

    authored = authored_video_scenes(article.get("video"))
    if authored:
        # Video-form article: authored content scenes, then the standard post-roll.
        scene_blocks = [
            authored_scene_xml(scene, index + 1, scene_renderer=_scene)
            for index, scene in enumerate(authored)
        ]
        scene_blocks.append(post_roll_scene(slide_date, _scene, post_roll_voice_override(article.get("video"))))
        body = "\n\n".join(scene_blocks)
        return f"""<vml id="{escape(slug)}" title="{escape(headline)}" fps="30" width="1280" height="720">
  <voiceover provider="openai" voice="{escape(voice)}" model="{escape(model)}" />

{body}
</vml>
"""

    title_cue_parts = [f"<voice>{escape(headline)}</voice>"]
    if deck:
        title_cue_parts.append('<pause seconds="0.5s" />')
        title_cue_parts.append(f"<voice>{escape(deck)}</voice>")
    title_cue = f"""<cue id="title-cue">
      {"\n      ".join(title_cue_parts)}
    </cue>"""

    scenes: list[str] = []

    if pull_quotes:
        hook_quote = pull_quotes[0]
        scenes.append(
            _scene(
                "hook",
                "Hook",
                quote_card_layer(quote=hook_quote),
                f"""<cue id="hook-cue">
      <voice>{escape(hook_quote)}</voice>
    </cue>""",
            )
        )

    scenes.append(
        _scene(
            "title",
            "Title",
            branded_title_slide_layer(
                pictogram_slug=pictogram_slug,
                eyebrow=section,
                title=headline,
                subtitle=deck or None,
                horizontal_align="left",
                logo_size=TI_VIDEO_LAYOUT["pictogram_size"],
            ),
            title_cue,
        )
    )

    if excerpt:
        scenes.append(
            _scene(
                "body-excerpt",
                "Briefing",
                branded_title_slide_layer(
                    pictogram_slug=pictogram_slug,
                    eyebrow="Briefing",
                    title=headline,
                    subtitle=truncate_display(excerpt),
                    horizontal_align="left",
                    logo_size=TI_VIDEO_LAYOUT["pictogram_size_briefing"],
                    title_size=TI_VIDEO_LAYOUT["title_size_briefing"],
                ),
                f"""<cue id="body-excerpt-cue">
      <voice>{escape(excerpt)}</voice>
    </cue>""",
            )
        )

    if len(pull_quotes) > 1:
        quote = pull_quotes[1]
        voice_line = f'As the article puts it: "{quote}"'
        scenes.append(
            _scene(
                "body-quote-2",
                "Quote 2",
                quote_card_layer(quote=quote),
                f"""<cue id="body-quote-2-cue">
      <voice>{escape(voice_line)}</voice>
    </cue>""",
            )
        )

    scenes.append(
        _scene(
            "closing",
            "Closing",
            closing_cta_layer(slide_date=slide_date),
            f"""<cue id="closing-cue">
      <voice>{escape(closing_voice)}</voice>
    </cue>""",
        )
    )

    body = "\n\n".join(scenes)
    return f"""<vml id="{escape(slug)}" title="{escape(headline)}" fps="30" width="1280" height="720">
  <voiceover provider="openai" voice="{escape(voice)}" model="{escape(model)}" />

{body}
</vml>
"""


def build_edition_overview_xml(
    payload: dict[str, Any] | None = None,
    *,
    voice: str,
    model: str,
    theme: str = "dark",
) -> str:
    edition = payload if payload is not None else load_ti_seed_payload()
    title = str(edition.get("title") or "Anthus Threat Intelligence").strip()
    description = str(edition.get("description") or TI_TAGLINE).strip()
    publish_date = resolve_publish_date(str(edition.get("publishDate") or "").strip() or None)
    slide_date = format_slide_edition_date(publish_date)
    articles = lead_video_articles()
    styles = scene_styles_for_theme(theme)
    bg_props = background_props_for_theme(theme)

    def _scene(scene_id: str, scene_title: str, content_layer: str, cue_xml: str) -> str:
        return render_scene(scene_id, scene_title, content_layer, cue_xml, styles=styles, background_props=bg_props)

    authored = authored_video_scenes(edition.get("video"))
    if authored:
        # Long-format edition video: authored content scenes, then the standard post-roll.
        scene_blocks = [
            authored_scene_xml(
                scene,
                index + 1,
                scene_renderer=_scene,
                default_quote_size=TI_VIDEO_LAYOUT["title_size"],
                default_quote_line_height=ti_video_rows(4),
            )
            for index, scene in enumerate(authored)
        ]
        scene_blocks.append(post_roll_scene(slide_date, _scene, post_roll_voice_override(edition.get("video"))))
        body = "\n\n".join(scene_blocks)
        return f"""<vml id="{escape(EDITION_OVERVIEW_SLUG)}" title="{escape(title)}" fps="30" width="1280" height="720">
  <voiceover provider="openai" voice="{escape(voice)}" model="{escape(model)}" />

{body}
</vml>
"""

    teaser_voice = (
        f"{description} "
        f"This edition features {len(articles)} video briefings with practical checks you can run now."
    )
    closing_voice = closing_cta_voice(slide_date)
    title_voice = f"Anthus Threat Intelligence. {slide_date}. {TI_TAGLINE}"

    first_article = articles[0]
    first_slug = str(first_article.get("slug") or "").strip()
    first_section = str(first_article.get("section") or "Briefing").strip()
    first_pull_quotes = [
        str(entry).strip() for entry in (first_article.get("pullQuotes") or []) if str(entry).strip()
    ]
    first_pictogram_slug = first_slug if first_slug in LEAD_VIDEO_SLUGS else None

    video_meta = edition.get("video") if isinstance(edition.get("video"), dict) else {}
    edition_hook = str((video_meta or {}).get("hook") or "").strip()

    scenes: list[str] = []

    if edition_hook:
        scenes.append(
            _scene(
                "hook",
                "Hook",
                quote_card_layer(
                    quote=edition_hook,
                    quote_size=TI_VIDEO_LAYOUT["title_size"],
                    quote_line_height=ti_video_rows(4),
                ),
                f"""<cue id="hook-cue">
      <voice>{escape(edition_hook)}</voice>
    </cue>""",
            )
        )
    elif first_pull_quotes:
        hook_quote = first_pull_quotes[0]
        scenes.append(
            _scene(
                "hook",
                "Hook",
                quote_card_layer(
                    quote=hook_quote,
                    quote_size=TI_VIDEO_LAYOUT["title_size"],
                    quote_line_height=ti_video_rows(4),
                ),
                f"""<cue id="hook-cue">
      <voice>{escape(hook_quote)}</voice>
    </cue>""",
            )
        )

    scenes.append(
        _scene(
            "title",
            "Title",
            branded_title_slide_layer(
                pictogram_slug=first_pictogram_slug,
                eyebrow="Anthus Threat Intelligence",
                title=title,
                subtitle=TI_TAGLINE,
                horizontal_align="left",
                logo_size=TI_VIDEO_LAYOUT["pictogram_size_edition"],
            ),
            f"""<cue id="title-cue">
      <voice>{escape(title_voice)}</voice>
    </cue>""",
        )
    )

    scenes.append(
        _scene(
            "edition-teaser",
            "Edition teaser",
            title_slide_layer(
                eyebrow=slide_date,
                title="In this edition",
                subtitle=truncate_display(
                    ". ".join(str(article.get("headline") or "").strip() for article in articles if article.get("headline")),
                    220,
                ),
                horizontal_align="left",
                title_size=TI_VIDEO_LAYOUT["title_size_teaser"],
                title_weight=900,
                eyebrow_weight=900,
                eyebrow_letter_spacing=0.09,
                eyebrow_rule=True,
            ),
            f"""<cue id="edition-teaser-cue">
      <voice>{escape(teaser_voice)}</voice>
    </cue>""",
        )
    )

    for index, article in enumerate(articles, start=1):
        slug = str(article.get("slug") or f"spotlight-{index}").strip()
        headline = str(article.get("headline") or slug)
        section = str(article.get("section") or "Briefing").strip()
        excerpt = str(article.get("excerpt") or "").strip()
        hook = first_sentence(excerpt) or str(article.get("deck") or "").strip()
        voice_line = f"{headline}. {hook}".strip()
        pictogram_slug = slug if slug in LEAD_VIDEO_SLUGS else None
        scenes.append(
            _scene(
                f"spotlight-{index}",
                headline,
                branded_title_slide_layer(
                    pictogram_slug=pictogram_slug,
                    eyebrow=section,
                    title=headline,
                    subtitle=truncate_display(hook, 180) if hook else None,
                    horizontal_align="left",
                    logo_size=TI_VIDEO_LAYOUT["pictogram_size"],
                    title_size=TI_VIDEO_LAYOUT["title_size_briefing"],
                ),
                f"""<cue id="spotlight-{index}-cue">
      <voice>{escape(voice_line)}</voice>
    </cue>""",
            )
        )

    scenes.append(
        _scene(
            "closing",
            "Closing",
            closing_cta_layer(slide_date=slide_date),
            f"""<cue id="closing-cue">
      <voice>{escape(closing_voice)}</voice>
    </cue>""",
        )
    )

    body = "\n\n".join(scenes)
    return f"""<vml id="{escape(EDITION_OVERVIEW_SLUG)}" title="{escape(title)}" fps="30" width="1280" height="720">
  <voiceover provider="openai" voice="{escape(voice)}" model="{escape(model)}" />

{body}
</vml>
"""


def resolve_vml_command(dsl_path: Path, project_dir: Path, target_mp4: Path) -> tuple[list[str], Path | None]:
    babulus_root = Path(str(os.environ.get("BABULUS_ROOT") or DEFAULT_BABULUS_ROOT))
    babulus_cli = babulus_root / "packages" / "videoml-cli" / "src" / "cli.ts"
    if babulus_cli.exists():
        return (
            [
                "npx",
                "tsx",
                str(babulus_cli),
                "pipeline",
                str(dsl_path),
                "--project-dir",
                str(project_dir),
                "--out",
                str(target_mp4),
            ],
            babulus_root,
        )

    configured = str(os.environ.get("VIDEOML_CLI_DIR") or "").strip()
    cli_root = Path(configured) if configured else DEFAULT_VIDEOML_CLI
    candidates = [
        cli_root / "node_modules" / ".bin" / "vml",
        cli_root / "bin" / "vml.js",
        cli_root / "bin" / "vml",
    ]
    for candidate in candidates:
        if candidate.exists():
            if candidate.suffix == ".js":
                command = ["node", str(candidate), "pipeline", str(dsl_path), "--project-dir", str(project_dir), "--out", str(target_mp4)]
            else:
                command = [str(candidate), "pipeline", str(dsl_path), "--project-dir", str(project_dir), "--out", str(target_mp4)]
            return command, cli_root

    found = shutil.which("vml")
    if found:
        return ([found, "pipeline", str(dsl_path), "--project-dir", str(project_dir), "--out", str(target_mp4)], None)

    raise ValueError(
        "Could not find a VideoML CLI. Install Babulus at ~/Projects/Babulus "
        "(preferred) or run `npm install` in ~/Projects/VideoML/cli."
    )


def build_vml_env() -> dict[str, str]:
    load_dotenv()
    api_key = resolve_openai_api_key()
    if not api_key:
        raise ValueError(
            "OpenAI API key is required. Set OPENAI_API_KEY or openai.api_key in .papyrus/config.yaml "
            "(use PAPYRUS_CONFIG when running from a worktree)."
        )
    env = os.environ.copy()
    env["OPENAI_API_KEY"] = api_key
    env["BABULUS_BROWSER_BUNDLE"] = str(TI_BROWSER_BUNDLE)
    defaults = resolve_openai_tts_defaults()
    if defaults.get("baseUrl"):
        env["OPENAI_BASE_URL"] = str(defaults["baseUrl"])
    return env


def probe_openai_key() -> dict[str, Any]:
    load_dotenv()
    api_key = resolve_openai_api_key()
    if not api_key:
        raise ValueError(
            "OpenAI API key is missing. Set OPENAI_API_KEY or openai.api_key in .papyrus/config.yaml."
        )
    defaults = resolve_openai_tts_defaults()
    request_body = json.dumps(
        {
            "model": defaults["model"],
            "input": "ok",
            "voice": defaults["voice"],
        }
    ).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    base_url = str(defaults.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/audio/speech",
        data=request_body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content_type = response.headers.get("Content-Type", "")
            body = response.read(64)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ValueError(f"OpenAI TTS probe failed ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise ValueError(f"OpenAI TTS probe failed: {error}") from error

    return {
        "ok": True,
        "model": defaults["model"],
        "voice": defaults["voice"],
        "contentType": content_type,
        "bytesRead": len(body),
    }


def render_dsl_to_mp4(
    *,
    dsl_path: Path,
    dsl_xml: str,
    project_dir: Path,
    target_mp4: Path,
) -> Path:
    target_mp4.parent.mkdir(parents=True, exist_ok=True)
    project_dir.mkdir(parents=True, exist_ok=True)
    ensure_videoml_browser_bundle()
    dsl_path.write_text(dsl_xml, encoding="utf-8")

    command, command_cwd = resolve_vml_command(dsl_path, project_dir, target_mp4)
    result = subprocess.run(
        command,
        cwd=str(command_cwd or PAPYRUS_ROOT),
        env=build_vml_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "VideoML render failed.\n"
            f"command: {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    if not target_mp4.exists():
        raise RuntimeError(f"VideoML reported success but output file is missing: {target_mp4}")
    return target_mp4


def render_video(
    article: dict[str, Any],
    *,
    output_mp4: Path | None = None,
    work_dir: Path | None = None,
    theme: str = "dark",
    from_article: bool = False,
) -> Path:
    slug = str(article.get("slug") or "").strip()
    if not slug:
        raise ValueError("Article slug is required for video rendering.")

    target_mp4 = output_mp4 or article_output_mp4(article, theme=theme)
    project_dir = work_dir or (PAPYRUS_ROOT / "videoml-work" / slug)
    dsl_path = project_dir / f"{slug}-{theme}.babulus.xml"
    from publications.threat_intelligence.videoml.videos_dsl import resolve_videoml_dsl_for_render

    dsl_xml = resolve_videoml_dsl_for_render(
        target_slug=slug,
        theme=theme,
        from_article=from_article,
        article=article,
    )
    return render_dsl_to_mp4(
        dsl_path=dsl_path,
        dsl_xml=dsl_xml,
        project_dir=project_dir,
        target_mp4=target_mp4,
    )


def render_edition_overview(
    *,
    payload: dict[str, Any] | None = None,
    output_mp4: Path | None = None,
    work_dir: Path | None = None,
    theme: str = "dark",
    from_article: bool = False,
) -> Path:
    edition = payload if payload is not None else load_ti_seed_payload()
    target_mp4 = output_mp4 or edition_overview_output_mp4(theme=theme)
    project_dir = work_dir or (PAPYRUS_ROOT / "videoml-work" / EDITION_OVERVIEW_SLUG)
    dsl_path = project_dir / f"{EDITION_OVERVIEW_SLUG}-{theme}.babulus.xml"
    from publications.threat_intelligence.videoml.videos_dsl import resolve_videoml_dsl_for_render

    dsl_xml = resolve_videoml_dsl_for_render(
        target_slug=EDITION_OVERVIEW_SLUG,
        theme=theme,
        from_article=from_article,
        edition_payload=edition,
    )
    return render_dsl_to_mp4(
        dsl_path=dsl_path,
        dsl_xml=dsl_xml,
        project_dir=project_dir,
        target_mp4=target_mp4,
    )


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "article"

from __future__ import annotations

import json
import unittest
from xml.sax.saxutils import escape


class ThreatIntelligenceVideoPipelineTests(unittest.TestCase):
    def test_build_babulus_xml_includes_voiceover(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_babulus_xml

        xml = build_babulus_xml(
            {
                "slug": "the-balance-of-power-is-shifting",
                "headline": "Sample Headline",
                "deck": "Sample deck",
                "excerpt": "Sample excerpt.",
                "section": "Mission",
                "byline": "Anthus AI Solutions",
                "pullQuotes": ["Quote one."],
                "image": {
                    "alt": "Sample pictogram",
                    "credit": "Anthus Threat Intelligence diagram",
                },
            },
            voice="alloy",
            model="gpt-4o-mini-tts",
        )
        self.assertIn('provider="openai"', xml)
        self.assertIn("Sample Headline", xml)
        self.assertIn("Sample excerpt.", xml)
        self.assertIn("<layer id=\"background\"", xml)
        self.assertIn("<ti-title-slide", xml)
        self.assertIn("pictogramSlug", xml)
        self.assertIn("the-balance-of-power-is-shifting", xml)
        self.assertIn("<ti-quote-card", xml)
        self.assertIn("<video-background", xml)
        self.assertNotIn("data:image/svg+xml;base64,", xml)
        self.assertIn("eyebrowRule", xml)
        self.assertIn("--ti-alarm-red", xml)
        self.assertIn('"--ti-section-rule":"#e54d2e"', xml)
        self.assertNotIn("#ec6142", xml)
        closing_index = xml.index('id="closing"')
        closing_slice = xml[closing_index:]
        self.assertIn("mastheadEyebrow", closing_slice)
        self.assertIn("Anthus AI Solutions", closing_slice)
        self.assertIn("titleWordSplit", closing_slice)
        self.assertIn("<ti-title-slide", closing_slice)
        self.assertIn("THREAT INTELLIGENCE", xml)
        self.assertIn("To learn more", xml)
        self.assertIn("July 4, 2026", xml)
        self.assertNotIn("This briefing is from", xml)
        self.assertIn('"variant":"solid"', xml)
        self.assertNotIn('"gradient"', xml)
        hook_index = xml.index('id="hook"')
        title_index = xml.index('id="title"')
        self.assertLess(hook_index, title_index)

    def test_build_babulus_xml_uses_authored_scenes_with_post_roll(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_babulus_xml

        article = {
            "slug": "the-balance-of-power-is-shifting",
            "headline": "Sample Headline",
            "section": "Mission",
            "excerpt": "Legacy excerpt.",
            "pullQuotes": ["Legacy quote."],
            "video": {
                "scenes": [
                    {"kind": "quote", "quote": "Opening quote, isn't it.", "voice": "Opening voice."},
                    {
                        "kind": "slide",
                        "eyebrow": "Mission",
                        "title": "Second Scene",
                        "subtitle": "Second subtitle",
                        "pictogram": "the-balance-of-power-is-shifting",
                        "voice": "Second voice.",
                    },
                ]
            },
        }
        xml = build_babulus_xml(article, voice="alloy", model="gpt-4o-mini-tts")
        self.assertIn('id="scene-1"', xml)
        self.assertIn('id="scene-2"', xml)
        self.assertIn('id="post-roll"', xml)
        self.assertLess(xml.index('id="scene-1"'), xml.index('id="scene-2"'))
        self.assertLess(xml.index('id="scene-2"'), xml.index('id="post-roll"'))
        self.assertIn("Opening quote, isn&#39;t it.", xml)
        self.assertIn("Opening voice.", xml)
        self.assertIn("pictogramSlug", xml)
        self.assertIn("THREAT INTELLIGENCE", xml)
        self.assertNotIn('id="hook"', xml)
        self.assertNotIn('id="body-excerpt"', xml)
        self.assertNotIn("Legacy excerpt.", xml)
        self.assertNotIn("Legacy quote.", xml)

    def test_build_edition_overview_xml_uses_authored_scenes(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_edition_overview_xml, load_ti_seed_payload

        payload = load_ti_seed_payload()
        payload["video"] = dict(payload.get("video") or {})
        payload["video"]["scenes"] = [
            {"kind": "quote", "quote": "Edition scene quote.", "voice": "Edition scene voice."},
            {"kind": "slide", "title": "Edition Scene Two", "voice": "Edition scene two voice."},
        ]
        xml = build_edition_overview_xml(payload, voice="alloy", model="gpt-4o-mini-tts")
        self.assertIn('id="scene-1"', xml)
        self.assertIn('id="scene-2"', xml)
        self.assertIn('id="post-roll"', xml)
        self.assertNotIn("edition-teaser", xml)
        self.assertNotIn("spotlight-1", xml)
        self.assertNotIn('id="hook"', xml)

    def test_build_edition_overview_xml_uses_edition_hook_with_fallback(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_edition_overview_xml, load_ti_seed_payload

        payload = load_ti_seed_payload()
        payload["video"] = dict(payload.get("video") or {})
        payload["video"].pop("scenes", None)  # exercise the legacy fallback path
        payload["video"]["hook"] = "Sample edition hook, isn't it."
        xml = build_edition_overview_xml(payload, voice="alloy", model="gpt-4o-mini-tts")
        self.assertIn("Sample edition hook, isn&#39;t it.", xml)

        payload["video"].pop("hook")
        fallback_xml = build_edition_overview_xml(payload, voice="alloy", model="gpt-4o-mini-tts")
        first_lead_quote = str(payload["articles"][0]["pullQuotes"][0])
        self.assertNotIn("Sample edition hook", fallback_xml)
        self.assertIn(escape(first_lead_quote), fallback_xml)

    def test_build_edition_overview_xml_includes_spotlights(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_edition_overview_xml, load_ti_seed_payload

        payload = load_ti_seed_payload()
        payload["video"] = dict(payload.get("video") or {})
        payload["video"].pop("scenes", None)  # exercise the legacy fallback path
        xml = build_edition_overview_xml(
            payload,
            voice="alloy",
            model="gpt-4o-mini-tts",
        )
        self.assertIn("edition-teaser", xml)
        self.assertNotIn('id="intro"', xml)
        hook_index = xml.index('id="hook"')
        title_index = xml.index('id="title"')
        teaser_index = xml.index("edition-teaser")
        self.assertLess(hook_index, title_index)
        self.assertLess(title_index, teaser_index)
        self.assertLess(teaser_index, xml.index("spotlight-1"))
        self.assertIn("spotlight-1", xml)
        self.assertIn("spotlight-6", xml)
        self.assertIn("Practical advice for staying secure", xml)
        self.assertNotIn("#ec6142", xml)
        self.assertIn('"--ti-section-rule":"#e54d2e"', xml)
        self.assertIn("eyebrowRule", xml)
        teaser_index = xml.index("edition-teaser")
        teaser_eyebrow_rule = xml.index("eyebrowRule", teaser_index)
        self.assertGreater(teaser_eyebrow_rule, teaser_index)
        self.assertIn("THREAT INTELLIGENCE", xml)
        self.assertIn("To learn more", xml)
        self.assertIn("July 4, 2026", xml)
        self.assertIn("To learn more, check out the July 4, 2026 edition", xml)
        self.assertIn('"variant":"solid"', xml)
        self.assertNotIn('"gradient"', xml)
        self.assertIn("pictogramSlug", xml)
        self.assertIn("the-balance-of-power-is-shifting", xml)

    def test_ti_scene_styles_light_has_light_palette(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import (
            TI_SCENE_STYLES_DARK,
            TI_SCENE_STYLES_LIGHT,
            TI_BACKGROUND_PROPS_DARK,
            TI_BACKGROUND_PROPS_LIGHT,
            scene_styles_for_theme,
            background_props_for_theme,
        )

        self.assertEqual(TI_SCENE_STYLES_DARK["background"], "#111110")
        self.assertEqual(TI_SCENE_STYLES_LIGHT["background"], "#fdfdfc")
        self.assertEqual(TI_BACKGROUND_PROPS_DARK["color"], "#111110")
        self.assertEqual(TI_BACKGROUND_PROPS_LIGHT["color"], "#fdfdfc")
        self.assertEqual(scene_styles_for_theme("dark")["background"], "#111110")
        self.assertEqual(scene_styles_for_theme("light")["background"], "#fdfdfc")
        self.assertEqual(background_props_for_theme("dark")["color"], "#111110")
        self.assertEqual(background_props_for_theme("light")["color"], "#fdfdfc")

        dark_vars = TI_SCENE_STYLES_DARK["vars"]
        light_vars = TI_SCENE_STYLES_LIGHT["vars"]
        self.assertEqual(dark_vars["--ti-alarm-red"], "#e54d2e")
        self.assertEqual(light_vars["--ti-alarm-red"], "#e54d2e")
        self.assertEqual(dark_vars["--ti-pictogram-edge"], "#363a3f")
        self.assertEqual(light_vars["--ti-pictogram-edge"], "#b9bbc6")
        self.assertEqual(dark_vars["--ti-row-height"], "24px")
        self.assertEqual(light_vars["--ti-row-height"], "24px")

    def test_title_slide_layer_uses_rhythm_sizes(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import (
            TI_VIDEO_LAYOUT,
            build_babulus_xml,
            title_slide_layer,
        )

        layer = title_slide_layer(title="Sample", eyebrow="Mission", eyebrow_rule=True)
        self.assertIn(f'"padding":{TI_VIDEO_LAYOUT["padding"]}', layer)
        self.assertIn(f'"titleSize":{TI_VIDEO_LAYOUT["title_size"]}', layer)
        self.assertIn(f'"subtitleSize":{TI_VIDEO_LAYOUT["subtitle_size"]}', layer)

        xml = build_babulus_xml(
            {
                "slug": "the-balance-of-power-is-shifting",
                "headline": "Sample Headline",
                "deck": "Sample deck",
                "excerpt": "Sample excerpt.",
                "section": "Mission",
                "pullQuotes": ["Quote one."],
            },
            voice="alloy",
            model="gpt-4o-mini-tts",
        )
        self.assertIn(f'"pictogramSize":{TI_VIDEO_LAYOUT["pictogram_size"]}', xml)
        self.assertIn(f'"titleSize":{TI_VIDEO_LAYOUT["title_size_briefing"]}', xml)
        self.assertIn(f'"titleSize":{TI_VIDEO_LAYOUT["closing_title_size"]}', xml)

    def test_article_output_mp4_light_suffix(self) -> None:
        from papyrus_content.env import PAPYRUS_ROOT
        from publications.threat_intelligence.videoml.video_pipeline import (
            TI_VIDEO_OUTPUT_DIR,
            article_output_mp4,
            edition_overview_output_mp4,
        )

        dark_article = article_output_mp4({"slug": "test-slug"}, theme="dark")
        light_article = article_output_mp4({"slug": "test-slug"}, theme="light")
        default_article = article_output_mp4({"slug": "test-slug"})
        self.assertEqual(dark_article.name, "test-slug.mp4")
        self.assertEqual(light_article.name, "test-slug-light.mp4")
        self.assertEqual(default_article.name, "test-slug.mp4")
        self.assertEqual(
            TI_VIDEO_OUTPUT_DIR,
            PAPYRUS_ROOT / "public" / "seed-art" / "threat-intelligence" / "videos",
        )
        self.assertEqual(default_article.parent, TI_VIDEO_OUTPUT_DIR)

        dark_overview = edition_overview_output_mp4(theme="dark")
        light_overview = edition_overview_output_mp4(theme="light")
        default_overview = edition_overview_output_mp4()
        self.assertEqual(dark_overview.name, "edition-overview.mp4")
        self.assertEqual(light_overview.name, "edition-overview-light.mp4")
        self.assertEqual(default_overview.name, "edition-overview.mp4")
        self.assertEqual(default_overview.parent, TI_VIDEO_OUTPUT_DIR)

    def test_build_babulus_xml_light_theme_uses_light_palette(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_babulus_xml

        xml = build_babulus_xml(
            {
                "slug": "the-balance-of-power-is-shifting",
                "headline": "Sample Headline",
                "deck": "Sample deck",
                "excerpt": "Sample excerpt.",
                "section": "Mission",
                "byline": "Anthus AI Solutions",
                "pullQuotes": ["Quote one."],
                "image": {
                    "alt": "Sample pictogram",
                    "credit": "Anthus Threat Intelligence diagram",
                },
            },
            voice="alloy",
            model="gpt-4o-mini-tts",
            theme="light",
        )
        self.assertIn('"--ti-section-rule":"#e54d2e"', xml)
        self.assertIn('"--ti-alarm-red":"#e54d2e"', xml)
        self.assertIn('"--ti-headline-color":"#21201c"', xml)
        self.assertIn('"background":"#fdfdfc"', xml)
        self.assertNotIn("#111110", xml)
        self.assertNotIn("#191918", xml)

    def test_parse_theme_option_validates_values(self) -> None:
        from publications.threat_intelligence.videoml.videos_commands import parse_theme_option, resolve_themes

        self.assertEqual(parse_theme_option(None), "both")
        self.assertEqual(parse_theme_option("both"), "both")
        self.assertEqual(parse_theme_option("dark"), "dark")
        self.assertEqual(parse_theme_option("light"), "light")
        self.assertEqual(resolve_themes("both"), ["dark", "light"])
        self.assertEqual(resolve_themes("dark"), ["dark"])
        self.assertEqual(resolve_themes("light"), ["light"])

        with self.assertRaises(ValueError):
            parse_theme_option("invalid")

    def test_parse_jobs_option_defaults_and_validates(self) -> None:
        from publications.threat_intelligence.videoml.videos_commands import parse_jobs_option

        self.assertEqual(parse_jobs_option(None), 3)
        self.assertEqual(parse_jobs_option("1"), 1)
        self.assertEqual(parse_jobs_option("4"), 4)

        with self.assertRaises(ValueError):
            parse_jobs_option("0")
        with self.assertRaises(ValueError):
            parse_jobs_option("-1")


class ThreatIntelligenceVideoDslTests(unittest.TestCase):
    def test_videoml_item_slug_and_id_conventions(self) -> None:
        from publications.threat_intelligence.videoml.videos_dsl import videoml_item_id, videoml_item_slug

        self.assertEqual(videoml_item_slug("edition-overview"), "edition-overview--videoml")
        self.assertEqual(videoml_item_id("the-balance-of-power-is-shifting"), "item-videoml-the-balance-of-power-is-shifting")

    def test_build_videoml_item_records_shape(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_babulus_xml
        from publications.threat_intelligence.videoml.videos_dsl import build_videoml_item_records

        article = {
            "slug": "the-balance-of-power-is-shifting",
            "headline": "The Balance of Power Is Shifting",
            "section": "Mission",
            "deck": "Sample deck",
            "excerpt": "Sample excerpt.",
            "pullQuotes": ["Quote one."],
        }
        dsl = build_babulus_xml(article, voice="alloy", model="gpt-4o-mini-tts")
        records = build_videoml_item_records(
            target_slug="the-balance-of-power-is-shifting",
            target_kind="article",
            dsl=dsl,
            headline="The Balance of Power Is Shifting",
            section="Mission",
            published_at="2026-07-04T12:00:00.000Z",
            edition_date="2026-07-04",
        )
        self.assertEqual(len(records), 2)
        item = records[0]["expected"]
        published = records[1]["expected"]
        self.assertEqual(records[0]["modelName"], "Item")
        self.assertEqual(records[1]["modelName"], "PublishedItem")
        self.assertEqual(item["type"], "videoml")
        self.assertEqual(item["slug"], "the-balance-of-power-is-shifting--videoml")
        editorial = json.loads(item["editorial"])
        self.assertIn("videoScript", editorial)
        self.assertIn("<vml ", editorial["videoScript"]["dsl"])
        self.assertEqual(editorial["videoScript"]["target"]["articleSlug"], "the-balance-of-power-is-shifting")
        self.assertEqual(published["slug"], item["slug"])

    def test_resolve_videoml_dsl_for_render_prefers_item_dsl(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import build_babulus_xml, retheme_vml_xml
        from publications.threat_intelligence.videoml.videos_dsl import resolve_videoml_dsl_for_render

        article = {
            "slug": "the-balance-of-power-is-shifting",
            "headline": "Stored Headline",
            "deck": "Stored deck",
            "excerpt": "Stored excerpt.",
            "section": "Mission",
            "pullQuotes": ["Stored quote."],
        }
        stored = build_babulus_xml(article, voice="alloy", model="gpt-4o-mini-tts", theme="dark")

        class FakeClient:
            def get_record(self, model_name: str, record_id: str):
                if model_name == "Item" and record_id.endswith("the-balance-of-power-is-shifting"):
                    return {
                        "id": record_id,
                        "editorial": json.dumps({"videoScript": {"dsl": stored, "target": {"kind": "article"}}}),
                    }
                return None

        from unittest.mock import patch

        with patch(
            "publications.threat_intelligence.videoml.videos_dsl.create_authoring_client",
            return_value=(FakeClient(), {}),
        ):
            resolved = resolve_videoml_dsl_for_render(
                target_slug="the-balance-of-power-is-shifting",
                theme="light",
                from_article=False,
                article=article,
            )
        self.assertEqual(resolved, retheme_vml_xml(stored, "light"))
        self.assertIn("Stored Headline", resolved)

    def test_retheme_vml_xml_swaps_light_palette(self) -> None:
        from publications.threat_intelligence.videoml.video_pipeline import (
            TI_SCENE_STYLES_DARK,
            TI_SCENE_STYLES_LIGHT,
            build_babulus_xml,
            props_attr,
            retheme_vml_xml,
        )

        xml = build_babulus_xml(
            {
                "slug": "the-balance-of-power-is-shifting",
                "headline": "Sample",
                "deck": "Deck",
                "excerpt": "Excerpt.",
                "section": "Mission",
            },
            voice="alloy",
            model="gpt-4o-mini-tts",
            theme="dark",
        )
        light = retheme_vml_xml(xml, "light")
        self.assertIn(props_attr(TI_SCENE_STYLES_LIGHT), light)
        self.assertNotIn(props_attr(TI_SCENE_STYLES_DARK), light)


if __name__ == "__main__":
    unittest.main()

"""Threat Intelligence on the standard Papyrus front end: the parts that are this publication's own.

Settings are in projection.json and the look is css/site-theme.css. What lives here is the page chrome (header,
masthead, footer), the front-page feed, the post page with its pictogram figure, and the section and 404 pages. The
markup keeps the class names of the previous Next.js reader so the same theme styles it.
"""

from __future__ import annotations

from datetime import datetime
from html import escape

from papyrus_content.projection.standard.fragments import article_body

from pictograms import MASTHEAD_WEB, PLATES

NAME = "Threat Intelligence"
TAGLINE = "Practical advice for staying secure as the threat landscape shifts."
SHOWCASE_COUNT = 6
THEME_STORAGE_KEY = "anthus-threat-intelligence-theme"

# What each page depends on: a post page reads only itself; every other page reads the desks.
DEPENDS_ON = {"item": [], "*": ["AI", "AWS", "Azure", "Gaming", "Mission", "Newsroom"]}

PRE_PAINT_THEME_SCRIPT = (
    "(function(){try{var s=window.localStorage.getItem(%r);"
    "document.documentElement.setAttribute('data-theme',s==='light'||s==='dark'||s==='system'?s:'system');}"
    "catch(e){document.documentElement.setAttribute('data-theme','system');}})();" % THEME_STORAGE_KEY
)

BRAND_MARK = (
    '<svg aria-hidden="true" class="brand-web-mark" height="{size}" viewBox="0 0 20 20" width="{size}">'
    '<g class="f-none s-line" stroke-width="1"><polygon points="18,10 15.66,15.66 10,18 4.34,15.66 2,10 4.34,4.34 10,2 15.66,4.34"/>'
    '<polygon points="14,10 12.83,12.83 10,14 7.17,12.83 6,10 7.17,7.17 10,6 12.83,7.17"/>'
    '<path d="M2 10H18M10 2V18M4.34 4.34L15.66 15.66M15.66 4.34L4.34 15.66"/></g>'
    '<circle class="f-signal" cx="15.66" cy="15.66" r="2.4"/></svg>'
)

THEME_ICONS = {
    "system": '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-width="1.5" viewBox="0 0 16 16" width="16"><rect height="9" rx="1.5" width="12" x="2" y="2.5"/><path d="M5.5 14h5M8 11.5V14" stroke-linecap="round"/></svg>',
    "light": '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" viewBox="0 0 16 16" width="16"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>',
    "dark": '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 16 16" width="16"><path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z"/></svg>',
}


def _date_label(entry) -> str:
    try:
        day = datetime.fromisoformat(entry.date[:10])
    except ValueError:
        return ""
    return f"{day.strftime('%b')} {day.day}"


def _published(entry) -> str:
    return entry.summary.published_at or entry.date


def _desk(entry) -> str:
    return entry.section.label if entry.section is not None else ""


def _plate(entry) -> str:
    return PLATES.get(entry.slug, "")


# ---------------------------------------------------------------------------------------------------- chrome

def _theme_switch() -> str:
    buttons = "".join(
        f'<button aria-label="{label} theme" aria-pressed="false" class="ti-theme-switch__button" data-theme-choice="{value}" title="{label} theme" type="button">{THEME_ICONS[value]}</button>'
        for value, label in (("system", "System"), ("light", "Light"), ("dark", "Dark"))
    )
    return f'<div aria-label="Theme" class="ti-theme-switch" role="group">{buttons}</div>'


def _header() -> str:
    menu_icon = '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" viewBox="0 0 16 16" width="16"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>'
    return (
        '<header class="ti-site-header">'
        f'<a aria-label="Anthus AI Solutions, Threat Intelligence home" class="ti-site-header__brand" href="/">{BRAND_MARK.format(size=22)}'
        '<span class="ti-site-header__brand-strong">Anthus</span><span class="ti-site-header__brand-muted">AI Solutions</span></a>'
        '<div class="ti-site-header__actions">'
        '<nav aria-label="Desks" class="ti-site-header__navigation ti-wide-only"><a class="ti-site-header__navigation-link" href="/">Posts</a></nav>'
        '<span class="ti-wide-only"><a class="ti-pill-button" href="/newsroom">Log in</a></span>'
        f'{_theme_switch()}'
        f'<details class="ti-site-header__menu ti-narrow-only"><summary class="ti-site-header__menu-toggle">{menu_icon}<span>Menu</span></summary>'
        '<nav aria-label="Desks" class="ti-site-header__menu-panel"><a class="ti-site-header__menu-link" href="/">Posts</a>'
        '<a class="ti-text-button" href="/newsroom">Log in</a></nav></details>'
        '</div></header>'
    )


def _footer() -> str:
    return (
        '<footer class="ti-site-footer"><div class="ti-site-footer__columns"><div class="ti-site-footer__about">'
        f'<p class="ti-site-footer__brand">{BRAND_MARK.format(size=24)}<span>Anthus Threat Intelligence</span></p>'
        f'<p class="ti-site-footer__description">{escape(TAGLINE)}<br/>Published by Anthus AI Solutions.</p></div>'
        '<nav aria-label="Footer" class="ti-site-footer__links"><ul class="ti-site-footer__utility-links">'
        '<li><a href="/">Posts</a></li><li><a href="/feed.xml">RSS feed</a></li><li><a class="ti-text-button" href="/newsroom">Log in</a></li>'
        '<li><a href="https://anth.us/privacy/">Privacy</a></li><li><a href="#cookie-settings">Cookie settings</a></li>'
        '</ul></nav></div>'
        f'<p aria-hidden="true" class="ti-site-footer__wordmark">{NAME}</p></footer>'
    )


def _shell(main: str) -> str:
    return (
        '<a class="ti-skip-link" href="#main">Skip to content</a>'
        f'<div class="ti-container">{_header()}<main id="main">{main}</main>{_footer()}</div>'
    )


def head_extra(page) -> str:
    return f"<script>{PRE_PAINT_THEME_SCRIPT}</script>"


def body_class(page) -> str:
    return "ti-site"


# ---------------------------------------------------------------------------------------------------- pages

def _meta_line(entry) -> str:
    desk = f"<span>{escape(_desk(entry))}</span>" if _desk(entry) else ""
    return (
        f'<p class="ti-post-meta"><span class="ti-post-meta__type">Post</span>{desk}'
        f'<time datetime="{escape(_published(entry))}">{escape(_date_label(entry))}</time></p>'
    )


def _showcase_item(entry) -> str:
    summary = f'<span class="ti-showcase-post__summary">{escape(entry.summary_text)}</span>' if entry.summary_text else ""
    return (
        f'<li><a class="ti-showcase-post" href="{escape(entry.url)}">{_plate(entry)}{_meta_line(entry)}'
        f'<span class="ti-showcase-post__headline">{escape(entry.title)}</span>{summary}</a></li>'
    )


def _dated_item(entry) -> str:
    desk = f'<span class="ti-dated-post__desk">{escape(_desk(entry))}</span>' if _desk(entry) else ""
    return (
        f'<li><a class="ti-dated-post" href="{escape(entry.url)}">'
        f'<time class="ti-dated-post__date" datetime="{escape(_published(entry))}">{escape(_date_label(entry))}</time>'
        f'<span class="ti-dated-post__copy"><span class="ti-dated-post__headline">{escape(entry.title)}</span>{desk}</span></a></li>'
    )


def card(entry, page) -> str:
    return _showcase_item(entry)


def _band(heading_id: str, title: str, extra_class: str, list_html: str) -> str:
    return (
        f'<section aria-labelledby="{heading_id}" class="ti-hero-band{extra_class}">'
        f'<h2 class="ti-hero-band__heading" id="{heading_id}"><span aria-hidden="true" class="ti-signal-dot"></span>'
        f'<span class="ti-hero-band__name">{title}</span></h2>{list_html}</section>'
    )


def _masthead() -> str:
    return (
        '<section aria-labelledby="ti-masthead-wordmark" class="ti-masthead"><div class="ti-masthead__web">'
        f'<div aria-hidden="true" class="blog-page-background">{MASTHEAD_WEB}</div></div>'
        f'<div class="ti-masthead__copy"><h1 class="ti-masthead__wordmark" id="ti-masthead-wordmark">{NAME}</h1>'
        f'<p class="ti-masthead__tagline">{escape(TAGLINE.rstrip("."))}</p></div></section>'
    )


def _home(page) -> str:
    entries = [entry for entry in page.entries if entry.listed and entry.url]
    if not entries:
        return _masthead() + '<p class="ti-empty-state">No posts have been published yet.</p>'
    showcase, earlier = entries[:SHOWCASE_COUNT], entries[SHOWCASE_COUNT:]
    latest = _band("ti-latest-posts", "Latest posts", "", f'<ul class="ti-showcase-posts">{"".join(_showcase_item(e) for e in showcase)}</ul>')
    more = _band("ti-earlier-posts", "Earlier posts", " ti-more-posts", f'<ul class="ti-dated-posts">{"".join(_dated_item(e) for e in earlier)}</ul>') if earlier else ""
    return _masthead() + latest + more


def _post(page) -> str:
    entry = page.entry
    desk = f"<span>{escape(_desk(entry))}</span>" if _desk(entry) else ""
    dek = f'<p class="ti-article__dek">{escape(entry.summary_text)}</p>' if entry.summary_text else ""
    figure = f'<div class="ti-article__figure ti-post__image">{_plate(entry)}</div>' if _plate(entry) else ""
    return (
        f'{page.page_actions}<article class="ti-article ti-post"><header class="ti-article__header">'
        f'<p class="ti-kicker"><a class="ti-kicker__signal" href="/">Post</a>{desk}<time datetime="{escape(_published(entry))}">{escape(_date_label(entry))}</time></p>'
        f'<h1 class="ti-article__headline ti-post__headline">{escape(entry.title)}</h1>{dek}</header>'
        f'{figure}<div class="ti-article__body">{article_body(page.fragment)}</div></article>'
        '<p class="ti-article__back"><a class="ti-secondary-button" href="/">Back to the feed</a></p>'
    )


def _section(page) -> str:
    view = page.listing
    items = "".join(_showcase_item(entry) for entry in view.entries)
    return (
        f'<section class="ti-page-intro"><h1 class="ti-page-intro__title">{escape(view.label)}</h1></section>'
        f'<section class="ti-hero-band"><ul class="ti-showcase-posts">{items}</ul></section>'
        '<p class="ti-article__back"><a class="ti-secondary-button" href="/">Back to the feed</a></p>'
    )


def _not_found() -> str:
    return (
        '<section class="ti-page-intro"><h1 class="ti-page-intro__title">Page not found</h1>'
        '<p class="ti-page-intro__dek">That page does not exist or has moved.</p></section>'
        '<p class="ti-article__back"><a class="ti-secondary-button" href="/">Back to the feed</a></p>'
    )


def page_body(page):
    if page.kind == "home":
        return _shell(_home(page))
    if page.kind == "item":
        return _shell(_post(page))
    if page.kind == "listing":
        return _shell(_section(page))
    if page.kind == "not_found":
        return _shell(_not_found())
    return None

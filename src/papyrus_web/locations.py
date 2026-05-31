from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

from papyrus_knowledge_query.uris import PAPYRUS_URI_KIND_ALIASES, PAPYRUS_URI_SCHEME


OBJECT_LOCATION_KINDS = frozenset(PAPYRUS_URI_KIND_ALIASES.values())
SITE_LOCATION_IDS = frozenset({"home", "archive", "settings"})
NEWSROOM_TAB_IDS = frozenset(
    {
        "overview",
        "messages",
        "assignments",
        "references",
        "topics",
        "concepts",
        "administration",
        "search",
        "sections",
    }
)


def build_web_ui_context(web_path: str) -> dict[str, Any]:
    """Build the structured web UI snapshot passed to console chat agents."""

    location = web_path_to_papyrus_location(web_path)
    return {
        "webPath": location["webPath"],
        "papyrusLocationUri": location["papyrusLocationUri"],
        "papyrusObjectUri": location.get("papyrusObjectUri"),
        "newsroomTab": location.get("newsroomTab"),
        "label": location.get("label"),
    }


def web_path_to_papyrus_location(web_path: str) -> dict[str, Any]:
    """Map a concrete browser path to the pedantic Papyrus location URI."""

    normalized = _normalize_web_path(web_path)
    parsed = urlparse(normalized)
    pathname = parsed.path or "/"
    query = parse_qs(parsed.query, keep_blank_values=False)

    if pathname == "/" or pathname == "":
        return _location("papyrus://site/home", normalized, label="Papyrus home")

    if pathname == "/archive":
        return _location("papyrus://site/archive", normalized, label="Archive")

    if pathname == "/settings":
        return _location("papyrus://site/settings", normalized, label="Settings")

    if pathname.startswith("/articles/"):
        slug = unquote(pathname.removeprefix("/articles/").strip("/"))
        if slug:
            object_uri = f"papyrus://item/{quote(slug, safe='')}"
            return _location(object_uri, normalized, object_uri=object_uri, label=f"Article {slug}")

    edition_article = _edition_article_path_match(pathname)
    if edition_article is not None:
        year, month, day, slug = edition_article
        object_uri = f"papyrus://item/{quote(slug, safe='')}"
        label = f"Edition article {year}-{month}-{day} / {slug}"
        return _location(object_uri, normalized, object_uri=object_uri, label=label)

    if not pathname.startswith("/newsroom"):
        return _location(f"papyrus://site/path/{quote(pathname.strip('/'), safe='')}", normalized, label=pathname)

    if pathname == "/newsroom" or pathname == "/newsroom/":
        return _location("papyrus://newsroom/overview", normalized, newsroom_tab="overview", label="Newsroom overview")

    segments = [segment for segment in pathname.split("/") if segment]
    if len(segments) < 2:
        return _location("papyrus://newsroom/overview", normalized, newsroom_tab="overview", label="Newsroom overview")

    tab = segments[1]
    if tab == "sections" and len(segments) >= 3:
        section_id = unquote(segments[2])
        object_uri = f"papyrus://newsroomSection/{quote(section_id, safe='')}"
        return _location(
            object_uri,
            normalized,
            object_uri=object_uri,
            newsroom_tab="sections",
            label=f"Newsroom section {section_id}",
        )

    if tab == "search":
        anchor_uri = _search_anchor_uri(query)
        location_uri = "papyrus://newsroom/search" if not anchor_uri else f"papyrus://newsroom/search/{anchor_uri.removeprefix('papyrus://')}"
        payload = _location(location_uri, normalized, newsroom_tab="search", label="Newsroom search")
        if anchor_uri:
            payload["papyrusObjectUri"] = anchor_uri
        return payload

    if tab == "administration":
        panel = "/".join(segments[2:]) or "overview"
        location_uri = f"papyrus://newsroom/administration/{quote(panel, safe='')}"
        return _location(location_uri, normalized, newsroom_tab="administration", label=f"Newsroom administration / {panel}")

    if tab == "assignments" and query.get("view", [""])[0] == "budget":
        return _location(
            "papyrus://newsroom/assignments/budget",
            normalized,
            newsroom_tab="assignments",
            label="Newsroom assignments budget view",
        )

    if tab in {"references", "messages", "assignments"} and len(segments) >= 3:
        object_id = unquote(segments[2])
        kind = {"references": "reference", "messages": "message", "assignments": "assignment"}[tab]
        object_uri = f"papyrus://{quote(kind, safe='')}/{quote(object_id, safe='')}"
        return _location(
            object_uri,
            normalized,
            object_uri=object_uri,
            newsroom_tab=tab,
            label=f"{kind} {object_id}",
        )

    if tab == "topics":
        category = (query.get("category") or [""])[0].strip()
        if category:
            object_uri = f"papyrus://category/{quote(category, safe='')}"
            return _location(
                object_uri,
                normalized,
                object_uri=object_uri,
                newsroom_tab="topics",
                label=f"Category {category}",
            )
        return _location("papyrus://newsroom/topics", normalized, newsroom_tab="topics", label="Newsroom topics")

    if tab == "concepts":
        node = (query.get("node") or [""])[0].strip()
        if node:
            object_uri = f"papyrus://semanticNode/{quote(node, safe='')}"
            return _location(
                object_uri,
                normalized,
                object_uri=object_uri,
                newsroom_tab="concepts",
                label=f"Semantic node {node}",
            )
        category = (query.get("category") or [""])[0].strip()
        if category:
            object_uri = f"papyrus://category/{quote(category, safe='')}"
            return _location(
                object_uri,
                normalized,
                object_uri=object_uri,
                newsroom_tab="concepts",
                label=f"Category {category}",
            )
        return _location("papyrus://newsroom/concepts", normalized, newsroom_tab="concepts", label="Newsroom concepts")

    if tab in NEWSROOM_TAB_IDS:
        return _location(
            f"papyrus://newsroom/{quote(tab, safe='')}",
            normalized,
            newsroom_tab=tab,
            label=f"Newsroom {tab}",
        )

    remainder = "/".join(segments[1:])
    return _location(
        f"papyrus://newsroom/{quote(remainder, safe='')}",
        normalized,
        newsroom_tab=tab,
        label=f"Newsroom {remainder}",
    )


def _parse_location_uri(uri: str) -> tuple[str, str]:
    raw = str(uri or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme != PAPYRUS_URI_SCHEME:
        raise ValueError(f"Papyrus URI must use papyrus:// scheme: {raw}")
    if parsed.params or parsed.query or parsed.fragment:
        raise ValueError(f"Papyrus URI must not include params, query, or fragment: {raw}")
    kind = unquote(parsed.netloc).strip()
    object_id = unquote(parsed.path[1:] if parsed.path.startswith("/") else parsed.path).strip()
    if not kind:
        raise ValueError(f"Papyrus URI kind is required: {raw}")
    if not object_id:
        raise ValueError(f"Papyrus URI object id is required: {raw}")
    canonical_kind = PAPYRUS_URI_KIND_ALIASES.get(kind) or PAPYRUS_URI_KIND_ALIASES.get(kind.lower()) or kind
    return canonical_kind, object_id


def papyrus_uri_to_web_path(uri: str) -> dict[str, Any]:
    """Map a pedantic Papyrus location URI to a concrete browser path."""

    raw = str(uri or "").strip()
    if not raw:
        raise ValueError("Papyrus location URI is required")

    kind, object_id = _parse_location_uri(raw)

    if kind == "site":
        if object_id == "home":
            return {"ok": True, "papyrusLocationUri": raw, "webPath": "/"}
        if object_id == "archive":
            return {"ok": True, "papyrusLocationUri": raw, "webPath": "/archive"}
        if object_id == "settings":
            return {"ok": True, "papyrusLocationUri": raw, "webPath": "/settings"}
        if object_id.startswith("path/"):
            return {"ok": True, "papyrusLocationUri": raw, "webPath": f"/{unquote(object_id.removeprefix('path/'))}"}
        raise ValueError(f"Unsupported site location URI: {raw}")

    if kind in OBJECT_LOCATION_KINDS:
        web_path = _object_kind_to_web_path(kind, object_id)
        return {
            "ok": True,
            "papyrusLocationUri": raw,
            "papyrusObjectUri": raw,
            "webPath": web_path,
        }

    if kind != "newsroom":
        raise ValueError(f"Unsupported Papyrus location URI kind: {kind}")

    if object_id == "overview":
        return {"ok": True, "papyrusLocationUri": raw, "webPath": "/newsroom"}

    if object_id == "assignments/budget":
        return {"ok": True, "papyrusLocationUri": raw, "webPath": "/newsroom/assignments?view=budget"}

    if object_id == "search":
        return {"ok": True, "papyrusLocationUri": raw, "webPath": "/newsroom/search"}

    if object_id.startswith("search/"):
        anchor_tail = object_id.removeprefix("search/")
        anchor_parts = anchor_tail.split("/", 1)
        if len(anchor_parts) != 2:
            raise ValueError(f"Invalid anchored search location URI: {raw}")
        anchor_kind, anchor_id = anchor_parts
        canonical_kind = PAPYRUS_URI_KIND_ALIASES.get(anchor_kind) or PAPYRUS_URI_KIND_ALIASES.get(anchor_kind.lower())
        if not canonical_kind:
            raise ValueError(f"Invalid anchored search location URI: {raw}")
        params = {
            "anchorKind": canonical_kind,
            "anchorId": unquote(anchor_id),
            "anchorLineageId": unquote(anchor_id),
        }
        return {
            "ok": True,
            "papyrusLocationUri": raw,
            "papyrusObjectUri": f"papyrus://{quote(canonical_kind, safe='')}/{quote(unquote(anchor_id), safe='')}",
            "webPath": f"/newsroom/search?{urlencode(params)}",
        }

    if object_id.startswith("administration/"):
        panel = unquote(object_id.removeprefix("administration/"))
        return {"ok": True, "papyrusLocationUri": raw, "webPath": f"/newsroom/administration/{panel}"}

    if object_id in NEWSROOM_TAB_IDS:
        return {"ok": True, "papyrusLocationUri": raw, "webPath": f"/newsroom/{object_id}" if object_id != "overview" else "/newsroom"}

    if "/" in object_id:
        return {"ok": True, "papyrusLocationUri": raw, "webPath": f"/newsroom/{unquote(object_id)}"}

    raise ValueError(f"Unsupported newsroom location URI: {raw}")


def _object_kind_to_web_path(kind: str, object_id: str) -> str:
    encoded = quote(unquote(object_id), safe="")
    if kind == "reference":
        return f"/newsroom/references/{encoded}"
    if kind == "message":
        return f"/newsroom/messages/{encoded}"
    if kind == "assignment":
        return f"/newsroom/assignments/{encoded}"
    if kind == "category":
        return f"/newsroom/topics?category={encoded}"
    if kind == "semanticNode":
        return f"/newsroom/concepts?node={encoded}"
    if kind == "newsroomSection":
        return f"/newsroom/sections/{encoded}"
    if kind == "item":
        return f"/articles/{encoded}"
    return f"/newsroom?object={quote(kind, safe='')}:{encoded}"


def _search_anchor_uri(query: dict[str, list[str]]) -> str | None:
    anchor_kind = (query.get("anchorKind") or query.get("anchorkind") or [""])[0].strip()
    anchor_id = (query.get("anchorId") or query.get("anchorid") or [""])[0].strip()
    if not anchor_kind or not anchor_id:
        return None
    canonical_kind = PAPYRUS_URI_KIND_ALIASES.get(anchor_kind) or PAPYRUS_URI_KIND_ALIASES.get(anchor_kind.lower())
    if not canonical_kind:
        return None
    return f"papyrus://{quote(canonical_kind, safe='')}/{quote(anchor_id, safe='')}"


def _edition_article_path_match(pathname: str) -> tuple[str, str, str, str] | None:
    segments = [segment for segment in pathname.split("/") if segment]
    if len(segments) != 4:
        return None
    year, month, day, slug = segments
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        return None
    return year, month, day, unquote(slug)


def _normalize_web_path(web_path: str) -> str:
    raw = str(web_path or "").strip()
    if not raw:
        return "/newsroom"
    parsed = urlparse(raw)
    path = parsed.path or "/"
    if parsed.query:
        return f"{path}?{parsed.query}"
    return path


def _location(
    papyrus_location_uri: str,
    web_path: str,
    *,
    object_uri: str | None = None,
    newsroom_tab: str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "papyrusLocationUri": papyrus_location_uri,
        "webPath": web_path,
    }
    if object_uri:
        payload["papyrusObjectUri"] = object_uri
    if newsroom_tab:
        payload["newsroomTab"] = newsroom_tab
    if label:
        payload["label"] = label
    return payload

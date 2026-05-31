import { PAPYRUS_OBJECT_KINDS, type PapyrusObjectKind } from "./papyrus-object-kinds";

export type PapyrusWebUiContext = {
  webPath: string;
  papyrusLocationUri: string;
  papyrusObjectUri?: string | null;
  newsroomTab?: string | null;
  label?: string | null;
};

const NEWSROOM_TAB_IDS = new Set([
  "overview",
  "messages",
  "assignments",
  "references",
  "topics",
  "concepts",
  "administration",
  "search",
  "sections",
]);

export function buildWebUiContext(webPath: string): PapyrusWebUiContext {
  const location = webPathToPapyrusLocation(webPath);
  return {
    webPath: location.webPath,
    papyrusLocationUri: location.papyrusLocationUri,
    papyrusObjectUri: location.papyrusObjectUri ?? null,
    newsroomTab: location.newsroomTab ?? null,
    label: location.label ?? null,
  };
}

export function webPathToPapyrusLocation(webPath: string): PapyrusWebUiContext {
  const normalized = normalizeWebPath(webPath);
  const url = new URL(normalized, "https://papyrus.local");
  const pathname = url.pathname || "/";

  if (pathname === "/" || pathname === "") {
    return location("papyrus://site/home", normalized, { label: "Papyrus home" });
  }
  if (pathname === "/archive") {
    return location("papyrus://site/archive", normalized, { label: "Archive" });
  }
  if (pathname === "/settings") {
    return location("papyrus://site/settings", normalized, { label: "Settings" });
  }
  if (pathname.startsWith("/articles/")) {
    const slug = decodeURIComponent(pathname.slice("/articles/".length).replace(/\/+$/, ""));
    if (slug) {
      const objectUri = `papyrus://item/${encodeURIComponent(slug)}`;
      return location(objectUri, normalized, { papyrusObjectUri: objectUri, label: `Article ${slug}` });
    }
  }

  const editionArticle = matchEditionArticlePath(pathname);
  if (editionArticle) {
    const objectUri = `papyrus://item/${encodeURIComponent(editionArticle.slug)}`;
    return location(objectUri, normalized, {
      papyrusObjectUri: objectUri,
      label: `Edition article ${editionArticle.year}-${editionArticle.month}-${editionArticle.day} / ${editionArticle.slug}`,
    });
  }

  if (!pathname.startsWith("/newsroom")) {
    const tail = pathname.replace(/^\/+/, "");
    return location(`papyrus://site/path/${encodeURIComponent(tail)}`, normalized, { label: pathname });
  }

  if (pathname === "/newsroom" || pathname === "/newsroom/") {
    return location("papyrus://newsroom/overview", normalized, { newsroomTab: "overview", label: "Newsroom overview" });
  }

  const segments = pathname.split("/").filter(Boolean);
  const tab = segments[1] ?? "overview";

  if (tab === "sections" && segments[2]) {
    const sectionId = decodeURIComponent(segments[2]);
    const objectUri = `papyrus://newsroomSection/${encodeURIComponent(sectionId)}`;
    return location(objectUri, normalized, {
      papyrusObjectUri: objectUri,
      newsroomTab: "sections",
      label: `Newsroom section ${sectionId}`,
    });
  }

  if (tab === "search") {
    const anchorUri = searchAnchorUri(url.searchParams);
    const locationUri = anchorUri
      ? `papyrus://newsroom/search/${anchorUri.replace(/^papyrus:\/\//, "")}`
      : "papyrus://newsroom/search";
    return location(locationUri, normalized, {
      papyrusObjectUri: anchorUri,
      newsroomTab: "search",
      label: "Newsroom search",
    });
  }

  if (tab === "administration") {
    const panel = segments.slice(2).join("/") || "overview";
    return location(`papyrus://newsroom/administration/${encodeURIComponent(panel)}`, normalized, {
      newsroomTab: "administration",
      label: `Newsroom administration / ${panel}`,
    });
  }

  if (tab === "assignments" && url.searchParams.get("view") === "budget") {
    return location("papyrus://newsroom/assignments/budget", normalized, {
      newsroomTab: "assignments",
      label: "Newsroom assignments budget view",
    });
  }

  if ((tab === "references" || tab === "messages" || tab === "assignments") && segments[2]) {
    const objectId = decodeURIComponent(segments[2]);
    const kind = tab === "references" ? "reference" : tab === "messages" ? "message" : "assignment";
    const objectUri = `papyrus://${kind}/${encodeURIComponent(objectId)}`;
    return location(objectUri, normalized, {
      papyrusObjectUri: objectUri,
      newsroomTab: tab,
      label: `${kind} ${objectId}`,
    });
  }

  if (tab === "topics") {
    const category = url.searchParams.get("category")?.trim();
    if (category) {
      const objectUri = `papyrus://category/${encodeURIComponent(category)}`;
      return location(objectUri, normalized, {
        papyrusObjectUri: objectUri,
        newsroomTab: "topics",
        label: `Category ${category}`,
      });
    }
    return location("papyrus://newsroom/topics", normalized, { newsroomTab: "topics", label: "Newsroom topics" });
  }

  if (tab === "concepts") {
    const node = url.searchParams.get("node")?.trim();
    if (node) {
      const objectUri = `papyrus://semanticNode/${encodeURIComponent(node)}`;
      return location(objectUri, normalized, {
        papyrusObjectUri: objectUri,
        newsroomTab: "concepts",
        label: `Semantic node ${node}`,
      });
    }
    const category = url.searchParams.get("category")?.trim();
    if (category) {
      const objectUri = `papyrus://category/${encodeURIComponent(category)}`;
      return location(objectUri, normalized, {
        papyrusObjectUri: objectUri,
        newsroomTab: "concepts",
        label: `Category ${category}`,
      });
    }
    return location("papyrus://newsroom/concepts", normalized, { newsroomTab: "concepts", label: "Newsroom concepts" });
  }

  if (NEWSROOM_TAB_IDS.has(tab)) {
    return location(`papyrus://newsroom/${encodeURIComponent(tab)}`, normalized, {
      newsroomTab: tab,
      label: `Newsroom ${tab}`,
    });
  }

  const remainder = segments.slice(1).join("/");
  return location(`papyrus://newsroom/${encodeURIComponent(remainder)}`, normalized, {
    newsroomTab: tab,
    label: `Newsroom ${remainder}`,
  });
}

export function papyrusUriToWebPath(uri: string): { ok: true; webPath: string; papyrusLocationUri: string; papyrusObjectUri?: string } {
  const raw = uri.trim();
  if (!raw) throw new Error("Papyrus location URI is required");

  const parsed = parsePapyrusUri(raw);
  const { kind, id } = parsed;

  if (kind === "site") {
    if (id === "home") return { ok: true, papyrusLocationUri: raw, webPath: "/" };
    if (id === "archive") return { ok: true, papyrusLocationUri: raw, webPath: "/archive" };
    if (id === "settings") return { ok: true, papyrusLocationUri: raw, webPath: "/settings" };
    if (id.startsWith("path/")) {
      return { ok: true, papyrusLocationUri: raw, webPath: `/${decodeURIComponent(id.slice("path/".length))}` };
    }
    throw new Error(`Unsupported site location URI: ${raw}`);
  }

  if (PAPYRUS_OBJECT_KINDS.has(kind as PapyrusObjectKind)) {
    const webPath = objectKindToWebPath(kind as PapyrusObjectKind, id);
    return { ok: true, papyrusLocationUri: raw, papyrusObjectUri: raw, webPath };
  }

  if (kind !== "newsroom") {
    throw new Error(`Unsupported Papyrus location URI kind: ${kind}`);
  }

  if (id === "overview") return { ok: true, papyrusLocationUri: raw, webPath: "/newsroom" };
  if (id === "assignments/budget") return { ok: true, papyrusLocationUri: raw, webPath: "/newsroom/assignments?view=budget" };
  if (id === "search") return { ok: true, papyrusLocationUri: raw, webPath: "/newsroom/search" };

  if (id.startsWith("search/")) {
    const anchorTail = id.slice("search/".length);
    const slash = anchorTail.indexOf("/");
    if (slash < 0) throw new Error(`Invalid anchored search location URI: ${raw}`);
    const anchorKind = canonicalObjectKind(anchorTail.slice(0, slash));
    const anchorId = decodeURIComponent(anchorTail.slice(slash + 1));
    if (!anchorKind) throw new Error(`Invalid anchored search location URI: ${raw}`);
    const params = new URLSearchParams({
      anchorKind,
      anchorId,
      anchorLineageId: anchorId,
    });
    const objectUri = `papyrus://${anchorKind}/${encodeURIComponent(anchorId)}`;
    return {
      ok: true,
      papyrusLocationUri: raw,
      papyrusObjectUri: objectUri,
      webPath: `/newsroom/search?${params.toString()}`,
    };
  }

  if (id.startsWith("administration/")) {
    const panel = decodeURIComponent(id.slice("administration/".length));
    return { ok: true, papyrusLocationUri: raw, webPath: `/newsroom/administration/${panel}` };
  }

  if (NEWSROOM_TAB_IDS.has(id)) {
    return { ok: true, papyrusLocationUri: raw, webPath: id === "overview" ? "/newsroom" : `/newsroom/${id}` };
  }

  if (id.includes("/")) {
    return { ok: true, papyrusLocationUri: raw, webPath: `/newsroom/${decodeURIComponent(id)}` };
  }

  throw new Error(`Unsupported newsroom location URI: ${raw}`);
}

export function extractNavigationIntent(toolResultJson: unknown): { webPath: string; papyrusLocationUri: string } | null {
  if (!toolResultJson || typeof toolResultJson !== "object" || Array.isArray(toolResultJson)) return null;
  const envelope = toolResultJson as Record<string, unknown>;
  if (envelope.ok !== true) return null;
  const value = envelope.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const navigation = (value as Record<string, unknown>).navigation;
  if (!navigation || typeof navigation !== "object" || Array.isArray(navigation)) return null;
  const webPath = (navigation as Record<string, unknown>).webPath;
  const papyrusLocationUri = (navigation as Record<string, unknown>).papyrusLocationUri;
  if (typeof webPath !== "string" || !webPath.trim()) return null;
  if (typeof papyrusLocationUri !== "string" || !papyrusLocationUri.trim()) return null;
  return { webPath: webPath.trim(), papyrusLocationUri: papyrusLocationUri.trim() };
}

function location(
  papyrusLocationUri: string,
  webPath: string,
  extras?: Partial<PapyrusWebUiContext>,
): PapyrusWebUiContext {
  return {
    webPath,
    papyrusLocationUri,
    papyrusObjectUri: extras?.papyrusObjectUri ?? null,
    newsroomTab: extras?.newsroomTab ?? null,
    label: extras?.label ?? null,
  };
}

function normalizeWebPath(webPath: string): string {
  const raw = webPath.trim();
  if (!raw) return "/newsroom";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const queryIndex = raw.indexOf("?");
  if (queryIndex >= 0) return raw;
  return raw;
}

function matchEditionArticlePath(pathname: string): { year: string; month: string; day: string; slug: string } | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 4) return null;
  const [year, month, day, slug] = segments;
  if (!/^\d+$/.test(year) || !/^\d+$/.test(month) || !/^\d+$/.test(day)) return null;
  return { year, month, day, slug: decodeURIComponent(slug) };
}

function searchAnchorUri(searchParams: URLSearchParams): string | null {
  const anchorKind = canonicalObjectKind(searchParams.get("anchorKind") ?? "");
  const anchorId = searchParams.get("anchorId")?.trim() ?? "";
  if (!anchorKind || !anchorId) return null;
  return `papyrus://${anchorKind}/${encodeURIComponent(anchorId)}`;
}

function objectKindToWebPath(kind: PapyrusObjectKind, objectId: string): string {
  const encoded = encodeURIComponent(decodeURIComponent(objectId));
  if (kind === "reference") return `/newsroom/references/${encoded}`;
  if (kind === "message") return `/newsroom/messages/${encoded}`;
  if (kind === "assignment") return `/newsroom/assignments/${encoded}`;
  if (kind === "category") return `/newsroom/topics?category=${encoded}`;
  if (kind === "semanticNode") return `/newsroom/concepts?node=${encoded}`;
  if (kind === "newsroomSection") return `/newsroom/sections/${encoded}`;
  if (kind === "item") return `/articles/${encoded}`;
  return `/newsroom?object=${encodeURIComponent(kind)}:${encoded}`;
}

function parsePapyrusUri(uri: string): { kind: string; id: string } {
  const parsed = new URL(uri);
  if (parsed.protocol !== "papyrus:") throw new Error(`Papyrus URI must use papyrus:// scheme: ${uri}`);
  if (parsed.search || parsed.hash) throw new Error(`Papyrus URI must not include query or fragment: ${uri}`);
  const kind = canonicalObjectKind(decodeURIComponent(parsed.hostname));
  const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!kind) throw new Error(`Papyrus URI kind is required: ${uri}`);
  if (!id) throw new Error(`Papyrus URI object id is required: ${uri}`);
  return { kind, id };
}

function canonicalObjectKind(kind: string): string | null {
  const trimmed = kind.trim();
  if (!trimmed) return null;
  if (trimmed === "newsroom" || trimmed === "site") return trimmed;
  if (PAPYRUS_OBJECT_KINDS.has(trimmed as PapyrusObjectKind)) return trimmed;
  const lowered = trimmed.toLowerCase();
  for (const candidate of PAPYRUS_OBJECT_KINDS) {
    if (candidate.toLowerCase() === lowered) return candidate;
  }
  if (lowered === "newsroomsection") return "newsroomSection";
  if (lowered === "semanticnode") return "semanticNode";
  if (lowered === "categoryset") return "categorySet";
  return null;
}

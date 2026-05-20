const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

type EditionDateRouteInput = {
  year: string;
  month: string;
  day: string;
};

type ParsedEditionDateRoute = {
  editionDate: string;
  canonicalPath: string;
  isCanonical: boolean;
};

type ParsedEditionPageRoute = ParsedEditionDateRoute & {
  pageNumber: number;
};

type ParsedEditionArticleRoute = ParsedEditionDateRoute & {
  articleSlug: string;
};

type ParsedEditionSectionRoute = ParsedEditionDateRoute & {
  sectionKey: string;
};

const RESERVED_DATE_CHILD_SEGMENTS = new Set(["page", "section"]);

export function getEditionDatePath(editionDate: string): string {
  const match = editionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "/";

  const monthIndex = Number(match[2]) - 1;
  const monthName = MONTH_NAMES[monthIndex];
  if (!monthName) return "/";

  return `/${match[1]}/${monthName}/${match[3]}`;
}

export function getEditionPagePath(editionDate: string, pageNumber: number): string {
  const basePath = getEditionDatePath(editionDate);
  return pageNumber <= 1 ? basePath : `${basePath}/page/${pageNumber}`;
}

export function getEditionSectionPath(editionDate: string, sectionKey: string): string {
  return `${getEditionDatePath(editionDate)}/section/${encodeURIComponent(sectionKey)}`;
}

export function getEditionArticlePath(editionDate: string, articleSlug: string): string {
  return `${getEditionDatePath(editionDate)}/${encodeURIComponent(articleSlug)}`;
}

export const getEditionItemPath = getEditionArticlePath;

export function parseEditionDateRoute(input: EditionDateRouteInput): ParsedEditionDateRoute | null {
  const parsed = parseEditionDateSegments(input);
  if (!parsed) return null;

  return {
    ...parsed,
    isCanonical: getCurrentDatePath(input) === parsed.canonicalPath,
  };
}

export function parseEditionPageRoute(input: EditionDateRouteInput & { pageNumber: string }): ParsedEditionPageRoute | null {
  const parsed = parseEditionDateSegments(input);
  if (!parsed) return null;
  if (!/^\d+$/.test(input.pageNumber)) return null;

  const pageNumber = Number(input.pageNumber);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return null;

  const canonicalPath = getEditionPagePath(parsed.editionDate, pageNumber);
  const currentPath = `${getCurrentDatePath(input)}/page/${input.pageNumber}`;
  return {
    editionDate: parsed.editionDate,
    canonicalPath,
    isCanonical: currentPath === canonicalPath,
    pageNumber,
  };
}

export function parseEditionArticleRoute(input: EditionDateRouteInput & { articleSlug: string }): ParsedEditionArticleRoute | null {
  const parsed = parseEditionDateSegments(input);
  if (!parsed) return null;
  if (RESERVED_DATE_CHILD_SEGMENTS.has(input.articleSlug.toLowerCase())) return null;

  const canonicalPath = getEditionArticlePath(parsed.editionDate, input.articleSlug);
  const currentPath = `${getCurrentDatePath(input)}/${input.articleSlug}`;
  return {
    editionDate: parsed.editionDate,
    canonicalPath,
    isCanonical: currentPath === canonicalPath,
    articleSlug: input.articleSlug,
  };
}

export function parseEditionSectionRoute(input: EditionDateRouteInput & { sectionKey: string }): ParsedEditionSectionRoute | null {
  const parsed = parseEditionDateSegments(input);
  if (!parsed) return null;
  if (!input.sectionKey.trim()) return null;

  const canonicalPath = getEditionSectionPath(parsed.editionDate, input.sectionKey);
  const currentPath = `${getCurrentDatePath(input)}/section/${input.sectionKey}`;
  return {
    editionDate: parsed.editionDate,
    canonicalPath,
    isCanonical: currentPath === canonicalPath,
    sectionKey: input.sectionKey,
  };
}

function parseEditionDateSegments(input: EditionDateRouteInput): Omit<ParsedEditionDateRoute, "isCanonical"> | null {
  if (!/^\d{4}$/.test(input.year)) return null;

  const monthIndex = MONTH_NAMES.indexOf(input.month.toLowerCase() as (typeof MONTH_NAMES)[number]);
  if (monthIndex < 0) return null;

  if (!/^\d{1,2}$/.test(input.day)) return null;
  const dayNumber = Number(input.day);
  if (dayNumber < 1 || dayNumber > 31) return null;

  const monthNumber = monthIndex + 1;
  const canonicalDay = String(dayNumber).padStart(2, "0");
  const editionDate = `${input.year}-${String(monthNumber).padStart(2, "0")}-${canonicalDay}`;
  if (!isValidIsoDate(editionDate)) return null;

  return {
    editionDate,
    canonicalPath: getEditionDatePath(editionDate),
  };
}

function getCurrentDatePath(input: EditionDateRouteInput): string {
  return `/${input.year}/${input.month}/${input.day}`;
}

function isValidIsoDate(editionDate: string): boolean {
  const [year, month, day] = editionDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

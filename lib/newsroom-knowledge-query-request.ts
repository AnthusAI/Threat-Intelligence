export type NewsroomKnowledgeQueryAnchor = {
  kind: "assignment" | "category" | "categorySet" | "item" | "message" | "newsroomSection" | "reference" | "semanticNode";
  id: string;
  lineageId?: string | null;
};

export type NewsroomKnowledgeQueryTarget = {
  anchor: NewsroomKnowledgeQueryAnchor;
  title: string;
  subtitle?: string | null;
};

type BuildKnowledgeQueryInputOptions = {
  profile?: "researcher" | "reporter" | "editor" | "reviewer" | "chat";
  semanticSearch?: boolean;
};

export function buildNewsroomKnowledgeQueryInput(
  target: NewsroomKnowledgeQueryTarget | null,
  semanticText: string,
  maxTokens: number,
  options: BuildKnowledgeQueryInputOptions = {},
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    semanticQuery: semanticText.trim(),
    scope: {
      depth: 1,
      topK: target ? 18 : 24,
      relatedRecordLimit: target ? 8 : 10,
      semanticSearch: options.semanticSearch ?? true,
    },
    profile: options.profile ?? "editor",
    ranking: {
      profile: "balanced",
      diversity: target ? "balanced" : "broad",
    },
    output: {
      format: "markdown",
      maxTokens,
    },
  };
  if (target) {
    const anchor: Record<string, unknown> = {
      kind: target.anchor.kind,
      id: target.anchor.id,
    };
    if (target.anchor.lineageId) anchor.lineageId = target.anchor.lineageId;
    request.anchors = [anchor];
  }
  return request;
}

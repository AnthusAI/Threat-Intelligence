import type { Article } from "../../lib/articles";

const PAPYRUS_SECTION = "Papyrus";

export const seedEditionArticles: Article[] = [
  {
    slug: "papyrus-introduction",
    shortSlug: "INTRO",
    section: PAPYRUS_SECTION,
    headline: "You're the Executive Editor",
    deck: "A living knowledge base and agent staff turn your judgment into finished editions.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/papyrus-plant-placeholder.png",
      alt: "A black papyrus plant silhouette",
      caption: "Papyrus treats publishing as steering, curation, and approval rather than constant manual drafting.",
      credit: "Papyrus",
      layout: {
        minHeight: 120,
        preferredHeight: 230,
        maxHeight: 420,
        aspectRatio: 0.785,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "You set the mission, define the standards, and decide what deserves attention. The system gives you a living knowledge base and an agent staff that can keep researching, reporting, editing, and laying out editions in the direction you choose.",
      "Instead of beginning with blank article forms, teams begin with mission, policy, and coverage intent. Those editorial constraints become operating rails for an automated newsroom that runs continuously.",
      "The system is optimized for publications that care about the same promise readers expect from strong journalism: establish facts, add context, identify trends, and explain why events matter now.",
      "It is also designed around a reader contract: each edition should be bounded, curated, and skimmable, not an endless stream that asks readers to keep searching for the next useful thing.",
      "Papyrus is not a black box that replaces editors. It keeps a visible operating loop where people direct what the system investigates, what it trusts, and what it publishes.",
      "That operating model creates consistency across editions while still leaving room for human intervention when a story needs a deliberate voice or policy-sensitive judgment.",
      "In practice, that means your job changes from filling empty slots to building the conditions under which good coverage keeps appearing. You are setting direction, approving quality, and deciding when the system needs stronger intervention.",
      "The knowledge base is the newsroom's working memory. It accumulates source decisions, topic priorities, and policy-bounded context so each edition can begin from what the publication has already learned rather than from scratch.",
      "That is why the executive-editor framing matters. The system can do the legwork, but the publication still reflects human judgment about scope, standards, and what readers should understand before they move on.",
    ],
  },
  {
    slug: "papyrus-reader-contract",
    shortSlug: "READER",
    section: PAPYRUS_SECTION,
    headline: "Stop Doom Scrolling",
    deck: "Bounded editions replace infinite feeds, so readers know what they are getting and when they are done.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/agent-procedure-continuum.svg",
      alt: "A continuum from scripts to bounded agents",
      caption: "A Papyrus edition is a finite editorial object, not an open-ended engagement loop.",
      credit: "Papyrus chart",
      layout: {
        minHeight: 120,
        preferredHeight: 220,
        maxHeight: 380,
        aspectRatio: 1.5,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "This publication rejects the doomscrolling bargain. It is not trying to maximize session length, harvest impulse signals, or keep readers searching for the next hit of novelty.",
      "A published edition is a bounded editorial object. It has a beginning, an end, and a point of view about what deserves attention now.",
      "That constraint is part of the product promise. Readers should know roughly what kind of commitment they are making: something they can skim over breakfast, between meetings, or as part of a daily or weekly routine.",
      "The newspaper form matters because it makes the whole editorial shape visible. Hierarchy, proximity, continuation, images, pull quotes, and endings all help readers understand how stories relate to one another without surrendering to an endless feed.",
      "This is not nostalgia for print. It is a rejection of an interface pattern that treats attention as something to capture indefinitely.",
      "An edition should feel more like a useful briefing than a bottomless timeline: here is what matters, here is why, and then you are allowed to be done.",
      "That reader contract also changes the newsroom’s incentives. The goal is not to produce whatever keeps people clicking. The goal is to publish a finite package that earns trust by making judgment, context, and limits visible.",
      "A finite edition also changes how readers approach the publication. They can skim the whole shape first, decide what deserves closer attention, and trust that the package will end instead of opening into an endless reading obligation.",
      "That sense of closure is part of the editorial promise. The system is saying: this is today's or this week's issue, this is the hierarchy of importance, and this is the amount of attention we are asking from you.",
      "When the edition succeeds, it becomes a routine rather than a trap. Readers can return because the publication respects their time, not because the interface keeps dangling one more possible reward.",
    ],
  },
  {
    slug: "papyrus-steering-and-curation",
    shortSlug: "STEER",
    section: PAPYRUS_SECTION,
    headline: "How Humans Steer the Newsroom",
    deck: "You can steer lightly or heavily by setting mission, policies, topic priorities, and evidence standards.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/agent-procedure-continuum.svg",
      alt: "A continuum from scripts to bounded agents",
      caption: "Papyrus keeps agent behavior bounded by policy, section doctrine, and curation feedback.",
      credit: "Papyrus chart",
      layout: {
        minHeight: 120,
        preferredHeight: 220,
        maxHeight: 380,
        aspectRatio: 1.5,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "Steering starts with publication doctrine: mission, policies, and section-level priorities. These settings tell the newsroom what outcomes matter and what standards cannot be violated.",
      "People then guide discovery by asking research agents to investigate explicit questions, themes, and trend lines. That guidance can be broad strategic direction or very specific assignment-level instructions.",
      "As sources are collected, human reviewers rate, vote on, and comment on references. Those decisions are not cosmetic feedback; they shape the knowledge base that future planning and drafting rely on.",
      "Papyrus supports high-touch and low-touch operation. Teams can actively direct each cycle or set stable policy and allow the system to continue in the same editorial direction by default.",
      "When needed, humans can still issue direct editorial or reporting assignments, or write a piece manually. The default mode remains automated execution within human-defined boundaries.",
      "The practical effect is that editors spend more time shaping the system’s judgment than filling empty pages. Steering becomes a durable newsroom asset, not a one-off instruction lost after a single story.",
    ],
  },
  {
    slug: "papyrus-agent-workflow",
    shortSlug: "FLOW",
    section: PAPYRUS_SECTION,
    headline: "The Autonomous Newsroom",
    deck: "Research, curation, planning, reporting, drafting, and layout form one continuous pipeline with human proofing at publication time.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/papyrus-plant-placeholder.png",
      alt: "A black papyrus plant silhouette",
      caption: "The newsroom pipeline moves from research to approved edition while preserving human oversight.",
      credit: "Papyrus",
      layout: {
        minHeight: 120,
        preferredHeight: 230,
        maxHeight: 420,
        aspectRatio: 0.785,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "Research agents gather source material and produce candidate evidence. Human curation determines what becomes trusted input and what stays out of scope.",
      "Editor agents then use the curated knowledge base plus policy constraints to prioritize coverage. They look for movement in signals and assign reporting work where the newsroom should invest attention.",
      "Reporter agents collect context and structured findings. Copywriting agents turn that reporting context into draft stories aligned with style and policy.",
      "Layout agents package approved copy into edition pages, balancing readability and visual hierarchy. Human review remains the final gate before publication.",
      "The result is a repeatable workflow that can produce editions continuously while preserving traceability from source curation to final approval.",
      "Because the workflow ends in an edition rather than a feed, each stage has to make choices. The newsroom is always asking what belongs in this issue, what can wait, and what context a reader needs before moving on.",
      "That pipeline is deliberately specialized. Research agents are not trying to publish directly, editor agents are not pretending to be reporters, and layout agents are not inventing coverage priorities. Each stage has a narrower responsibility and passes structured context to the next.",
      "Human oversight is threaded through the entire chain. People can review references, redirect assignments, tighten policy, reject weak drafts, or approve the finished edition only after the newsroom has shown its work.",
      "The result is automation with visible editorial seams. Readers get a finished publication, while operators can still inspect how evidence, planning, reporting, and presentation combined to produce it.",
    ],
  },
  {
    slug: "papyrus-operating-modes",
    shortSlug: "MODES",
    section: PAPYRUS_SECTION,
    headline: "Operating Modes: Light Touch to Direct Intervention",
    deck: "Papyrus can run as a mostly autonomous publication engine or as a tightly directed editorial system.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/papyrus-plant-placeholder.png",
      alt: "A black papyrus plant silhouette",
      caption: "Teams can choose the amount of steering per cycle without changing the core workflow.",
      credit: "Papyrus",
      layout: {
        minHeight: 100,
        preferredHeight: 210,
        maxHeight: 360,
        aspectRatio: 0.785,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "In light-touch mode, editors set mission, policy, sections, and topic priorities, then let the newsroom continue operating against that standing direction.",
      "In active mode, editors steer each cycle with explicit assignment requests, curation interventions, and coverage pivots based on changing context.",
      "Both modes share the same system contract: agent work is policy-bounded, source-aware, and traceable through curation and approval history.",
      "This flexibility makes Papyrus suitable for small teams that need automation to keep publishing velocity, and for larger teams that want finer editorial control over every stage.",
      "The amount of steering can change without changing the reader promise. Whether the newsroom is running lightly or under close direction, the output is still a shaped edition with a finite scope.",
    ],
  },
  {
    slug: "papyrus-reference-governance",
    shortSlug: "SOURCES",
    section: PAPYRUS_SECTION,
    headline: "Reference Governance Is the Core Quality Lever",
    deck: "Quality depends less on prompt phrasing and more on the source curation loop humans maintain.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/agent-procedure-continuum.svg",
      alt: "A continuum from scripts to bounded agents",
      caption: "Source governance keeps model output aligned with publication standards.",
      credit: "Papyrus chart",
      layout: {
        minHeight: 100,
        preferredHeight: 210,
        maxHeight: 360,
        aspectRatio: 1.5,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "Papyrus treats references as first-class editorial artifacts. The publication’s reliability depends on what evidence enters the knowledge base and how it is evaluated.",
      "Human reviewers assess relevance, reliability, and topical fit. Their ratings and comments form durable steering memory that informs future research and planning.",
      "This approach prevents the newsroom from drifting toward whichever sources are easiest for agents to retrieve. Editorial standards stay explicit and enforceable.",
      "Over time, curated reference history becomes institutional memory: not only what the newsroom knows, but why it considers that knowledge credible.",
      "That memory is what lets future editions explain broader trends instead of merely summarizing isolated links. The system can connect new references to the publication’s accepted context.",
    ],
  },
  {
    slug: "papyrus-first-install",
    shortSlug: "START",
    section: PAPYRUS_SECTION,
    headline: "What to Do in a Fresh Installation",
    deck: "Set doctrine, configure sections, curate references, and publish the first edition to establish a stable newsroom trajectory.",
    byline: "Papyrus Editorial Team",
    dateline: "NEWSROOM",
    image: {
      src: "/papyrus-plant-placeholder.png",
      alt: "A black papyrus plant silhouette",
      caption: "First-install setup defines the direction the newsroom will continue to follow.",
      credit: "Papyrus",
      layout: {
        minHeight: 100,
        preferredHeight: 210,
        maxHeight: 360,
        aspectRatio: 0.785,
        crop: "contain",
        wrapsText: true,
      },
    },
    body: [
      "Start by defining mission and policy so the newsroom has a clear editorial direction before it begins autonomous cycles.",
      "Next, configure sections and topic priorities that match the publication scope you want readers to experience.",
      "Then curate initial references to establish quality expectations for what the knowledge base will trust and reuse.",
      "After those inputs are set, publish the first edition. From that point, the newsroom can continue operating in the direction you established, with ongoing human steering as needed.",
    ],
  },
];

export type SeedEditionConfig = {
  id: string;
  slug: string;
  title: string;
  description: string;
  publishDate: string;
  publishedAt: string;
  articleOrder: string[];
  layoutPlan: unknown;
};

export function getSeedEditionConfig(): SeedEditionConfig {
  const publishDate = "2026-05-22";
  const itemIds = seedEditionArticles.map((article) => article.slug);
  return {
    id: "edition-current",
    slug: "current",
    title: "Papyrus First Edition",
    description: "Seeded first edition introducing Papyrus newsroom workflows.",
    publishDate,
    publishedAt: `${publishDate}T12:00:00.000Z`,
    articleOrder: itemIds,
    layoutPlan: createSeedEditionLayoutPlan(itemIds),
  };
}

function createSeedEditionLayoutPlan(itemIds: string[]) {
  const featuredFrontItemIds = [
    "papyrus-reader-contract",
    "papyrus-introduction",
    "papyrus-agent-workflow",
  ];
  const pageTwoItemIds = new Set(["papyrus-first-install"]);
  const frontItemIds = itemIds.length < 3
    ? itemIds
    : [
        ...featuredFrontItemIds.filter((itemId) => itemIds.includes(itemId)),
        ...itemIds.filter((itemId) => !featuredFrontItemIds.includes(itemId) && !pageTwoItemIds.has(itemId)),
      ];
  return {
    pages: [
      {
        id: "page-1",
        pageNumber: 1,
        presetId: "front.mosaic",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "front-page-news",
            type: "fullPage",
            localGrid: { columns: { min: 1, preferred: 6, max: 6 } },
            responsiveLayouts: getSeedFrontResponsiveLayouts(),
            blocks: frontItemIds.map((itemId, index) => ({
              id: `front-${itemId}`,
              type: "articleFrame",
              presetId: "front.teaser",
              itemId,
              flowKey: itemId,
              startCursor: "beginning",
              role: index === 1 ? "feature" : index === 0 || index === 2 ? "rail" : "standard",
              editorialPriority: index === 1 ? "primary" : index === 0 || index === 2 ? "secondary" : "tertiary",
              typography: { headlineScale: index === 1 ? "feature" : "standard" },
              span: { min: 1, preferred: [1, 4, 1, 2, 2, 2][index] ?? 1, max: [1, 4, 1, 2, 2, 2][index] ?? 1 },
              localGrid: index === 1 ? { columns: { min: 1, preferred: 4, max: 4 } } : undefined,
              media: index === 1
                ? [
                    {
                      required: true,
                      assetRole: "lead",
                      placement: {
                        anchor: "right",
                        span: { min: 1, preferred: 1, max: 1 },
                        vertical: "top",
                        collapse: "inline",
                        crop: "preserve",
                        wrapsText: true,
                      },
                    },
                  ]
                : [],
              composition: index === 1
                ? {
                    title: [
                      {
                        slot: "label",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                      {
                        slot: "headline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                    ],
                    lead: [
                      {
                        slot: "deck",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "byline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "media",
                        mediaIndex: 0,
                        placement: {
                          anchor: "right",
                          span: { min: 1, preferred: 1, max: 1 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                    ],
                  }
                : undefined,
              cutPolicy: getSeedCutPolicy(itemId),
            })),
          },
        ],
      },
      {
        id: "page-2",
        pageNumber: 2,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "papyrus-first-install-guide",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("papyrus-first-install", 2, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "papyrus-reader-contract-continuation",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-reader-contract", 2, {
                required: true,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
      {
        id: "page-3",
        pageNumber: 3,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "papyrus-introduction-tail",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-introduction", 3, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "papyrus-workflow-tail",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-agent-workflow", 3, {
                required: false,
                anchor: "center",
                span: { min: 2, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
        ],
      },
    ],
  };
}

function getSeedFrontResponsiveLayouts() {
  return [
    {
      minColumns: 6,
      maxColumns: 6,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 2,
          columnSpan: 4,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 6,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: 2, rowSpan: 1 },
    },
    {
      minColumns: 5,
      maxColumns: 5,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 2,
          columnSpan: 3,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 5,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: 2, rowSpan: 1 },
    },
    {
      minColumns: 4,
      maxColumns: 4,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 4,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 3,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: 2, rowSpan: 1 },
    },
    {
      minColumns: 1,
      maxColumns: 3,
      order: "editorialPriority",
      slots: [],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
  ];
}

function createSeedPageArticleBlock(
  itemId: string,
  pageNumber: number,
  media: {
    required: boolean;
    anchor: string;
    span: { min: number; preferred: number; max: number };
    vertical: string;
  },
) {
  return {
    id: `${itemId}-page-${pageNumber}-lead`,
    type: "articleFrame",
    presetId: "article.mediaInset",
    itemId,
    flowKey: itemId,
    startCursor: "beginning",
    role: "primary",
    localGrid: { columns: { min: 2, preferred: 6, max: 6 } },
    media: [
      {
        required: media.required,
        assetRole: "lead",
        placement: {
          anchor: media.anchor,
          span: media.span,
          vertical: media.vertical,
          collapse: "inline",
          crop: "preserve",
          wrapsText: true,
        },
      },
    ],
  };
}

function createSeedContinuationBlock(
  itemId: string,
  pageNumber: number,
  media: {
    required: boolean;
    anchor: string;
    span: { min: number; preferred: number; max: number };
    vertical: string;
  },
) {
  return {
    id: `${itemId}-page-${pageNumber}`,
    type: "articleFrame",
    presetId: "article.mediaInset",
    itemId,
    flowKey: itemId,
    startCursor: "current",
    role: "primary",
    localGrid: { columns: { min: 2, preferred: 6, max: 6 } },
    media: [
      {
        required: media.required,
        assetRole: "continuationInset",
        placement: {
          anchor: media.anchor,
          span: media.span,
          vertical: media.vertical,
          collapse: "inline",
          crop: "preserve",
          wrapsText: true,
        },
      },
    ],
    pullQuote: {
      required: false,
      placements: [
        {
          anchor: media.anchor === "left" ? "right" : "left",
          span: { min: 1, preferred: 1, max: 2 },
          vertical: "middle",
          collapse: "omit",
          crop: "preserve",
          wrapsText: true,
        },
      ],
    },
  };
}

function getSeedCutPolicy(itemId: string) {
  if (itemId === "papyrus-reader-contract") return { bodyDepthRows: 14, jumpTargetPage: 2 };
  if (itemId === "papyrus-introduction") return { bodyDepthRows: 14, jumpTargetPage: 3 };
  if (itemId === "papyrus-agent-workflow") return { bodyDepthRows: 14, jumpTargetPage: 3 };
  return undefined;
}

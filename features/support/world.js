const { After, setDefaultTimeout, setWorldConstructor } = require("@cucumber/cucumber");
const { chromium } = require("playwright");

setDefaultTimeout(60_000);

class PapyrusWorld {
  constructor() {
    this.baseUrl = process.env.PAPYRUS_BASE_URL ?? "http://localhost:3001";
    this.browser = null;
    this.page = null;
    this.consoleErrors = [];
    this.currentScenarioId = null;
    this.testEditorReader = false;
    this.newsroomSummaryDelayMs = 0;
    this.newsroomSummaryMock = null;
    this.newsroomMessageDetailMock = null;
    this.newsroomQualityMutationMock = null;
  }

  async openScenario(scenarioId, width, height) {
    this.currentScenarioId = scenarioId;
    await this.openPath(`/?scenario=${encodeURIComponent(scenarioId)}`, width, height);
    await this.page.waitForFunction(
      (expectedScenarioId) => (
        window.__PAPYRUS_LAYOUT__ &&
        window.__PAPYRUS_SCENARIO__ === expectedScenarioId &&
        document.querySelector(".paper-page--active")
      ),
      scenarioId,
      { timeout: 15_000 },
    );
  }

  async openPath(path, width, height) {
    await this.close();
    this.consoleErrors = [];
    this.browser = await chromium.launch({
      headless: process.env.PAPYRUS_HEADLESS !== "false",
    });
    this.page = await this.browser.newPage({
      viewport: { width, height },
    });
    if (this.testEditorReader) {
      await this.page.addInitScript(() => {
        window.localStorage.setItem("papyrus:test-editor", "true");
      });
    }
    if (this.newsroomMessageDetailMock === "reference-curation") {
      await this.page.addInitScript(() => {
        window.localStorage.setItem("papyrus:test-newsroom-mock", JSON.stringify({
          summary: {
            generatedAt: "2026-05-20T05:34:50.280Z",
            staleAt: "2026-05-20T05:34:50.280Z",
            source: "snapshot",
            counts: {
              messages: 1,
              references: 1,
              assignments: 0,
              categorys: 0,
              semanticNodes: 0,
            },
            facets: {
              messages: {
                byKind: { reference_curation: 1 },
                byDomain: { commentary: 1 },
              },
            },
            assignmentStatusCounts: {},
            assignmentTypeCounts: {},
            referenceStatusCounts: { accepted: 1 },
            messageKindCounts: { reference_curation: 1 },
            messageDomainCounts: { commentary: 1 },
          },
          messages: [
            {
              id: "message-mock-reference-curation-001",
              messageKind: "reference_curation",
              messageDomain: "commentary",
              status: "active",
              summary: "https://example.com/papers/mock-reference.pdf: accepted",
              source: "newsroom",
              importRunId: null,
              authorSub: null,
              authorUserProfileId: null,
              authorLabel: "Test Editor",
              createdAt: "2026-05-20T05:34:50.280Z",
              updatedAt: "2026-05-20T05:34:50.280Z",
              newsroomFeedKey: "messages",
            },
          ],
          semanticRelations: [
            {
              id: "semantic-relation-mock-message-reference-001",
              relationState: "current",
              predicate: "comment",
              relationTypeId: "semantic-relation-type-comment",
              relationTypeKey: "comment",
              relationDomain: "commentary",
              subjectKind: "message",
              subjectId: "message-mock-reference-curation-001",
              subjectLineageId: "message-mock-reference-curation-001",
              subjectVersionNumber: 1,
              objectKind: "reference",
              objectId: "reference-mock-001-v1",
              objectLineageId: "reference-mock-001",
              objectVersionNumber: 1,
              subjectStateKey: "message#message-mock-reference-curation-001#current",
              objectStateKey: "reference#reference-mock-001#current",
              objectSubjectStateKey: "reference#reference-mock-001#current#message",
              predicateObjectStateKey: "comment#reference#reference-mock-001#current",
              subjectVersionKey: "message#message-mock-reference-curation-001",
              objectVersionKey: "reference#reference-mock-001-v1",
              score: null,
              confidence: null,
              rank: 1,
              classifierId: null,
              modelVersion: null,
              reviewRecommended: false,
              sourceSnapshotId: null,
              importRunId: null,
              importedAt: "2026-05-20T05:34:50.280Z",
              createdAt: "2026-05-20T05:34:50.280Z",
              updatedAt: "2026-05-20T05:34:50.280Z",
              newsroomFeedKey: "semanticRelations",
              metadata: null,
            },
          ],
          references: [
            {
              id: "reference-mock-001-v1",
              lineageId: "reference-mock-001",
              versionNumber: 1,
              versionState: "current",
              corpusId: "knowledge-corpus-mock",
              externalItemId: "mock-reference-001",
              title: "Red-Teaming for Generative AI",
              authors: ["A. Researcher"],
              sourceUri: "https://example.com/papers/mock-reference.pdf",
              mediaType: "application/pdf",
              importedAt: "2026-05-20T05:34:50.280Z",
              curationStatus: "accepted",
              curationStatusKey: "knowledge-corpus-mock#accepted",
              curationStatusUpdatedAt: "2026-05-20T05:34:50.280Z",
              curationStatusUpdatedBy: "Test Editor",
              newsroomFeedKey: "references",
              metadata: {
                title: "Red-Teaming for Generative AI",
                subtitle: "Silver Bullet or Security Theater?",
                summary: "An examination of whether red-teaming materially improves generative AI security outcomes.",
              },
              updatedAt: "2026-05-20T05:34:50.280Z",
            },
          ],
          payloads: {
            "reference:reference-mock-001-v1": [
              {
                attachment: {
                  id: "model-attachment-reference-mock-001-v1-metadata",
                  ownerKind: "reference",
                  ownerId: "reference-mock-001-v1",
                  ownerLineageId: "reference-mock-001",
                  role: "metadata",
                  sortKey: "metadata",
                  storagePath: "newsroom/payloads/reference/reference-mock-001-v1/metadata/metadata.json",
                  filename: "metadata.json",
                  mediaType: "application/json",
                  status: "active",
                },
                text: null,
                json: {
                  title: "Red-Teaming for Generative AI",
                  subtitle: "Silver Bullet or Security Theater?",
                  summary: "An examination of whether red-teaming materially improves generative AI security outcomes.",
                },
                error: null,
              },
            ],
          },
        }));
      });
    }
    if (this.newsroomQualityMutationMock === "fail") {
      await this.page.addInitScript(() => {
        window.localStorage.setItem("papyrus:test-reference-quality-mutation", "fail");
      });
    }
    if (
      this.newsroomSummaryDelayMs > 0 ||
      this.newsroomSummaryMock === "missing" ||
      this.newsroomMessageDetailMock === "reference-curation"
    ) {
      const delayMs = this.newsroomSummaryDelayMs;
      const mock = this.newsroomSummaryMock;
      const messageDetailMock = this.newsroomMessageDetailMock;
      await this.page.route("**/graphql", async (route) => {
        const request = route.request();
        const body = request.postData() ?? "";
        if (messageDetailMock === "reference-curation") {
          if (body.includes("listMessagesByNewsroomFeedAndCreatedAt")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  listMessagesByNewsroomFeedAndCreatedAt: {
                    items: [
                      {
                        id: "message-mock-reference-curation-001",
                        messageKind: "reference_curation",
                        messageDomain: "commentary",
                        status: "active",
                        summary: "https://example.com/papers/mock-reference.pdf: accepted",
                        source: "newsroom",
                        importRunId: null,
                        authorSub: null,
                        authorUserProfileId: null,
                        authorLabel: "Test Editor",
                        createdAt: "2026-05-20T05:34:50.280Z",
                        updatedAt: "2026-05-20T05:34:50.280Z",
                        newsroomFeedKey: "messages",
                      },
                    ],
                    nextToken: null,
                  },
                },
              }),
            });
            return;
          }
          if (body.includes("listSemanticRelationsByNewsroomFeedAndCreatedAt")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  listSemanticRelationsByNewsroomFeedAndCreatedAt: {
                    items: [
                      {
                        id: "semantic-relation-mock-message-reference-001",
                        relationState: "current",
                        predicate: "comment",
                        relationTypeId: "semantic-relation-type-comment",
                        relationTypeKey: "comment",
                        relationDomain: "commentary",
                        subjectKind: "message",
                        subjectId: "message-mock-reference-curation-001",
                        subjectLineageId: "message-mock-reference-curation-001",
                        subjectVersionNumber: 1,
                        objectKind: "reference",
                        objectId: "reference-mock-001-v1",
                        objectLineageId: "reference-mock-001",
                        objectVersionNumber: 1,
                        subjectStateKey: "message#message-mock-reference-curation-001#current",
                        objectStateKey: "reference#reference-mock-001#current",
                        objectSubjectStateKey: "reference#reference-mock-001#current#message",
                        predicateObjectStateKey: "comment#reference#reference-mock-001#current",
                        subjectVersionKey: "message#message-mock-reference-curation-001",
                        objectVersionKey: "reference#reference-mock-001-v1",
                        score: null,
                        confidence: null,
                        rank: 1,
                        classifierId: null,
                        modelVersion: null,
                        reviewRecommended: false,
                        sourceSnapshotId: null,
                        importRunId: null,
                        importedAt: "2026-05-20T05:34:50.280Z",
                        createdAt: "2026-05-20T05:34:50.280Z",
                        updatedAt: "2026-05-20T05:34:50.280Z",
                        newsroomFeedKey: "semanticRelations",
                        metadata: null,
                      },
                    ],
                    nextToken: null,
                  },
                },
              }),
            });
            return;
          }
          if (body.includes("getReference")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  getReference: {
                    id: "reference-mock-001-v1",
                    lineageId: "reference-mock-001",
                    versionNumber: 1,
                    previousVersionId: null,
                    versionState: "current",
                    versionCreatedAt: null,
                    versionCreatedBy: null,
                    changeReason: null,
                    contentHash: null,
                    corpusId: "knowledge-corpus-mock",
                    externalItemId: "mock-reference-001",
                    title: "Red-Teaming for Generative AI",
                    authors: ["A. Researcher"],
                    sourceUri: "https://example.com/papers/mock-reference.pdf",
                    storagePath: null,
                    mediaType: "application/pdf",
                    byteSize: null,
                    sha256: null,
                    sourcePublishedAt: null,
                    sourceUpdatedAt: null,
                    retrievedAt: null,
                    importRunId: null,
                    importedAt: "2026-05-20T05:34:50.280Z",
                    createdAt: "2026-05-20T05:34:50.280Z",
                    curationStatus: "accepted",
                    curationStatusKey: "knowledge-corpus-mock#accepted",
                    curationStatusUpdatedAt: "2026-05-20T05:34:50.280Z",
                    curationStatusUpdatedBy: "Test Editor",
                    curationStatusReason: null,
                    newsroomFeedKey: "references",
                    metadata: {
                      title: "Red-Teaming for Generative AI",
                      subtitle: "Silver Bullet or Security Theater?",
                    },
                    updatedAt: "2026-05-20T05:34:50.280Z",
                  },
                },
              }),
            });
            return;
          }
          if (body.includes("listModelAttachmentsByOwnerRoleAndSortKey")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  listModelAttachmentsByOwnerRoleAndSortKey: {
                    items: [],
                    nextToken: null,
                  },
                },
              }),
            });
            return;
          }
          if (body.includes("getNewsroomSummary")) {
            const now = new Date().toISOString();
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                data: {
                  getNewsroomSummary: {
                    generatedAt: now,
                    staleAt: now,
                    source: "snapshot",
                    counts: {
                      messages: 1,
                      references: 1,
                      assignments: 0,
                      categorys: 0,
                      semanticNodes: 0,
                    },
                    facets: {
                      messages: {
                        byKind: { reference_curation: 1 },
                        byDomain: { commentary: 1 },
                      },
                    },
                    assignmentStatusCounts: {},
                    assignmentTypeCounts: {},
                    referenceStatusCounts: { accepted: 1 },
                    messageKindCounts: { reference_curation: 1 },
                    messageDomainCounts: { commentary: 1 },
                  },
                },
              }),
            });
            return;
          }
        }
        if (!body.includes("getNewsroomSummary")) {
          await route.continue();
          return;
        }
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (mock === "missing") {
          const now = new Date().toISOString();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                getNewsroomSummary: {
                  generatedAt: now,
                  staleAt: now,
                  source: "missing",
                  counts: {},
                  facets: {},
                  assignmentStatusCounts: {},
                  assignmentTypeCounts: {},
                  referenceStatusCounts: {},
                  messageKindCounts: {},
                  messageDomainCounts: {},
                },
              },
            }),
          });
          return;
        }
        await route.continue();
      });
    }
    this.page.on("console", (message) => {
      if (message.type() === "error") {
        this.consoleErrors.push(message.text());
      }
    });

    const url = new URL(path, this.baseUrl);
    await this.page.goto(url.toString(), { waitUntil: "load" });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
    this.page = null;
  }
}

setWorldConstructor(PapyrusWorld);

After(async function () {
  await this.close();
});

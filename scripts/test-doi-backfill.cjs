const assert = require("node:assert/strict");

const {
  extractArxivId,
  normalizeArxivId,
  normalizeDoi,
  normalizeIdentifierTypes,
  normalizeIsbn13,
  normalizePublisherItem,
  resolveDoiForReference,
  resolveIdentifierForReference,
} = require("./lib/papyrus-identifier-backfill.cjs");

async function main() {
  assert.equal(normalizeDoi("https://doi.org/10.18653/v1/2025.EMNLP-main.683"), "10.18653/v1/2025.emnlp-main.683");
  assert.equal(normalizeDoi("DOI: 10.1000/xyz-123."), "10.1000/xyz-123");
  assert.equal(extractArxivId("https://arxiv.org/abs/2501.06322v2"), "2501.06322");
  assert.equal(normalizeArxivId("https://arxiv.org/pdf/cs/9901001v2.pdf"), "cs/9901001");
  assert.equal(normalizeArxivId("arXiv:2402.01680v3"), "2402.01680");
  assert.equal(normalizeIsbn13("0-306-40615-2"), "9780306406157");
  assert.equal(normalizePublisherItem("https://aclanthology.org/2025.findings-acl.671.pdf"), "aclanthology:2025.findings-acl.671");
  assert.equal(normalizePublisherItem("https://openreview.net/forum?id=Vusd1Hw2D9"), "openreview:vusd1hw2d9");
  assert.deepEqual(normalizeIdentifierTypes("doi,arxiv,isbn,publisher-item"), ["doi", "arxiv_id", "isbn13", "publisher_item"]);

  {
    const result = await resolveDoiForReference({
      reference: {
        id: "ref-1",
        title: "START: Self-taught Reasoner with Tools",
        sourceUri: "https://aclanthology.org/2025.emnlp-main.683/",
        sourcePublishedAt: "2025-01-01",
        authors: ["A. Author", "B. Author"],
      },
      metadata: {
        doi: "10.18653/v1/2025.emnlp-main.683",
      },
      useLlm: false,
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.doi, "10.18653/v1/2025.emnlp-main.683");
    assert.equal(result.source, "deterministic_local");
    assert.equal(result.llmUsed, false);
  }

  {
    let llmCalls = 0;
    const mockFetcher = async (url) => {
      if (url.includes("api.openalex.org/works?per-page=8&search=")) {
        return {
          ok: true,
          async json() {
            return {
              results: [
                {
                  doi: "https://doi.org/10.5555/openalex.candidate",
                  title: "Different candidate title",
                  publication_year: 2018,
                  authorships: [{ author: { display_name: "X Y" } }],
                  id: "https://openalex.org/W1",
                },
              ],
            };
          },
        };
      }
      if (url.includes("api.crossref.org/works?rows=8&query.bibliographic=")) {
        return {
          ok: true,
          async json() {
            return {
              message: {
                items: [
                  {
                    DOI: "10.5555/crossref.candidate",
                    title: ["Another unrelated title"],
                    issued: { "date-parts": [[2017]] },
                    author: [{ given: "M", family: "N" }],
                    URL: "https://doi.org/10.5555/crossref.candidate",
                  },
                ],
              },
            };
          },
        };
      }
      return { ok: false, status: 404, statusText: "not found", async json() { return {}; } };
    };
    const result = await resolveDoiForReference({
      reference: {
        id: "ref-2",
        title: "Target paper title",
        sourceUri: "https://example.org/no-doi-here",
        sourcePublishedAt: "2025-01-01",
        authors: ["A. Author"],
      },
      metadata: {},
      useLlm: false,
      fetcher: mockFetcher,
      llmAdjudicator: async () => {
        llmCalls += 1;
        return null;
      },
    });
    assert.equal(result.status, "unresolved");
    assert.equal(result.doi, null);
    assert.equal(llmCalls, 0);
  }

  {
    let llmCalls = 0;
    const result = await resolveDoiForReference({
      reference: {
        id: "ref-3",
        title: "Another target title",
        sourceUri: "https://example.org/no-doi",
        sourcePublishedAt: "2024-01-01",
        authors: ["A. Author"],
      },
      metadata: {},
      useLlm: true,
      fetcher: async () => ({
        ok: true,
        async json() {
          return {
            results: [
              {
                doi: "https://doi.org/10.1111/candidate.a",
                title: "Candidate A",
                publication_year: 2024,
                authorships: [{ author: { display_name: "A Author" } }],
                id: "https://openalex.org/W2",
              },
              {
                doi: "https://doi.org/10.1111/candidate.b",
                title: "Candidate B",
                publication_year: 2024,
                authorships: [{ author: { display_name: "B Author" } }],
                id: "https://openalex.org/W3",
              },
            ],
          };
        },
      }),
      llmAdjudicator: async (_reference, type, candidates) => {
        llmCalls += 1;
        assert.equal(type, "doi");
        assert.ok(Array.isArray(candidates));
        assert.ok(candidates.length > 0);
        return {
          value: "10.1111/candidate.b",
          doi: "10.1111/candidate.b",
          confidence: 0.91,
          rationale: "Best title/author fit.",
          model: "gpt-5.4-mini",
          reasoningEffort: "low",
        };
      },
    });
    assert.equal(llmCalls, 1);
    assert.equal(result.status, "resolved");
    assert.equal(result.source, "llm_adjudication");
    assert.equal(result.doi, "10.1111/candidate.b");
    assert.equal(result.llmUsed, true);
  }

  {
    const result = await resolveIdentifierForReference({
      type: "arxiv_id",
      reference: {
        id: "ref-4",
        title: "Large Language Model based Multi-Agents: A Survey of Progress and Challenges",
        sourceUri: "https://arxiv.org/html/2402.01680v2",
      },
      metadata: {},
      useLlm: false,
      fetcher: async () => ({ ok: false, status: 404, statusText: "not found", async json() { return {}; } }),
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.type, "arxiv_id");
    assert.equal(result.value, "2402.01680");
    assert.equal(result.source, "deterministic_local");
  }

  {
    const result = await resolveIdentifierForReference({
      type: "publisher_item",
      reference: {
        id: "ref-5",
        title: "Rank, Chunk, and Expand",
        sourceUri: "https://aclanthology.org/2025.findings-acl.671.pdf",
      },
      metadata: {},
      useLlm: false,
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.value, "aclanthology:2025.findings-acl.671");
    assert.equal(result.source, "deterministic_local");
  }

  console.log("identifier backfill tests passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});

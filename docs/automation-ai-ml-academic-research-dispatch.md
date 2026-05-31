# Automation: Immediate AI/ML Academic Research Dispatch

Cron automation `ai-ml-research-papers` dispatches a high-priority Science-desk
`source_discovery` assignment against corpus `AI-ML-research`, then optionally
runs `assignments research-intake-now` to discover fresh academic paper
prospects.

## Required automation secrets

Configure these in the Cursor automation secret list (in addition to
`OPENAI_API_KEY` for web search execution):

| Secret | Purpose |
| --- | --- |
| `PAPYRUS_JWT_SECRET` | Mint short-lived `PAPYRUS_GRAPHQL_JWT` without AWS CLI |
| `PAPYRUS_GRAPHQL_ENDPOINT` | Optional; defaults to production AppSync URL |

Alternatively provide `PAPYRUS_GRAPHQL_JWT` directly (short-lived; must be
refreshed periodically).

For SSM-based minting instead of a direct secret, also add
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`.

## Commands

Dispatch only (creates open assignment):

```bash
npm run dispatch:ai-ml-research-papers
```

Dispatch and immediately run source discovery + proposal intake:

```bash
npm run dispatch:ai-ml-research-papers -- --execute-now
```

Dry-run (no GraphQL writes):

```bash
npm run dispatch:ai-ml-research-papers -- --dry-run
```

## Assignment shape

- Section: `science` (New Findings)
- Corpus: `AI-ML-research`
- Mode: `source_discovery`
- Priority: `95`
- Queue: `research:science:immediate`
- Type: `research.edition-candidate` (CLI default)

Focus spans LLMs, AI engineering, RAG, information architecture, embeddings,
encoders, text classifiers, unsupervised/semi-supervised learning, topic
modeling, HMM-related sequence methods, RPA where AI-connected, and behavioral
evaluations for AI agents.

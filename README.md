# Threat Intelligence

An automated newsroom for the threat-intelligence beat. Agents watch the field, update a publication-specific knowledge base, and turn what they find into reporting packets and draft copy an editor can review.

This repository is the product. It is currently a fork of [Papyrus](https://github.com/AnthusAI/Papyrus), the Anthus newsroom CMS. Papyrus is becoming a core dependency. The application will live there. The beat, the corpus, the doctrine, and the published content stay here. This repo survives that split.

Until then, the app in this tree is still the inherited Papyrus application. Commands still say `papyrus`. That is expected.

## Run it

```bash
npm run dev
```

For the shared newsroom engine (layout, GraphQL, newsroom CLI), use the [Papyrus README](https://github.com/AnthusAI/Papyrus). Publication-specific configuration and content belong in this repo.

---

Built by [Anthus AI Solutions](https://anth.us). We run this class of system in production.

This is the Anthus newsroom pointed at threat intelligence. The engine is Papyrus. The beat lives here.

If you need this operated, not just cloned, [talk to us](https://anth.us).

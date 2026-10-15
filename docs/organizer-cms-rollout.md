# Threat Intelligence organizer CMS rollout

Tracked by Papyrus product task PPY-ca252a35-53db-4584-b53e-fdbbd549ce3e.
The brand opts into the released organizer shell. The original taxonomy,
concepts, knowledge search, reference curation, policies, sections, procedures,
identity merging, article and assignment workflows retain their handlers and
backend permissions. Board projects native records and links to their existing
mutation workspaces. No synthetic gateway or classifier is activated.

The checked-in Amplify build spec retains the existing frontend commands and
runtime-output handling. It generates main backend outputs instead of deploying
backend changes, preserving the working Cognito domain, callbacks, roles and
content. The app-ID guard excludes retired legacy applications. Publication
unit tests run before the actual Next build in the hosted pipeline. The public
reader configuration and site-owned content remain unchanged.

Package manifest, lock and infra version metadata must agree. No infrastructure
redeploy is part of this frontend rollout. Stage the exact release first; check
its actual assets, responsive navigation, Settings, signed-out gates and public
reader behavior before merging main. Staging uses production backend outputs:
no destructive tests, role changes or synthetic records there. A labeled demo
may be used for read-only visual checks, never as live-data acceptance.

Read-only API schema compatibility passed for all34 explicit CMS GraphQL
documents, including Board queries. User-session authorization and live mutation
acceptance require separate evidence; reaching Google is only login entry.
The current package exposes a data factory; consumer shims retain only Schema
where no runtime singleton is used. Optional Cyclotron activation and persisted
Story linkage remain separate work.

Rollback restores the previous exact package/lock and removes organizer opt-in,
retaining frontend-only mode to avoid unreviewed backend/auth migrations.

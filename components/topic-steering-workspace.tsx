"use client";

import { Hub } from "aws-amplify/utils";
import { useEffect, useMemo, useState, useTransition } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import { loadEditorNewsDeskState, loadEditorTaxonomyState, type EditorNewsDeskState } from "./news-desk-taxonomy-client";
import { ReaderAuthControl } from "./reader-auth-control";
import type {
  TopicSteeringArtifact,
  TopicSteeringCorpus,
  TopicSteeringDashboard,
  TopicSteeringImportRun,
  TopicSteeringProjection,
  TopicSteeringProposal,
  TopicSteeringTaxonomy,
  TopicSteeringTaxonomyNode,
  TopicSteeringTopic,
  TopicSteeringTopicSet,
} from "../lib/curation-repository";

type ActionState = {
  id: string;
  message: string;
  tone: "ok" | "error" | "pending";
};

type ReviewAction = "accept" | "reject";

type CurationReviewResponse = {
  data?: {
    ok?: boolean | null;
    status?: string | null;
    proposalId?: string | null;
    decisionId?: string | null;
  } | null;
  errors?: Array<{ message?: string | null } | string | null> | null;
};

const TAILORED_TOPIC_PROPOSAL_KINDS = new Set([
  "new-topic",
  "rename-topic",
  "merge-topic",
  "deprecate-topic",
  "seed-change",
  "holdout-change",
  "topic-display-copy-edit",
  "topic-copy-edit",
  "display-copy-edit",
]);

const NEWS_DESK_TABS = [
  { id: "topics", label: "Topics", detail: "Open desk", href: "/news-desk", active: true },
  { id: "assignments", label: "Assignments", detail: "Coming desk", active: false },
  { id: "research", label: "Research Queue", detail: "Coming desk", active: false },
  { id: "reporting", label: "Reporter Queue", detail: "Coming desk", active: false },
];

const TAXONOMY_PROPOSAL_KINDS = new Set([
  "create-taxonomy-node",
  "move-taxonomy-node",
  "archive-taxonomy-node",
  "merge-taxonomy-nodes",
  "split-taxonomy-node",
]);

const USER_POOL_AUTH_MODE = "userPool";

export function NewsDeskWorkspace({ dashboard }: { dashboard: TopicSteeringDashboard | null }) {
  if (!dashboard) return <ProtectedNewsDeskWorkspace />;
  return <NewsDeskDashboard dashboard={dashboard} />;
}

function ProtectedNewsDeskWorkspace() {
  const [state, setState] = useState<EditorNewsDeskState>({ status: "loading", dashboard: null, error: null });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const nextState = await loadEditorNewsDeskState();
      if (active) setState(nextState);
    };
    void refresh();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signedIn" ||
        payload.event === "signedOut" ||
        payload.event === "signInWithRedirect" ||
        payload.event === "signInWithRedirect_failure"
      ) {
        setState({ status: "loading", dashboard: null, error: null });
        void refresh();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (state.status === "ready" && state.dashboard) return <NewsDeskDashboard dashboard={state.dashboard} />;

  return (
    <main className="topic-steering-shell news-desk-shell" data-news-desk-access={state.status}>
      <article className="news-desk-page news-desk-page--gate" aria-labelledby="news-desk-access-title">
        <header className="masthead news-desk-masthead">
          <div className="masthead__rule" />
          <h1 id="news-desk-access-title">
            <span>NEWS DESK</span>
          </h1>
          <div className="masthead__meta" aria-label="News desk edition status">
            <span>Steering Section</span>
            <span>Restricted Desk</span>
            <span><ReaderAuthControl className="news-desk-auth-control" showIdentity /></span>
          </div>
        </header>
        <section className="news-desk-access-panel" aria-live="polite">
          <p className="story-label">Access</p>
          <h2>{formatAccessTitle(state)}</h2>
          <p>{formatAccessDetail(state)}</p>
          {state.status === "error" ? <p className="news-desk-access-panel__error">{state.error}</p> : null}
          <ReaderAuthControl className="news-desk-access-panel__auth" showIdentity />
        </section>
      </article>
    </main>
  );
}

function NewsDeskDashboard({ dashboard }: { dashboard: TopicSteeringDashboard }) {
  const dataClient = useMemo(() => generateClient<Schema>(), []);
  const [topics, setTopics] = useState(dashboard.topics);
  const [taxonomies, setTaxonomies] = useState(dashboard.taxonomies);
  const [taxonomyNodes, setTaxonomyNodes] = useState(dashboard.taxonomyNodes);
  const [taxonomyLoadError, setTaxonomyLoadError] = useState<string | null>(null);
  const [proposals, setProposals] = useState(dashboard.proposals);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const topicProposals = proposals.filter(isTailoredTopicProposal);
  const genericProposals = proposals.filter((proposal) => !isTailoredTopicProposal(proposal));
  const activeTopicSet = useMemo(() => (
    dashboard.topicSets.find((topicSet) => topicSet.id === dashboard.canonicalTopicSetId)
    ?? dashboard.topicSets[0]
    ?? null
  ), [dashboard.canonicalTopicSetId, dashboard.topicSets]);
  const canonicalCorpus = useMemo(() => (
    dashboard.corpora.find((corpus) => corpus.id === dashboard.canonicalCorpusId)
    ?? (activeTopicSet ? dashboard.corpora.find((corpus) => corpus.id === activeTopicSet.corpusId) : undefined)
    ?? null
  ), [activeTopicSet, dashboard.canonicalCorpusId, dashboard.corpora]);
  const canonicalTopics = useMemo(() => (
    activeTopicSet ? topics.filter((topic) => topic.topicSetId === activeTopicSet.id && topic.status !== "deprecated") : []
  ), [activeTopicSet, topics]);
  const activeTaxonomy = useMemo(
    () => selectActiveTaxonomy(taxonomies, activeTopicSet?.id ?? null, canonicalCorpus?.id ?? null),
    [activeTopicSet?.id, canonicalCorpus?.id, taxonomies],
  );
  const activeTaxonomyNodes = useMemo(() => (
    activeTaxonomy ? taxonomyNodes.filter((node) => node.taxonomyId === activeTaxonomy.id && node.status !== "deprecated") : []
  ), [activeTaxonomy, taxonomyNodes]);
  const acceptedRootTopicCount = activeTaxonomyNodes.filter((node) => !node.parentTopicUid && node.status === "accepted").length;
  const acceptedSubtopicCount = activeTaxonomyNodes.filter((node) => node.parentTopicUid && node.status === "accepted").length;
  const latestImport = useMemo(() => (
    activeTopicSet
      ? dashboard.importRuns.find((importRun) => importRun.corpusId === activeTopicSet.corpusId) ?? dashboard.importRuns[0] ?? null
      : dashboard.importRuns[0] ?? null
  ), [activeTopicSet, dashboard.importRuns]);
  const openProposalCount = proposals.filter((proposal) => proposal.status === "proposed").length;
  const latestImportLabel = latestImport ? formatDateTime(latestImport.importedAt) : "Awaiting import";

  const topicByUid = useMemo(() => {
    const map = new Map<string, TopicSteeringTopic>();
    for (const topic of topics) map.set(topic.topicUid, topic);
    return map;
  }, [topics]);

  useEffect(() => {
    if (dashboard.isDemo) {
      setTaxonomies(dashboard.taxonomies);
      setTaxonomyNodes(dashboard.taxonomyNodes);
      setTaxonomyLoadError(null);
      return;
    }

    let active = true;
    const refreshTaxonomy = async () => {
      const state = await loadEditorTaxonomyState();
      if (!active) return;
      setTaxonomies(state.taxonomies);
      setTaxonomyNodes(state.taxonomyNodes);
      setTaxonomyLoadError(state.error);
    };

    void refreshTaxonomy();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signedIn" ||
        payload.event === "signedOut" ||
        payload.event === "signInWithRedirect" ||
        payload.event === "signInWithRedirect_failure"
      ) {
        void refreshTaxonomy();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [dashboard.isDemo, dashboard.taxonomies, dashboard.taxonomyNodes]);

  function runProposalAction(proposal: TopicSteeringProposal, action: ReviewAction) {
    setActionState({ id: proposal.id, message: `${action} pending`, tone: "pending" });
    if (dashboard.isDemo) {
      setProposals((current) =>
        current.map((entry) =>
          entry.id === proposal.id
            ? { ...entry, status: action === "accept" ? "accepted" : "rejected", reviewedAt: new Date().toISOString() }
            : entry,
        ),
      );
      setActionState({ id: proposal.id, message: `${action} saved`, tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const response = await dataClient.mutations.reviewCurationProposal(
            {
              proposalId: proposal.id,
              action,
              actorLabel: "Papyrus news desk",
              displayName: proposal.displayName ?? undefined,
              subtitle: proposal.subtitle ?? undefined,
              description: proposal.description ?? undefined,
              seedItemIds: compactArray(proposal.suggestedSeedItemIds),
              holdoutItemIds: compactArray(proposal.suggestedHoldoutItemIds),
            },
            { authMode: USER_POOL_AUTH_MODE },
          );
          const review = assertReviewMutationSucceeded(response, proposal.id);
          const nextStatus = review.status === "accepted" || review.status === "rejected"
            ? review.status
            : action === "accept" ? "accepted" : "rejected";
          setProposals((current) =>
            current.map((entry) =>
              entry.id === proposal.id
                ? { ...entry, status: nextStatus, reviewedAt: new Date().toISOString() }
                : entry,
            ),
          );
          if (action === "accept" && TAXONOMY_PROPOSAL_KINDS.has(proposal.proposalKind)) {
            await refreshEditorTaxonomyState();
          }
          setActionState({ id: proposal.id, message: `${action} saved`, tone: "ok" });
        } catch (error) {
          setActionState({ id: proposal.id, message: error instanceof Error ? error.message : `${action} failed`, tone: "error" });
        }
      })();
    });
  }

  async function refreshEditorTaxonomyState() {
    if (dashboard.isDemo) {
      setTaxonomies(dashboard.taxonomies);
      setTaxonomyNodes(dashboard.taxonomyNodes);
      setTaxonomyLoadError(null);
      return;
    }
    const state = await loadEditorTaxonomyState();
    setTaxonomies(state.taxonomies);
    setTaxonomyNodes(state.taxonomyNodes);
    setTaxonomyLoadError(state.error);
  }

  function saveTopic(topic: TopicSteeringTopic, update: Pick<TopicSteeringTopic, "displayName" | "subtitle" | "description">) {
    setActionState({ id: topic.id, message: "topic save pending", tone: "pending" });
    if (dashboard.isDemo) {
      const updatedAt = new Date().toISOString();
      setTopics((current) => current.map((entry) => (entry.id === topic.id ? { ...entry, ...update, updatedAt } : entry)));
      setActionState({ id: topic.id, message: "topic copy saved", tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const updatedAt = new Date().toISOString();
          await dataClient.models.CurationTopic.update({
            id: topic.id,
            displayName: update.displayName,
            subtitle: update.subtitle,
            description: update.description,
            updatedAt,
          });
          setTopics((current) => current.map((entry) => (entry.id === topic.id ? { ...entry, ...update, updatedAt } : entry)));
          setActionState({ id: topic.id, message: "topic copy saved", tone: "ok" });
        } catch (error) {
          setActionState({ id: topic.id, message: error instanceof Error ? error.message : "topic save failed", tone: "error" });
        }
      })();
    });
  }

  function promoteRevision(revisionId: string) {
    setActionState({ id: revisionId, message: "promotion pending", tone: "pending" });
    if (dashboard.isDemo) {
      setActionState({ id: revisionId, message: "revision promoted", tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          await dataClient.mutations.promoteCurationTopicRevision({
            revisionId,
            actorLabel: "Papyrus news desk",
          });
          setActionState({ id: revisionId, message: "revision promoted", tone: "ok" });
        } catch (error) {
          setActionState({ id: revisionId, message: error instanceof Error ? error.message : "promotion failed", tone: "error" });
        }
      })();
    });
  }

  return (
    <main className="topic-steering-shell news-desk-shell" data-news-desk data-topic-steering data-topic-steering-demo={dashboard.isDemo ? "true" : "false"}>
      <article className="news-desk-page" aria-labelledby="news-desk-title">
        <header className="masthead news-desk-masthead">
          <div className="masthead__rule" />
          <h1 id="news-desk-title">
            <span>NEWS DESK</span>
          </h1>
          <div className="masthead__meta" aria-label="News desk edition status">
            <span>Steering Section</span>
            <span>{latestImportLabel}</span>
            <span>{dashboard.isDemo ? "Demo Desk" : <ReaderAuthControl className="news-desk-auth-control" showIdentity />}</span>
          </div>
        </header>

        <nav className="news-desk-tabs" aria-label="News desk sections">
          {NEWS_DESK_TABS.map((tab) => tab.active ? (
            <a
              key={tab.id}
              aria-current="page"
              className="news-desk-tab news-desk-tab--active"
              data-news-desk-tab={tab.id}
              href={tab.href}
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </a>
          ) : (
            <span
              key={tab.id}
              aria-disabled="true"
              className="news-desk-tab news-desk-tab--disabled"
              data-news-desk-tab={tab.id}
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </span>
          ))}
        </nav>

        <section className="news-desk-lede-grid" aria-label="News desk overview">
          <article className="news-desk-lede">
            <p className="story-label">Topics Desk</p>
            <h2>Steering Notes Run Beside The Edition</h2>
            <p>
              Proposal rows are copy-desk notes from workers and agents. Skim them like an inside page: accept a correction, reject it, or leave the present course undisturbed.
            </p>
          </article>
          <aside className="news-desk-index" aria-label="News desk status index">
            <StatusMetric label="Accepted Topics" value={String(canonicalTopics.length)} detail={activeTopicSet ? activeTopicSet.displayName : "No accepted topic set"} />
            <StatusMetric label="Accepted Subtopics" value={String(acceptedSubtopicCount)} detail={`${acceptedRootTopicCount} root topics`} />
            <StatusMetric label="Filed Notes" value={String(openProposalCount)} detail={`${topicProposals.length} topic / ${genericProposals.length} generic`} />
            <StatusMetric label="Projection Notices" value={String(dashboard.projections.length)} detail={latestImport ? `${latestImport.importKind} ${latestImport.status}` : "No projection import"} />
          </aside>
        </section>

        {dashboard.loadError ? (
          <div className="topic-steering-alert" role="status">
            {dashboard.loadError}
          </div>
        ) : null}
        {actionState ? (
          <div className={`topic-steering-action topic-steering-action--${actionState.tone}`} role="status" aria-live="polite">
            {actionState.message}
          </div>
        ) : null}

        <div className="news-desk-columns">
          <div className="news-desk-main-column">
            <AcceptedTaxonomySection
              activeTaxonomy={activeTaxonomy}
              canonicalTopics={canonicalTopics}
              disabled={isPending}
              onAction={runProposalAction}
              proposals={proposals}
              taxonomyLoadError={taxonomyLoadError}
              taxonomyNodes={activeTaxonomyNodes}
            />

            <section className="topic-steering-section topic-steering-section--lead" aria-labelledby="topic-proposals-title">
              <SectionHeader title="Topic Proposals" detail={`${topicProposals.length} tailored notes`} />
              <div className="topic-steering-proposal-list">
                {topicProposals.length ? topicProposals.map((proposal) => (
                  <TopicProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    topic={proposal.topicUid ? topicByUid.get(proposal.topicUid) : undefined}
                    disabled={isPending}
                    onAction={runProposalAction}
                  />
                )) : <EmptyRow label="No topic proposals" />}
              </div>
            </section>

            <GenericProposalQueue proposals={genericProposals} disabled={isPending} onAction={runProposalAction} />

            <section className="topic-steering-section" aria-labelledby="accepted-topic-register-title">
              <SectionHeader title="Accepted Topic Register" detail={activeTopicSet ? activeTopicSet.classifierId : "No classifier imported"} />
              <div className="topic-steering-topic-grid">
                {canonicalTopics.length ? canonicalTopics.map((topic) => (
                  <TopicEditor key={topic.id} topic={topic} disabled={isPending} onSave={saveTopic} />
                )) : <EmptyRow label="No canonical topics imported" />}
              </div>
            </section>
          </div>

          <aside className="news-desk-rail-column">
            <CorpusTopicSetSummary
              corpora={dashboard.corpora}
              topicSets={dashboard.topicSets}
              importRuns={dashboard.importRuns}
              canonicalTopicSetId={activeTopicSet?.id ?? null}
            />

            <RevisionPanel
              topicSet={activeTopicSet}
              artifacts={dashboard.artifacts}
              projections={dashboard.projections}
              disabled={isPending}
              onPromote={promoteRevision}
            />
          </aside>
        </div>
      </article>
    </main>
  );
}

function StatusMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="topic-steering-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function formatAccessTitle(state: EditorNewsDeskState): string {
  if (state.status === "loading") return "Checking Desk Credentials";
  if (state.status === "forbidden") return "Editor Role Required";
  if (state.status === "error") return "News Desk Unavailable";
  return "Editor Sign-In Required";
}

function formatAccessDetail(state: EditorNewsDeskState): string {
  if (state.status === "loading") return "Papyrus is checking the current browser session before loading steering state.";
  if (state.status === "forbidden") return "This account is signed in, but the Cognito session does not include the editor or admin group.";
  if (state.status === "error") return "Papyrus could not verify this editor session or load the private News Desk data.";
  return "Sign in with an editor or admin account to inspect topic, taxonomy, ontology, and graph steering.";
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <header className="topic-steering-section__header">
      <h2 id={`${id}-title`}>{title}</h2>
      <span>{detail}</span>
    </header>
  );
}

function GenericProposalQueue({
  proposals,
  disabled,
  onAction,
}: {
  proposals: TopicSteeringProposal[];
  disabled: boolean;
  onAction: (proposal: TopicSteeringProposal, action: ReviewAction) => void;
}) {
  return (
    <section className="topic-steering-section" aria-labelledby="ontology-and-graph-proposals-title">
      <SectionHeader title="Ontology And Graph Wire" detail={`${proposals.length} generic notes`} />
      <div className="topic-steering-table-wrap">
        <table className="topic-steering-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Kind</th>
              <th>Subject</th>
              <th>Relationship</th>
              <th>Status</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {proposals.length ? proposals.map((proposal) => (
              <tr key={proposal.id} data-generic-proposal-kind={proposal.proposalKind}>
                <td>{proposal.steeringDomain}</td>
                <td>{proposal.proposalKind}</td>
                <td>{formatGenericProposalSubject(proposal)}</td>
                <td>{proposal.relationshipType ?? "none"}</td>
                <td><StatusPill status={proposal.status} /></td>
                <td>
                  <div className="topic-steering-proposal__actions" aria-label={`${proposal.title} review actions`}>
                    <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
                    <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6}>No taxonomy, ontology, or graph proposals</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AcceptedTaxonomySection({
  activeTaxonomy,
  canonicalTopics,
  disabled,
  onAction,
  proposals,
  taxonomyLoadError,
  taxonomyNodes,
}: {
  activeTaxonomy: TopicSteeringTaxonomy | null;
  canonicalTopics: TopicSteeringTopic[];
  disabled: boolean;
  onAction: (proposal: TopicSteeringProposal, action: ReviewAction) => void;
  proposals: TopicSteeringProposal[];
  taxonomyLoadError: string | null;
  taxonomyNodes: TopicSteeringTaxonomyNode[];
}) {
  const roots = canonicalTopics.map((topic) => {
    const node = taxonomyNodes.find((candidate) => candidate.topicUid === topic.topicUid && !candidate.parentTopicUid);
    const subtopics = taxonomyNodes.filter((candidate) => candidate.parentTopicUid === topic.topicUid && candidate.status === "accepted");
    return {
      topic,
      node,
      subtopics,
      proposedSubtopics: getProposedSubtopicProposals(topic.topicUid, proposals),
    };
  });
  const subtopicCount = roots.reduce((count, root) => count + root.subtopics.length, 0);
  const proposedSubtopicCount = roots.reduce((count, root) => count + root.proposedSubtopics.length, 0);
  const detail = activeTaxonomy
    ? `${subtopicCount} accepted / ${proposedSubtopicCount} proposed subtopics`
    : taxonomyLoadError
      ? "Taxonomy unavailable"
      : "Editor sign-in required";

  return (
    <section className="topic-steering-section topic-steering-section--taxonomy" aria-labelledby="accepted-taxonomy-title">
      <SectionHeader title="Accepted Subtopic Register" detail={detail} />
      {taxonomyLoadError ? (
        <div className="topic-steering-alert" role="status">
          {taxonomyLoadError}
        </div>
      ) : null}
      {!activeTaxonomy ? (
        <EmptyRow label="Accepted subtopics are visible to signed-in editors" />
      ) : (
        <div className="topic-steering-taxonomy-list" data-news-desk-taxonomy>
          {roots.length ? roots.map(({ node, proposedSubtopics, subtopics, topic }) => {
            const root = node ?? topicToTaxonomyNode(topic);
            const relatedProposalCount = countRelatedTaxonomyProposals(root.topicUid, subtopics, proposals);
            return (
              <article className="topic-steering-taxonomy-root" data-news-desk-taxonomy-root={root.topicUid} key={root.topicUid}>
                <header>
                  <div>
                    <p className="story-label">Root Topic</p>
                    <h3>{root.displayName}</h3>
                  </div>
                  <span>{subtopics.length} accepted / {proposedSubtopics.length} proposed / {relatedProposalCount} related notes</span>
                </header>
                {root.subtitle ? <p className="topic-steering-taxonomy-subtitle">{root.subtitle}</p> : null}
                <p>{root.description ?? "Accepted root topic."}</p>
                <div className="topic-steering-taxonomy-evidence">
                  <span>{compactArray(root.seedItemIds).length} seed refs</span>
                  <span>{compactArray(root.holdoutItemIds).length} holdout refs</span>
                  <span>{root.topicUid}</span>
                </div>
                <div className="topic-steering-subtopic-list">
                  <p className="topic-steering-subtopic-list__label">Accepted Subtopics</p>
                  {subtopics.length ? subtopics.map((subtopic) => (
                    <article className="topic-steering-subtopic" data-news-desk-subtopic={subtopic.topicUid} key={subtopic.id}>
                      <h4>{subtopic.displayName}</h4>
                      {subtopic.subtitle ? <p className="topic-steering-taxonomy-subtitle">{subtopic.subtitle}</p> : null}
                      <p>{subtopic.description ?? "Accepted subtopic."}</p>
                      <div className="topic-steering-taxonomy-evidence">
                        <span>{compactArray(subtopic.seedItemIds).length} seed refs</span>
                        <span>{compactArray(subtopic.holdoutItemIds).length} holdout refs</span>
                        <span>{countRelatedTaxonomyProposals(subtopic.topicUid, [], proposals)} related notes</span>
                      </div>
                    </article>
                  )) : (
                    <EmptyRow label="No accepted subtopics under this root" />
                  )}
                </div>
                {proposedSubtopics.length ? (
                  <div className="topic-steering-subtopic-list topic-steering-subtopic-list--proposed">
                    <p className="topic-steering-subtopic-list__label">Proposed Subtopics</p>
                    {proposedSubtopics.map((proposal) => (
                      <article className="topic-steering-subtopic topic-steering-subtopic--proposed" data-news-desk-proposed-subtopic={proposal.topicUid ?? proposal.id} key={proposal.id}>
                        <h4>{proposal.displayName ?? proposal.title}</h4>
                        {proposal.subtitle ? <p className="topic-steering-taxonomy-subtitle">{proposal.subtitle}</p> : null}
                        <p>{proposal.description ?? proposal.summary ?? "Candidate subtopic from steering proposals."}</p>
                        <div className="topic-steering-taxonomy-evidence">
                          <span>{proposal.proposalKind}</span>
                          <span>{proposal.status}</span>
                          <span>{compactArray(proposal.evidenceItemIds).length} evidence refs</span>
                          <span>{proposal.topicUid ?? "new topic"}</span>
                        </div>
                        <div className="topic-steering-proposal__actions topic-steering-subtopic__actions" aria-label={`${proposal.title} review actions`}>
                          <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
                          <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          }) : <EmptyRow label="No canonical roots available for taxonomy display" />}
        </div>
      )}
    </section>
  );
}

function formatGenericProposalSubject(proposal: TopicSteeringProposal): string {
  const parts = [
    proposal.topicUid,
    proposal.graphEntityId,
    proposal.targetTopicUid ? `-> ${proposal.targetTopicUid}` : null,
    proposal.displayName,
  ].filter(Boolean);
  return parts.join(" ") || "unmapped";
}

function assertReviewMutationSucceeded(response: CurationReviewResponse, proposalId: string): NonNullable<CurationReviewResponse["data"]> {
  if (response.errors?.length) {
    throw new Error(response.errors.map(formatGraphQLError).join("; "));
  }
  if (!response.data?.ok) {
    throw new Error(`Review was not saved for ${proposalId}.`);
  }
  if (response.data.proposalId && response.data.proposalId !== proposalId) {
    throw new Error(`Review response did not match proposal ${proposalId}.`);
  }
  if (!response.data.decisionId) {
    throw new Error(`Review saved no decision audit row for ${proposalId}.`);
  }
  return response.data;
}

function formatGraphQLError(error: { message?: string | null } | string | null): string {
  if (typeof error === "string") return error;
  return error?.message ?? "GraphQL mutation failed.";
}

function selectActiveTaxonomy(
  taxonomies: TopicSteeringTaxonomy[],
  topicSetId: string | null,
  corpusId: string | null,
): TopicSteeringTaxonomy | null {
  const candidates = taxonomies.filter((taxonomy) => taxonomy.status !== "deprecated");
  const matchingTopicSet = topicSetId ? candidates.filter((taxonomy) => taxonomy.topicSetId === topicSetId) : candidates;
  const matchingCorpus = corpusId ? candidates.filter((taxonomy) => taxonomy.corpusId === corpusId) : candidates;
  return matchingTopicSet[0] ?? matchingCorpus[0] ?? candidates[0] ?? null;
}

function topicToTaxonomyNode(topic: TopicSteeringTopic): TopicSteeringTaxonomyNode {
  return {
    id: topic.id,
    taxonomyId: topic.topicSetId,
    corpusId: topic.corpusId,
    topicSetId: topic.topicSetId,
    topicUid: topic.topicUid,
    parentTopicUid: null,
    displayName: topic.displayName,
    subtitle: topic.subtitle,
    description: topic.description,
    status: topic.status,
    seedItemIds: topic.seedItemIds,
    holdoutItemIds: topic.holdoutItemIds,
    rank: topic.rank,
    depth: 0,
    importRunId: null,
    updatedAt: topic.updatedAt,
  };
}

function countRelatedTaxonomyProposals(
  topicUid: string,
  subtopics: TopicSteeringTaxonomyNode[],
  proposals: TopicSteeringProposal[],
): number {
  const topicUids = new Set([topicUid, ...subtopics.map((subtopic) => subtopic.topicUid)]);
  return proposals.filter((proposal) => {
    if (!TAXONOMY_PROPOSAL_KINDS.has(proposal.proposalKind)) return false;
    return Boolean(
      (proposal.topicUid && topicUids.has(proposal.topicUid)) ||
      (proposal.targetTopicUid && topicUids.has(proposal.targetTopicUid)),
    );
  }).length;
}

function getProposedSubtopicProposals(rootTopicUid: string, proposals: TopicSteeringProposal[]): TopicSteeringProposal[] {
  return proposals
    .filter((proposal) => (
      proposal.proposalKind === "create-taxonomy-node"
      && proposal.status === "proposed"
      && proposal.targetTopicUid === rootTopicUid
    ))
    .sort((left, right) => {
      const leftName = left.displayName ?? left.title;
      const rightName = right.displayName ?? right.title;
      return leftName.localeCompare(rightName);
    });
}

function CorpusTopicSetSummary({
  corpora,
  topicSets,
  importRuns,
  canonicalTopicSetId,
}: {
  corpora: TopicSteeringCorpus[];
  topicSets: TopicSteeringTopicSet[];
  importRuns: TopicSteeringImportRun[];
  canonicalTopicSetId: string | null;
}) {
  return (
    <section className="topic-steering-section" aria-labelledby="corpus-topic-sets-title">
      <SectionHeader title="Corpus Topic Sets" detail={`${corpora.length} configured corpora / ${topicSets.length} registers`} />
      <div className="news-desk-ledger-list">
        {corpora.length ? corpora.map((corpus) => {
          const corpusTopicSets = topicSets.filter((topicSet) => topicSet.corpusId === corpus.id);
          const latestImport = importRuns.find((importRun) => importRun.corpusId === corpus.id);
          return (
            <article className="news-desk-ledger-item" key={corpus.id}>
              <header>
                <strong>{corpus.name}</strong>
                <span>{corpus.role}</span>
              </header>
              <dl>
                <div>
                  <dt>Topic Sets</dt>
                  <dd>{formatTopicSetNames(corpusTopicSets, canonicalTopicSetId)}</dd>
                </div>
                <div>
                  <dt>Classifiers</dt>
                  <dd>{corpusTopicSets.map((topicSet) => topicSet.classifierId).join(" / ") || "none"}</dd>
                </div>
                <div>
                  <dt>Topics</dt>
                  <dd>{String(corpusTopicSets.reduce((count, topicSet) => count + (topicSet.topicCount ?? 0), 0))}</dd>
                </div>
                <div>
                  <dt>Latest Import</dt>
                  <dd>{latestImport ? formatDateTime(latestImport.importedAt) : "none"}</dd>
                </div>
              </dl>
            </article>
          );
        }) : <EmptyRow label="No steering corpora imported" />}
      </div>
    </section>
  );
}

function formatTopicSetNames(topicSets: TopicSteeringTopicSet[], canonicalTopicSetId: string | null): string {
  if (!topicSets.length) return "No topic sets";
  return topicSets
    .map((topicSet) => `${topicSet.displayName}${topicSet.id === canonicalTopicSetId ? " (canonical)" : ""}`)
    .join(" / ");
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function TopicProposalRow({
  proposal,
  topic,
  disabled,
  onAction,
}: {
  proposal: TopicSteeringProposal;
  topic?: TopicSteeringTopic;
  disabled: boolean;
  onAction: (proposal: TopicSteeringProposal, action: ReviewAction) => void;
}) {
  const evidence = compactArray(proposal.evidenceItemIds).slice(0, 3);

  return (
    <article className="topic-steering-proposal" data-proposal-domain={proposal.steeringDomain}>
      <div className="topic-steering-proposal__main">
        <div className="topic-steering-proposal__title">
          <StatusPill status={proposal.status} />
          <strong>{proposal.title}</strong>
          <span>{proposal.proposalKind}</span>
        </div>
        <p>{proposal.summary ?? "No summary provided."}</p>
        <dl>
          <div>
            <dt>Topic UID</dt>
            <dd>{proposal.topicUid ?? topic?.topicUid ?? "new topic"}</dd>
          </div>
          <div>
            <dt>Display</dt>
            <dd>{proposal.displayName ?? topic?.displayName ?? "pending"}</dd>
          </div>
          <div>
            <dt>Subtitle</dt>
            <dd>{proposal.subtitle ?? topic?.subtitle ?? "none"}</dd>
          </div>
        </dl>
        <div className="topic-steering-evidence-chips">
          {evidence.length ? evidence.map((itemId) => (
            <span key={itemId}>{itemId}</span>
          )) : <span>No evidence rows</span>}
        </div>
      </div>
      <div className="topic-steering-proposal__actions" aria-label={`${proposal.title} review actions`}>
        <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
        <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
      </div>
    </article>
  );
}

function TopicEditor({
  topic,
  disabled,
  onSave,
}: {
  topic: TopicSteeringTopic;
  disabled: boolean;
  onSave: (topic: TopicSteeringTopic, update: Pick<TopicSteeringTopic, "displayName" | "subtitle" | "description">) => void;
}) {
  const [displayName, setDisplayName] = useState(topic.displayName);
  const [subtitle, setSubtitle] = useState(topic.subtitle ?? "");
  const [description, setDescription] = useState(topic.description ?? "");

  return (
    <article className="topic-steering-topic-card" data-topic-uid={topic.topicUid} data-saved-display-name={topic.displayName}>
      <header>
        <span>{topic.topicUid}</span>
        <StatusPill status={topic.status} />
      </header>
      <label>
        <span>Name</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label>
        <span>Subtitle</span>
        <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
      </label>
      <label>
        <span>Description</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>
      <footer>
        <span>{compactArray(topic.seedItemIds).length} seeds / {compactArray(topic.holdoutItemIds).length} holdouts</span>
        <button type="button" data-news-desk-command="save-copy" disabled={disabled || !displayName.trim()} onClick={() => onSave(topic, { displayName, subtitle, description })}>Save Copy</button>
      </footer>
    </article>
  );
}

function RevisionPanel({
  topicSet,
  artifacts,
  projections,
  disabled,
  onPromote,
}: {
  topicSet: TopicSteeringTopicSet | null;
  artifacts: TopicSteeringArtifact[];
  projections: TopicSteeringProjection[];
  disabled: boolean;
  onPromote: (revisionId: string) => void;
}) {
  return (
    <section className="topic-steering-section" aria-labelledby="pressroom-export-title">
      <SectionHeader title="Pressroom Export" detail={topicSet?.status ?? "No topic set"} />
      <div className="topic-steering-revision-panel">
        <dl>
          <div>
            <dt>Accepted Revision</dt>
            <dd>{topicSet?.acceptedRevisionId ?? "none"}</dd>
          </div>
          <div>
            <dt>Draft Revision</dt>
            <dd>{topicSet?.latestDraftRevisionId ?? "none"}</dd>
          </div>
          <div>
            <dt>Artifacts</dt>
            <dd>{artifacts.length}</dd>
          </div>
          <div>
            <dt>Review Projections</dt>
            <dd>{projections.filter((projection) => projection.reviewRecommended).length}</dd>
          </div>
        </dl>
        <button
          type="button"
          data-news-desk-command="promote-draft"
          disabled={disabled || !topicSet?.latestDraftRevisionId}
          onClick={() => topicSet?.latestDraftRevisionId ? onPromote(topicSet.latestDraftRevisionId) : undefined}
        >
          Promote Draft
        </button>
        <div className="topic-steering-artifacts">
          {artifacts.slice(0, 4).map((artifact) => (
            <span key={artifact.id}>{artifact.displayName ?? artifact.artifactId}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`topic-steering-pill topic-steering-pill--${status}`}>{status}</span>;
}

function EmptyRow({ label }: { label: string }) {
  return <div className="topic-steering-empty">{label}</div>;
}

function compactArray(value: Array<string | null> | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function isTailoredTopicProposal(proposal: TopicSteeringProposal): boolean {
  return proposal.steeringDomain === "topic" && TAILORED_TOPIC_PROPOSAL_KINDS.has(proposal.proposalKind);
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import type {
  TopicSteeringArtifact,
  TopicSteeringCorpus,
  TopicSteeringDashboard,
  TopicSteeringImportRun,
  TopicSteeringProjection,
  TopicSteeringProposal,
  TopicSteeringTopic,
  TopicSteeringTopicSet,
} from "../lib/curation-repository";

type ActionState = {
  id: string;
  message: string;
  tone: "ok" | "error" | "pending";
};

export function TopicSteeringWorkspace({ dashboard }: { dashboard: TopicSteeringDashboard }) {
  const dataClient = useMemo(() => generateClient<Schema>(), []);
  const [topics, setTopics] = useState(dashboard.topics);
  const [proposals, setProposals] = useState(dashboard.proposals);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const topicProposals = proposals.filter((proposal) => proposal.steeringDomain === "topic");
  const graphProposals = proposals.filter((proposal) => proposal.steeringDomain === "graph");
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
  const latestImport = useMemo(() => (
    activeTopicSet
      ? dashboard.importRuns.find((importRun) => importRun.corpusId === activeTopicSet.corpusId) ?? dashboard.importRuns[0] ?? null
      : dashboard.importRuns[0] ?? null
  ), [activeTopicSet, dashboard.importRuns]);

  const topicByUid = useMemo(() => {
    const map = new Map<string, TopicSteeringTopic>();
    for (const topic of topics) map.set(topic.topicUid, topic);
    return map;
  }, [topics]);

  function runProposalAction(proposal: TopicSteeringProposal, action: "accept" | "reject" | "defer") {
    setActionState({ id: proposal.id, message: `${action} pending`, tone: "pending" });
    if (dashboard.isDemo) {
      setProposals((current) =>
        current.map((entry) =>
          entry.id === proposal.id
            ? { ...entry, status: action === "accept" ? "accepted" : action === "reject" ? "rejected" : "deferred", reviewedAt: new Date().toISOString() }
            : entry,
        ),
      );
      setActionState({ id: proposal.id, message: `${action} saved`, tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          await dataClient.mutations.reviewCurationProposal({
            proposalId: proposal.id,
            action,
            actorLabel: "Papyrus topic steering",
            displayName: proposal.displayName ?? undefined,
            subtitle: proposal.subtitle ?? undefined,
            description: proposal.description ?? undefined,
            seedItemIds: compactArray(proposal.suggestedSeedItemIds),
            holdoutItemIds: compactArray(proposal.suggestedHoldoutItemIds),
          });
          setProposals((current) =>
            current.map((entry) =>
              entry.id === proposal.id
                ? { ...entry, status: action === "accept" ? "accepted" : action === "reject" ? "rejected" : "deferred", reviewedAt: new Date().toISOString() }
                : entry,
            ),
          );
          setActionState({ id: proposal.id, message: `${action} saved`, tone: "ok" });
        } catch (error) {
          setActionState({ id: proposal.id, message: error instanceof Error ? error.message : `${action} failed`, tone: "error" });
        }
      })();
    });
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
            actorLabel: "Papyrus topic steering",
          });
          setActionState({ id: revisionId, message: "revision promoted", tone: "ok" });
        } catch (error) {
          setActionState({ id: revisionId, message: error instanceof Error ? error.message : "promotion failed", tone: "error" });
        }
      })();
    });
  }

  return (
    <main className="topic-steering-shell" data-topic-steering data-topic-steering-demo={dashboard.isDemo ? "true" : "false"}>
      <header className="topic-steering-header">
        <div>
          <p className="topic-steering-kicker">Papyrus</p>
          <h1>Topic Steering</h1>
        </div>
        <div className="topic-steering-header__meta" aria-label="Steering corpus scope">
          {dashboard.corpora.length ? dashboard.corpora.map((corpus) => (
            <span key={corpus.id}>{corpus.name}</span>
          )) : <span>No configured corpora</span>}
        </div>
      </header>

      <section className="topic-steering-status-grid" aria-label="Import and projection status">
        <StatusMetric label="Corpora" value={String(dashboard.corpora.length)} detail={dashboard.corpora.map((corpus) => corpus.name).join(" / ")} />
        <StatusMetric label="Canonical Topics" value={String(canonicalTopics.length)} detail={activeTopicSet ? `${activeTopicSet.displayName}${canonicalCorpus ? ` / ${canonicalCorpus.name}` : ""}` : "No accepted topic set"} />
        <StatusMetric label="Steering Proposals" value={String(proposals.filter((proposal) => proposal.status === "proposed").length)} detail={`${topicProposals.length} topic / ${graphProposals.length} graph`} />
        <StatusMetric label="Projection Rows" value={String(dashboard.projections.length)} detail={latestImport ? `${latestImport.importKind} ${latestImport.status}` : "No projection import"} />
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

      <section className="topic-steering-section" aria-labelledby="steering-proposals-title">
        <SectionHeader title="Steering Proposals" detail={`${topicProposals.length} tailored topic rows`} />
        <div className="topic-steering-proposal-list">
          {topicProposals.length ? topicProposals.map((proposal) => (
            <TopicProposalRow
              key={proposal.id}
              proposal={proposal}
              topic={proposal.topicUid ? topicByUid.get(proposal.topicUid) : undefined}
              disabled={isPending}
              onAction={runProposalAction}
            />
          )) : <EmptyRow label="No topic steering proposals" />}
        </div>
      </section>

      <section className="topic-steering-section" aria-labelledby="graph-steering-queue-title">
        <SectionHeader title="Graph Steering Queue" detail={`${graphProposals.length} generic rows`} />
        <div className="topic-steering-table-wrap">
          <table className="topic-steering-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Topic</th>
                <th>Entity</th>
                <th>Relationship</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {graphProposals.length ? graphProposals.map((proposal) => (
                <tr key={proposal.id}>
                  <td>{proposal.proposalKind}</td>
                  <td>{proposal.topicUid ?? "unmapped"}</td>
                  <td>{proposal.graphEntityId ?? "new entity"}</td>
                  <td>{proposal.relationshipType ?? "none"}</td>
                  <td><StatusPill status={proposal.status} /></td>
                </tr>
              )) : (
                <tr><td colSpan={5}>No graph steering proposals</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CorpusTopicSetSummary
        corpora={dashboard.corpora}
        topicSets={dashboard.topicSets}
        importRuns={dashboard.importRuns}
        canonicalTopicSetId={activeTopicSet?.id ?? null}
      />

      <section className="topic-steering-section" aria-labelledby="canonical-topic-catalog-title">
        <SectionHeader title="Canonical Topic Catalog" detail={activeTopicSet ? `${activeTopicSet.classifierId}${canonicalCorpus ? ` / ${canonicalCorpus.name}` : ""}` : "No classifier imported"} />
        <div className="topic-steering-topic-grid">
          {canonicalTopics.length ? canonicalTopics.map((topic) => (
            <TopicEditor key={topic.id} topic={topic} disabled={isPending} onSave={saveTopic} />
          )) : <EmptyRow label="No canonical topics imported" />}
        </div>
      </section>

      <section className="topic-steering-lower-grid">
        <EvidenceReferenceBrowser topics={canonicalTopics} proposals={proposals} projections={dashboard.projections} />
        <RevisionPanel
          topicSet={activeTopicSet}
          artifacts={dashboard.artifacts}
          projections={dashboard.projections}
          disabled={isPending}
          onPromote={promoteRevision}
        />
      </section>
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

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <header className="topic-steering-section__header">
      <h2 id={`${id}-title`}>{title}</h2>
      <span>{detail}</span>
    </header>
  );
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
      <SectionHeader title="Corpus Topic Sets" detail={`${topicSets.length} configured topic sets`} />
      <div className="topic-steering-table-wrap">
        <table className="topic-steering-table">
          <thead>
            <tr>
              <th>Corpus</th>
              <th>Role</th>
              <th>Topic Sets</th>
              <th>Classifiers</th>
              <th>Topics</th>
              <th>Latest Import</th>
            </tr>
          </thead>
          <tbody>
            {corpora.length ? corpora.map((corpus) => {
              const corpusTopicSets = topicSets.filter((topicSet) => topicSet.corpusId === corpus.id);
              const latestImport = importRuns.find((importRun) => importRun.corpusId === corpus.id);
              return (
                <tr key={corpus.id}>
                  <td>{corpus.name}</td>
                  <td>{corpus.role}</td>
                  <td>{formatTopicSetNames(corpusTopicSets, canonicalTopicSetId)}</td>
                  <td>{corpusTopicSets.map((topicSet) => topicSet.classifierId).join(" / ") || "none"}</td>
                  <td>{String(corpusTopicSets.reduce((count, topicSet) => count + (topicSet.topicCount ?? 0), 0))}</td>
                  <td>{latestImport ? formatDateTime(latestImport.importedAt) : "none"}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={6}>No steering corpora imported</td></tr>
            )}
          </tbody>
        </table>
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
  onAction: (proposal: TopicSteeringProposal, action: "accept" | "reject" | "defer") => void;
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
        <button type="button" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
        <button type="button" disabled={disabled || proposal.status === "deferred"} onClick={() => onAction(proposal, "defer")}>Defer</button>
        <button type="button" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
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
        <button type="button" disabled={disabled || !displayName.trim()} onClick={() => onSave(topic, { displayName, subtitle, description })}>Save Copy</button>
      </footer>
    </article>
  );
}

function EvidenceReferenceBrowser({
  topics,
  proposals,
  projections,
}: {
  topics: TopicSteeringTopic[];
  proposals: TopicSteeringProposal[];
  projections: TopicSteeringProjection[];
}) {
  const references = collectEvidenceReferences(topics, proposals, projections).slice(0, 24);
  return (
    <section className="topic-steering-section" aria-labelledby="evidence-references-title">
      <SectionHeader title="Evidence References" detail={`${references.length} external item ids`} />
      <div className="topic-steering-evidence-list">
        {references.map((reference) => (
          <article key={`${reference.itemId}-${reference.source}-${reference.topicUid ?? ""}`}>
            <strong>{reference.itemId}</strong>
            <span>{reference.topicUid ?? "corpus evidence"}</span>
            <small>{reference.source}</small>
          </article>
        ))}
        {!references.length ? <EmptyRow label="No evidence references imported" /> : null}
      </div>
    </section>
  );
}

function collectEvidenceReferences(
  topics: TopicSteeringTopic[],
  proposals: TopicSteeringProposal[],
  projections: TopicSteeringProjection[],
) {
  const references = new Map<string, { itemId: string; source: string; topicUid?: string | null }>();
  const add = (itemId: string, source: string, topicUid?: string | null) => {
    const key = `${itemId}:${source}:${topicUid ?? ""}`;
    if (!references.has(key)) references.set(key, { itemId, source, topicUid });
  };

  for (const topic of topics) {
    for (const itemId of compactArray(topic.seedItemIds)) add(itemId, "topic seed", topic.topicUid);
    for (const itemId of compactArray(topic.holdoutItemIds)) add(itemId, "topic holdout", topic.topicUid);
  }
  for (const proposal of proposals) {
    for (const itemId of compactArray(proposal.evidenceItemIds)) add(itemId, "proposal evidence", proposal.topicUid);
    for (const itemId of compactArray(proposal.suggestedSeedItemIds)) add(itemId, "suggested seed", proposal.topicUid);
    for (const itemId of compactArray(proposal.suggestedHoldoutItemIds)) add(itemId, "suggested holdout", proposal.topicUid);
  }
  for (const projection of projections) {
    add(projection.externalItemId, projection.reviewRecommended ? "projection review" : "projection", projection.topicUid);
  }

  return [...references.values()].sort((left, right) => {
    const topicDiff = String(left.topicUid ?? "").localeCompare(String(right.topicUid ?? ""));
    if (topicDiff !== 0) return topicDiff;
    return left.itemId.localeCompare(right.itemId);
  });
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
    <section className="topic-steering-section" aria-labelledby="revision-and-export-title">
      <SectionHeader title="Revision And Export" detail={topicSet?.status ?? "No topic set"} />
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

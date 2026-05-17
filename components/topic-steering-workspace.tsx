"use client";

import { Hub } from "aws-amplify/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import { useEffect, useMemo, useState, useTransition } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import { loadEditorNewsDeskState, loadEditorCategoryTreeState, type EditorNewsDeskState } from "./news-desk-taxonomy-client";
import { ReaderAuthControl } from "./reader-auth-control";
import {
  applyAssignmentVersionPlan,
  buildAssignmentManualVersionPlan,
  getAssignmentAngle,
  getAssignmentBrief,
  getAssignmentEvidenceCount,
  getAssignmentTargetArticleSlots,
  getCullingReason,
  isCulledItem,
  type NewsDeskAssignmentCandidate,
  type NewsDeskAssignmentDesk,
  type NewsDeskAssignmentItem,
  type NewsDeskAssignmentVersionPlan,
} from "../lib/news-desk-assignments";
import type {
  CategorySteeringArtifact,
  CategorySteeringCorpus,
  CategorySteeringDashboard,
  CategorySteeringImportRun,
  CategorySteeringProjection,
  CategorySteeringProposal,
  CategorySteeringCategoryTree,
  CategorySteeringCategoryTreeNode,
  CategorySteeringCategory,
  CategorySteeringCategorySet,
} from "../lib/category-repository";

type ActionState = {
  id: string;
  message: string;
  tone: "ok" | "error" | "pending";
};

type ReviewAction = "accept" | "reject";
type AssignmentCullAction = "cull" | "restore";
export type NewsDeskTab = "categories" | "assignments";

type CategoryReviewResponse = {
  data?: {
    ok?: boolean | null;
    status?: string | null;
    proposalId?: string | null;
    decisionId?: string | null;
  } | null;
  errors?: Array<{ message?: string | null } | string | null> | null;
};

const TAILORED_TOPIC_PROPOSAL_KINDS = new Set([
  "new-category",
  "rename-category",
  "merge-category",
  "deprecate-category",
  "seed-change",
  "holdout-change",
  "category-display-copy-edit",
  "category-copy-edit",
  "display-copy-edit",
]);

const NEWS_DESK_TABS = [
  { id: "categories", label: "Categories", detail: "Open desk", href: "/news-desk", disabled: false },
  { id: "assignments", label: "Assignments", detail: "Cull desk", href: "/news-desk?tab=assignments", disabled: false },
  { id: "research", label: "Research Queue", detail: "Coming desk", href: "/news-desk?tab=research", disabled: true },
  { id: "reporting", label: "Reporter Queue", detail: "Coming desk", href: "/news-desk?tab=reporting", disabled: true },
];

const TAXONOMY_PROPOSAL_KINDS = new Set([
  "create-category",
  "move-category",
  "archive-category",
  "merge-categories",
  "split-category",
]);

const USER_POOL_AUTH_MODE = "userPool";

export function NewsDeskWorkspace({
  dashboard,
  initialTab = "categories",
}: {
  dashboard: CategorySteeringDashboard | null;
  initialTab?: NewsDeskTab;
}) {
  if (!dashboard) return <ProtectedNewsDeskWorkspace initialTab={initialTab} />;
  return <NewsDeskDashboard dashboard={dashboard} initialTab={initialTab} />;
}

function ProtectedNewsDeskWorkspace({ initialTab }: { initialTab: NewsDeskTab }) {
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

  if (state.status === "ready" && state.dashboard) return <NewsDeskDashboard dashboard={state.dashboard} initialTab={initialTab} />;

  return (
    <main className="category-steering-shell news-desk-shell" data-news-desk-access={state.status}>
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

function NewsDeskDashboard({
  dashboard,
  initialTab,
}: {
  dashboard: CategorySteeringDashboard;
  initialTab: NewsDeskTab;
}) {
  const dataClient = useMemo(() => generateClient<Schema>(), []);
  const activeTab = initialTab;
  const [categorys, setCategorys] = useState(dashboard.categorys);
  const [categoryTrees, setTaxonomies] = useState(dashboard.categoryTrees);
  const [categoryNodes, setCategoryTreeNodes] = useState(dashboard.categoryNodes);
  const [categoryTreeLoadError, setCategoryTreeLoadError] = useState<string | null>(null);
  const [proposals, setProposals] = useState(dashboard.proposals);
  const [assignmentDesk, setAssignmentDesk] = useState(dashboard.assignmentDesk);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoryProposals = proposals.filter(isTailoredCategoryProposal);
  const genericProposals = proposals.filter((proposal) => !isTailoredCategoryProposal(proposal));
  const activeCategorySet = useMemo(() => (
    dashboard.categorySets.find((categorySet) => categorySet.id === dashboard.canonicalCategorySetId)
    ?? dashboard.categorySets[0]
    ?? null
  ), [dashboard.canonicalCategorySetId, dashboard.categorySets]);
  const canonicalCorpus = useMemo(() => (
    dashboard.corpora.find((corpus) => corpus.id === dashboard.canonicalCorpusId)
    ?? (activeCategorySet ? dashboard.corpora.find((corpus) => corpus.id === activeCategorySet.corpusId) : undefined)
    ?? null
  ), [activeCategorySet, dashboard.canonicalCorpusId, dashboard.corpora]);
  const canonicalCategorys = useMemo(() => (
    activeCategorySet ? categorys.filter((category) => category.categorySetId === activeCategorySet.id && category.status !== "deprecated") : []
  ), [activeCategorySet, categorys]);
  const activeCategoryTree = useMemo(
    () => selectActiveCategoryTree(categoryTrees, activeCategorySet?.id ?? null, canonicalCorpus?.id ?? null),
    [activeCategorySet?.id, canonicalCorpus?.id, categoryTrees],
  );
  const activeCategoryTreeNodes = useMemo(() => (
    activeCategoryTree ? categoryNodes.filter((node) => node.categorySetId === activeCategoryTree.id && node.status !== "deprecated") : []
  ), [activeCategoryTree, categoryNodes]);
  const acceptedRootCategoryCount = activeCategoryTreeNodes.filter((node) => !node.parentCategoryKey && node.status === "accepted").length;
  const acceptedSubcategoryCount = activeCategoryTreeNodes.filter((node) => node.parentCategoryKey && node.status === "accepted").length;
  const latestImport = useMemo(() => (
    activeCategorySet
      ? dashboard.importRuns.find((importRun) => importRun.corpusId === activeCategorySet.corpusId) ?? dashboard.importRuns[0] ?? null
      : dashboard.importRuns[0] ?? null
  ), [activeCategorySet, dashboard.importRuns]);
  const openProposalCount = proposals.filter((proposal) => proposal.status === "proposed").length;
  const latestImportLabel = latestImport ? formatDateTime(latestImport.importedAt) : "Awaiting import";
  const assignmentMetrics = useMemo(() => getAssignmentDeskMetrics(assignmentDesk), [assignmentDesk]);
  const assignmentEditionLabel = assignmentDesk.edition
    ? `${assignmentDesk.edition.title} / ${assignmentDesk.edition.editionDate}`
    : "No assignment edition";
  const mastheadSecondLabel = activeTab === "assignments" ? assignmentEditionLabel : latestImportLabel;

  const categoryByUid = useMemo(() => {
    const map = new Map<string, CategorySteeringCategory>();
    for (const category of categorys) map.set(category.categoryKey, category);
    return map;
  }, [categorys]);

  useEffect(() => {
    setAssignmentDesk(dashboard.assignmentDesk);
  }, [dashboard.assignmentDesk]);

  useEffect(() => {
    if (dashboard.isDemo) {
      setTaxonomies(dashboard.categoryTrees);
      setCategoryTreeNodes(dashboard.categoryNodes);
      setCategoryTreeLoadError(null);
      return;
    }

    let active = true;
    const refreshCategoryTree = async () => {
      const state = await loadEditorCategoryTreeState();
      if (!active) return;
      setTaxonomies(state.categoryTrees);
      setCategoryTreeNodes(state.categoryNodes);
      setCategoryTreeLoadError(state.error);
    };

    void refreshCategoryTree();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signedIn" ||
        payload.event === "signedOut" ||
        payload.event === "signInWithRedirect" ||
        payload.event === "signInWithRedirect_failure"
      ) {
        void refreshCategoryTree();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [dashboard.isDemo, dashboard.categoryTrees, dashboard.categoryNodes]);

  function runProposalAction(proposal: CategorySteeringProposal, action: ReviewAction) {
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
          const response = await dataClient.mutations.reviewCategoryProposal(
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
            await refreshEditorCategoryTreeState();
          }
          setActionState({ id: proposal.id, message: `${action} saved`, tone: "ok" });
        } catch (error) {
          setActionState({ id: proposal.id, message: error instanceof Error ? error.message : `${action} failed`, tone: "error" });
        }
      })();
    });
  }

  function runAssignmentCullAction(candidate: NewsDeskAssignmentCandidate, action: AssignmentCullAction, reason = "") {
    const actionLabel = action === "cull" ? "cull" : "restore";
    setActionState({ id: candidate.assignment.id, message: `${actionLabel} pending`, tone: "pending" });
    const now = new Date().toISOString();
    if (dashboard.isDemo) {
      const plan = buildAssignmentManualVersionPlan(assignmentDesk, candidate, action, {
        actorLabel: "Papyrus news desk",
        now,
        reason,
      });
      setAssignmentDesk((current) => applyAssignmentVersionPlan(current, plan));
      setActionState({ id: candidate.assignment.id, message: `${actionLabel} saved`, tone: "ok" });
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const actorLabel = await getNewsDeskActorLabel();
          const plan = buildAssignmentManualVersionPlan(assignmentDesk, candidate, action, { actorLabel, now, reason });
          await executeAssignmentVersionPlan(plan);
          setAssignmentDesk((current) => applyAssignmentVersionPlan(current, plan));
          setActionState({ id: candidate.assignment.id, message: `${actionLabel} saved`, tone: "ok" });
        } catch (error) {
          setActionState({
            id: candidate.assignment.id,
            message: error instanceof Error ? error.message : `${actionLabel} failed`,
            tone: "error",
          });
          await refreshEditorAssignmentDesk();
        }
      })();
    });
  }

  async function refreshEditorAssignmentDesk() {
    if (dashboard.isDemo) {
      setAssignmentDesk(dashboard.assignmentDesk);
      return;
    }
    const state = await loadEditorNewsDeskState();
    if (state.status === "ready" && state.dashboard) {
      setAssignmentDesk(state.dashboard.assignmentDesk);
    }
  }

  async function refreshEditorCategoryTreeState() {
    if (dashboard.isDemo) {
      setTaxonomies(dashboard.categoryTrees);
      setCategoryTreeNodes(dashboard.categoryNodes);
      setCategoryTreeLoadError(null);
      return;
    }
    const state = await loadEditorCategoryTreeState();
    setTaxonomies(state.categoryTrees);
    setCategoryTreeNodes(state.categoryNodes);
    setCategoryTreeLoadError(state.error);
  }

  async function executeAssignmentVersionPlan(plan: NewsDeskAssignmentVersionPlan) {
    const models = dataClient.models as unknown as Record<string, {
      create?: (input: Record<string, unknown>, options: { authMode: typeof USER_POOL_AUTH_MODE }) => Promise<unknown>;
      update?: (input: Record<string, unknown>, options: { authMode: typeof USER_POOL_AUTH_MODE }) => Promise<unknown>;
    }>;
    const itemModel = models.Item;
    const editionModel = models.Edition;
    const editionItemModel = models.EditionItem;
    if (!itemModel?.create || !itemModel.update || !editionModel?.create || !editionModel.update || !editionItemModel?.create) {
      throw new Error("Versioned publishing models are not available in the deployed schema.");
    }

    await Promise.all(plan.itemChanges.map((change) => itemModel.create!(change.nextItem as Record<string, unknown>, { authMode: USER_POOL_AUTH_MODE })));
    if (plan.editionChange) {
      await editionModel.create!(plan.editionChange.nextEdition as Record<string, unknown>, { authMode: USER_POOL_AUTH_MODE });
      await Promise.all(plan.editionChange.nextEditionItems.map((editionItem) =>
        editionItemModel.create!(editionItem as Record<string, unknown>, { authMode: USER_POOL_AUTH_MODE }),
      ));
    }
    await Promise.all(plan.itemChanges.map((change) =>
      itemModel.update!(change.previousItemUpdate, { authMode: USER_POOL_AUTH_MODE }),
    ));
    if (plan.editionChange) {
      await editionModel.update!(plan.editionChange.previousEditionUpdate, { authMode: USER_POOL_AUTH_MODE });
    }
  }

  function saveCategory(category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "subtitle" | "description">) {
    setActionState({ id: category.id, message: "category save pending", tone: "pending" });
    const updatedAt = new Date().toISOString();
    if (dashboard.isDemo) {
      const nextCategory = buildCategoryCopyVersion(category, update, {
        actorLabel: "Papyrus news desk",
        now: updatedAt,
      });
      setCategorys((current) => current.map((entry) => (entry.id === category.id ? nextCategory : entry)));
      setCategoryTreeNodes((current) => current.map((entry) => (entry.id === category.id ? nextCategory : entry)));
      setActionState({ id: category.id, message: "category copy saved", tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const actorLabel = await getNewsDeskActorLabel();
          const nextCategory = buildCategoryCopyVersion(category, update, {
            actorLabel,
            now: updatedAt,
          });
          await dataClient.models.Category.create(nextCategory as never, { authMode: USER_POOL_AUTH_MODE });
          await dataClient.models.Category.update({
            id: category.id,
            versionState: "superseded",
            updatedAt,
          }, { authMode: USER_POOL_AUTH_MODE });
          setCategorys((current) => current.map((entry) => (entry.id === category.id ? nextCategory : entry)));
          setCategoryTreeNodes((current) => current.map((entry) => (entry.id === category.id ? nextCategory : entry)));
          setActionState({ id: category.id, message: "category copy saved", tone: "ok" });
        } catch (error) {
          setActionState({ id: category.id, message: error instanceof Error ? error.message : "category save failed", tone: "error" });
        }
      })();
    });
  }

  return (
    <main className="category-steering-shell news-desk-shell" data-news-desk data-category-steering data-category-steering-demo={dashboard.isDemo ? "true" : "false"}>
      <article className="news-desk-page" aria-labelledby="news-desk-title">
        <header className="masthead news-desk-masthead">
          <div className="masthead__rule" />
          <h1 id="news-desk-title">
            <span>NEWS DESK</span>
          </h1>
          <div className="masthead__meta" aria-label="News desk edition status">
            <span>Steering Section</span>
            <span>{mastheadSecondLabel}</span>
            <span>{dashboard.isDemo ? "Demo Desk" : <ReaderAuthControl className="news-desk-auth-control" showIdentity />}</span>
          </div>
        </header>

        <nav className="news-desk-tabs" aria-label="News desk sections">
          {NEWS_DESK_TABS.map((tab) => !tab.disabled ? (
            <a
              key={tab.id}
              aria-current={tab.id === activeTab ? "page" : undefined}
              className={`news-desk-tab${tab.id === activeTab ? " news-desk-tab--active" : ""}`}
              data-news-desk-tab={tab.id}
              href={getNewsDeskTabHref(tab.href, dashboard.isDemo)}
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
          {activeTab === "assignments" ? (
            <>
              <article className="news-desk-lede">
                <p className="story-label">Assignments Desk</p>
                <h2>Candidate Stories Are Culled Before The Edition Closes</h2>
                <p>
                  Assignment rows are the surplus reporting slate for the next issue. Cull weak candidates, restore a mistaken cut, or leave the desk to follow the active assignment pool.
                </p>
              </article>
              <aside className="news-desk-index" aria-label="Assignments desk status index">
                <StatusMetric label="Target Slots" value={String(assignmentMetrics.targetSlots)} detail={assignmentDesk.edition?.title ?? "No edition selected"} />
                <StatusMetric label="Active Assignments" value={String(assignmentMetrics.active)} detail={`${assignmentMetrics.total} total candidates`} />
                <StatusMetric label="Drafted" value={String(assignmentMetrics.drafted)} detail="linked article drafts" />
                <StatusMetric label="Culled" value={String(assignmentMetrics.culled)} detail="manual newsroom cuts" />
              </aside>
            </>
          ) : (
            <>
              <article className="news-desk-lede">
                <p className="story-label">Categorys Desk</p>
                <h2>Steering Notes Run Beside The Edition</h2>
                <p>
                  Proposal rows are copy-desk notes from workers and agents. Skim them like an inside page: accept a correction, reject it, or leave the present course undisturbed.
                </p>
              </article>
              <aside className="news-desk-index" aria-label="News desk status index">
                <StatusMetric label="Accepted Categorys" value={String(canonicalCategorys.length)} detail={activeCategorySet ? activeCategorySet.displayName : "No accepted category set"} />
                <StatusMetric label="Accepted Subcategorys" value={String(acceptedSubcategoryCount)} detail={`${acceptedRootCategoryCount} root categorys`} />
                <StatusMetric label="Filed Notes" value={String(openProposalCount)} detail={`${categoryProposals.length} category / ${genericProposals.length} generic`} />
                <StatusMetric label="Projection Notices" value={String(dashboard.projections.length)} detail={latestImport ? `${latestImport.importKind} ${latestImport.status}` : "No projection import"} />
              </aside>
            </>
          )}
        </section>

        {dashboard.loadError ? (
          <div className="category-steering-alert" role="status">
            {dashboard.loadError}
          </div>
        ) : null}
        {activeTab === "assignments" && assignmentDesk.loadError ? (
          <div className="category-steering-alert" role="status">
            {assignmentDesk.loadError}
          </div>
        ) : null}
        {actionState ? (
          <div className={`category-steering-action category-steering-action--${actionState.tone}`} role="status" aria-live="polite">
            {actionState.message}
          </div>
        ) : null}

        {activeTab === "assignments" ? (
          <AssignmentDeskView
            desk={assignmentDesk}
            disabled={isPending}
            onAction={runAssignmentCullAction}
          />
        ) : (
          <div className="news-desk-columns">
          <div className="news-desk-main-column">
            <AcceptedCategoryTreeSection
              activeCategoryTree={activeCategoryTree}
              canonicalCategorys={canonicalCategorys}
              disabled={isPending}
              onAction={runProposalAction}
              proposals={proposals}
              categoryTreeLoadError={categoryTreeLoadError}
              categoryNodes={activeCategoryTreeNodes}
            />

            <section className="category-steering-section category-steering-section--lead" aria-labelledby="category-proposals-title">
              <SectionHeader title="Category Proposals" detail={`${categoryProposals.length} tailored notes`} />
              <div className="category-steering-proposal-list">
                {categoryProposals.length ? categoryProposals.map((proposal) => (
                  <CategoryProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    category={proposal.categoryKey ? categoryByUid.get(proposal.categoryKey) : undefined}
                    disabled={isPending}
                    onAction={runProposalAction}
                  />
                )) : <EmptyRow label="No category proposals" />}
              </div>
            </section>

            <GenericProposalQueue proposals={genericProposals} disabled={isPending} onAction={runProposalAction} />

            <section className="category-steering-section" aria-labelledby="accepted-category-register-title">
              <SectionHeader title="Accepted Category Register" detail={activeCategorySet ? activeCategorySet.classifierId : "No classifier imported"} />
              <div className="category-steering-category-grid">
                {canonicalCategorys.length ? canonicalCategorys.map((category) => (
                  <CategoryEditor key={category.id} category={category} disabled={isPending} onSave={saveCategory} />
                )) : <EmptyRow label="No canonical categorys imported" />}
              </div>
            </section>
          </div>

          <aside className="news-desk-rail-column">
            <CorpusCategorySetSummary
              corpora={dashboard.corpora}
              categorySets={dashboard.categorySets}
              importRuns={dashboard.importRuns}
              canonicalCategorySetId={activeCategorySet?.id ?? null}
            />

            <CategorySetPanel
              categorySet={activeCategorySet}
              artifacts={dashboard.artifacts}
              projections={dashboard.projections}
            />
          </aside>
          </div>
        )}
      </article>
    </main>
  );
}

function AssignmentDeskView({
  desk,
  disabled,
  onAction,
}: {
  desk: NewsDeskAssignmentDesk;
  disabled: boolean;
  onAction: (candidate: NewsDeskAssignmentCandidate, action: AssignmentCullAction, reason?: string) => void;
}) {
  const sections = getAssignmentSections(desk.candidates);
  const metrics = getAssignmentDeskMetrics(desk);

  return (
    <div className="news-desk-columns news-desk-columns--assignments" data-news-desk-assignments>
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="assignment-candidates-title">
          <SectionHeader title="Assignment Candidates" detail={`${metrics.active} active / ${metrics.culled} culled`} />
          <div className="news-desk-assignment-section-list">
            {sections.length ? sections.map((section) => (
              <AssignmentSection key={section.name} section={section} disabled={disabled} onAction={onAction} />
            )) : <EmptyRow label="No assignment candidates found for an edition" />}
          </div>
        </section>
      </div>

      <aside className="news-desk-rail-column">
        <section className="category-steering-section" aria-labelledby="assignment-edition-ledger-title">
          <SectionHeader title="Edition Ledger" detail={desk.edition?.status ?? "No edition"} />
          <div className="news-desk-ledger-list">
            <article className="news-desk-ledger-item">
              <header>
                <strong>{desk.edition?.title ?? "No assignment edition"}</strong>
                <span>{desk.edition?.editionDate ?? "undated"}</span>
              </header>
              <dl>
                <div>
                  <dt>Target Slots</dt>
                  <dd>{metrics.targetSlots}</dd>
                </div>
                <div>
                  <dt>Active</dt>
                  <dd>{metrics.active}</dd>
                </div>
                <div>
                  <dt>Drafted</dt>
                  <dd>{metrics.drafted}</dd>
                </div>
                <div>
                  <dt>Culled</dt>
                  <dd>{metrics.culled}</dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section className="category-steering-section" aria-labelledby="assignment-section-ledger-title">
          <SectionHeader title="Section Ledger" detail={`${sections.length} sections`} />
          <div className="news-desk-ledger-list">
            {sections.length ? sections.map((section) => {
              const sectionMetrics = getAssignmentCandidateMetrics(section.candidates);
              return (
                <article className="news-desk-ledger-item" key={section.name}>
                  <header>
                    <strong>{section.name}</strong>
                    <span>{sectionMetrics.total} candidates</span>
                  </header>
                  <dl>
                    <div>
                      <dt>Target Slots</dt>
                      <dd>{sectionMetrics.targetSlots}</dd>
                    </div>
                    <div>
                      <dt>Active</dt>
                      <dd>{sectionMetrics.active}</dd>
                    </div>
                    <div>
                      <dt>Drafted</dt>
                      <dd>{sectionMetrics.drafted}</dd>
                    </div>
                    <div>
                      <dt>Culled</dt>
                      <dd>{sectionMetrics.culled}</dd>
                    </div>
                  </dl>
                </article>
              );
            }) : <EmptyRow label="No section assignment ledger" />}
          </div>
        </section>
      </aside>
    </div>
  );
}

function AssignmentSection({
  section,
  disabled,
  onAction,
}: {
  section: AssignmentSectionGroup;
  disabled: boolean;
  onAction: (candidate: NewsDeskAssignmentCandidate, action: AssignmentCullAction, reason?: string) => void;
}) {
  const metrics = getAssignmentCandidateMetrics(section.candidates);

  return (
    <section className="news-desk-assignment-section" aria-label={`${section.name} assignment candidates`}>
      <header className="news-desk-assignment-section__header">
        <div>
          <p className="story-label">{section.name}</p>
          <h3>{section.name} Assignment Pool</h3>
        </div>
        <span>{metrics.targetSlots} slots / {metrics.active} active / {metrics.drafted} drafted / {metrics.culled} culled</span>
      </header>
      <div className="news-desk-assignment-list">
        {section.candidates.map((candidate) => (
          <AssignmentCandidateRow
            key={candidate.assignment.id}
            candidate={candidate}
            disabled={disabled}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function AssignmentCandidateRow({
  candidate,
  disabled,
  onAction,
}: {
  candidate: NewsDeskAssignmentCandidate;
  disabled: boolean;
  onAction: (candidate: NewsDeskAssignmentCandidate, action: AssignmentCullAction, reason?: string) => void;
}) {
  const assignment = candidate.assignment;
  const culled = isCulledItem(assignment);
  const [reason, setReason] = useState(getCullingReason(assignment));
  const title = assignment.headline ?? assignment.title ?? assignment.slug;
  const brief = getAssignmentBrief(assignment) || assignment.deck || "No assignment brief filed.";
  const angle = getAssignmentAngle(assignment);
  const evidenceCount = getAssignmentEvidenceCount(assignment);
  const targetSlots = getAssignmentTargetArticleSlots(assignment);

  useEffect(() => {
    setReason(getCullingReason(assignment));
  }, [assignment]);

  return (
    <article
      className={`news-desk-assignment-row${culled ? " news-desk-assignment-row--culled" : ""}`}
      data-assignment-candidate={assignment.id}
      data-assignment-status={assignment.status}
    >
      <div className="news-desk-assignment-row__main">
        <header className="news-desk-assignment-row__title">
          <div>
            <StatusPill status={assignment.status} />
            <h4>{title}</h4>
          </div>
          <span>{assignment.section ?? "News"}</span>
        </header>
        <p>{brief}</p>
        {angle ? (
          <p className="news-desk-assignment-row__angle">
            <span>Angle</span>
            {angle}
          </p>
        ) : null}
        <div className="news-desk-assignment-row__meta">
          <span>{evidenceCount} evidence refs</span>
          <span>{targetSlots ?? "no"} target slots</span>
          <span>{formatLinkedDraftState(candidate)}</span>
        </div>
      </div>
      <div className="news-desk-assignment-row__actions">
        {culled ? (
          <>
            {reason ? <p className="news-desk-assignment-row__reason">{reason}</p> : null}
            <button
              type="button"
              data-assignment-action="restore"
              disabled={disabled}
              onClick={() => onAction(candidate, "restore")}
            >
              Restore
            </button>
          </>
        ) : (
          <>
            <label>
              <span>Cull Reason</span>
              <textarea
                data-assignment-reason={assignment.id}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              data-assignment-action="cull"
              disabled={disabled}
              onClick={() => onAction(candidate, "cull", reason)}
            >
              Cull
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function StatusMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="category-steering-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

type AssignmentSectionGroup = {
  name: string;
  candidates: NewsDeskAssignmentCandidate[];
};

type AssignmentMetrics = {
  total: number;
  active: number;
  drafted: number;
  culled: number;
  targetSlots: number;
};

function getAssignmentSections(candidates: NewsDeskAssignmentCandidate[]): AssignmentSectionGroup[] {
  const sectionByName = new Map<string, NewsDeskAssignmentCandidate[]>();
  for (const candidate of candidates) {
    const section = candidate.assignment.section?.trim() || "News";
    const entries = sectionByName.get(section) ?? [];
    entries.push(candidate);
    sectionByName.set(section, entries);
  }
  return Array.from(sectionByName.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => ({
      name,
      candidates: entries.sort(compareAssignmentCandidates),
    }));
}

function getAssignmentDeskMetrics(desk: NewsDeskAssignmentDesk): AssignmentMetrics {
  return getAssignmentCandidateMetrics(desk.candidates);
}

function getAssignmentCandidateMetrics(candidates: NewsDeskAssignmentCandidate[]): AssignmentMetrics {
  const targetBySection = new Map<string, number>();
  let active = 0;
  let drafted = 0;
  let culled = 0;

  for (const candidate of candidates) {
    const assignment = candidate.assignment;
    const section = assignment.section?.trim() || "News";
    const targetSlots = getAssignmentTargetArticleSlots(assignment);
    if (targetSlots !== null) {
      targetBySection.set(section, Math.max(targetBySection.get(section) ?? 0, targetSlots));
    }
    if (isCulledItem(assignment)) {
      culled += 1;
    } else {
      active += 1;
    }
    if (assignment.status === "drafted" || assignment.typeStatus.endsWith("#drafted") || candidate.draftItem) {
      drafted += 1;
    }
  }

  return {
    total: candidates.length,
    active,
    drafted,
    culled,
    targetSlots: Array.from(targetBySection.values()).reduce((sum, value) => sum + value, 0),
  };
}

function compareAssignmentCandidates(left: NewsDeskAssignmentCandidate, right: NewsDeskAssignmentCandidate): number {
  const leftStatus = assignmentStatusRank(left.assignment.status);
  const rightStatus = assignmentStatusRank(right.assignment.status);
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;
  return left.editionItem.sortKey.localeCompare(right.editionItem.sortKey);
}

function assignmentStatusRank(status: string): number {
  if (status === "dispatched") return 0;
  if (status === "researched") return 1;
  if (status === "drafted") return 2;
  if (status === "culled") return 8;
  return 5;
}

function formatLinkedDraftState(candidate: NewsDeskAssignmentCandidate): string {
  if (!candidate.draftItem) return "no linked draft";
  const title = candidate.draftItem.headline ?? candidate.draftItem.title ?? "draft article";
  return `${title} / ${candidate.draftItem.status}`;
}

function getNewsDeskTabHref(href: string, demo?: boolean): string {
  if (!demo) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}demo=1`;
}

async function getNewsDeskActorLabel(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload ?? session.tokens?.accessToken.payload ?? {};
    const claim = readTextClaim(payload.email)
      ?? readTextClaim(payload.name)
      ?? readTextClaim(payload["cognito:username"])
      ?? readTextClaim(payload.username)
      ?? readTextClaim(payload.sub);
    return claim ?? "Papyrus news desk";
  } catch {
    return "Papyrus news desk";
  }
}

function readTextClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  return "Sign in with an editor or admin account to inspect category, categoryTree, ontology, and graph steering.";
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <header className="category-steering-section__header">
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
  proposals: CategorySteeringProposal[];
  disabled: boolean;
  onAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
}) {
  return (
    <section className="category-steering-section" aria-labelledby="ontology-and-graph-proposals-title">
      <SectionHeader title="Ontology And Graph Wire" detail={`${proposals.length} generic notes`} />
      <div className="category-steering-table-wrap">
        <table className="category-steering-table">
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
                  <div className="category-steering-proposal__actions" aria-label={`${proposal.title} review actions`}>
                    <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
                    <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6}>No categoryTree, ontology, or graph proposals</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AcceptedCategoryTreeSection({
  activeCategoryTree,
  canonicalCategorys,
  disabled,
  onAction,
  proposals,
  categoryTreeLoadError,
  categoryNodes,
}: {
  activeCategoryTree: CategorySteeringCategoryTree | null;
  canonicalCategorys: CategorySteeringCategory[];
  disabled: boolean;
  onAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
  proposals: CategorySteeringProposal[];
  categoryTreeLoadError: string | null;
  categoryNodes: CategorySteeringCategoryTreeNode[];
}) {
  const roots = canonicalCategorys.map((category) => {
    const node = categoryNodes.find((candidate) => candidate.categoryKey === category.categoryKey && !candidate.parentCategoryKey);
    const subcategorys = categoryNodes.filter((candidate) => candidate.parentCategoryKey === category.categoryKey && candidate.status === "accepted");
    return {
      category,
      node,
      subcategorys,
      proposedSubcategorys: getProposedSubcategoryProposals(category.categoryKey, proposals),
    };
  });
  const subcategoryCount = roots.reduce((count, root) => count + root.subcategorys.length, 0);
  const proposedSubcategoryCount = roots.reduce((count, root) => count + root.proposedSubcategorys.length, 0);
  const detail = activeCategoryTree
    ? `${subcategoryCount} accepted / ${proposedSubcategoryCount} proposed subcategorys`
    : categoryTreeLoadError
      ? "CategoryTree unavailable"
      : "Editor sign-in required";

  return (
    <section className="category-steering-section category-steering-section--categoryTree" aria-labelledby="accepted-categoryTree-title">
      <SectionHeader title="Accepted Subcategory Register" detail={detail} />
      {categoryTreeLoadError ? (
        <div className="category-steering-alert" role="status">
          {categoryTreeLoadError}
        </div>
      ) : null}
      {!activeCategoryTree ? (
        <EmptyRow label="Accepted subcategorys are visible to signed-in editors" />
      ) : (
        <div className="category-steering-categoryTree-list" data-news-desk-category-tree>
          {roots.length ? roots.map(({ node, proposedSubcategorys, subcategorys, category }) => {
            const root = node ?? categoryToCategoryTreeNode(category);
            const relatedProposalCount = countRelatedCategoryTreeProposals(root.categoryKey, subcategorys, proposals);
            return (
              <article className="category-steering-categoryTree-root" data-news-desk-category-tree-root={root.categoryKey} key={root.categoryKey}>
                <header>
                  <div>
                    <p className="story-label">Root Category</p>
                    <h3>{root.displayName}</h3>
                  </div>
                  <span>{subcategorys.length} accepted / {proposedSubcategorys.length} proposed / {relatedProposalCount} related notes</span>
                </header>
                {root.subtitle ? <p className="category-steering-categoryTree-subtitle">{root.subtitle}</p> : null}
                <p>{root.description ?? "Accepted root category."}</p>
                <div className="category-steering-categoryTree-evidence">
                  <span>{compactArray(root.seedItemIds).length} seed refs</span>
                  <span>{compactArray(root.holdoutItemIds).length} holdout refs</span>
                  <span>{root.categoryKey}</span>
                </div>
                <div className="category-steering-subcategory-list">
                  <p className="category-steering-subcategory-list__label">Accepted Subcategorys</p>
                  {subcategorys.length ? subcategorys.map((subcategory) => (
                    <article className="category-steering-subcategory" data-news-desk-subcategory={subcategory.categoryKey} key={subcategory.id}>
                      <h4>{subcategory.displayName}</h4>
                      {subcategory.subtitle ? <p className="category-steering-categoryTree-subtitle">{subcategory.subtitle}</p> : null}
                      <p>{subcategory.description ?? "Accepted subcategory."}</p>
                      <div className="category-steering-categoryTree-evidence">
                        <span>{compactArray(subcategory.seedItemIds).length} seed refs</span>
                        <span>{compactArray(subcategory.holdoutItemIds).length} holdout refs</span>
                        <span>{countRelatedCategoryTreeProposals(subcategory.categoryKey, [], proposals)} related notes</span>
                      </div>
                    </article>
                  )) : (
                    <EmptyRow label="No accepted subcategorys under this root" />
                  )}
                </div>
                {proposedSubcategorys.length ? (
                  <div className="category-steering-subcategory-list category-steering-subcategory-list--proposed">
                    <p className="category-steering-subcategory-list__label">Proposed Subcategorys</p>
                    {proposedSubcategorys.map((proposal) => (
                      <article className="category-steering-subcategory category-steering-subcategory--proposed" data-news-desk-proposed-subcategory={proposal.categoryKey ?? proposal.id} key={proposal.id}>
                        <h4>{proposal.displayName ?? proposal.title}</h4>
                        {proposal.subtitle ? <p className="category-steering-categoryTree-subtitle">{proposal.subtitle}</p> : null}
                        <p>{proposal.description ?? proposal.summary ?? "Candidate subcategory from steering proposals."}</p>
                        <div className="category-steering-categoryTree-evidence">
                          <span>{proposal.proposalKind}</span>
                          <span>{proposal.status}</span>
                          <span>{compactArray(proposal.evidenceItemIds).length} evidence refs</span>
                          <span>{proposal.categoryKey ?? "new category"}</span>
                        </div>
                        <div className="category-steering-proposal__actions category-steering-subcategory__actions" aria-label={`${proposal.title} review actions`}>
                          <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
                          <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          }) : <EmptyRow label="No canonical roots available for categoryTree display" />}
        </div>
      )}
    </section>
  );
}

function formatGenericProposalSubject(proposal: CategorySteeringProposal): string {
  const parts = [
    proposal.categoryKey,
    proposal.graphEntityId,
    proposal.targetCategoryKey ? `-> ${proposal.targetCategoryKey}` : null,
    proposal.displayName,
  ].filter(Boolean);
  return parts.join(" ") || "unmapped";
}

function assertReviewMutationSucceeded(response: CategoryReviewResponse, proposalId: string): NonNullable<CategoryReviewResponse["data"]> {
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

function selectActiveCategoryTree(
  categoryTrees: CategorySteeringCategoryTree[],
  categorySetId: string | null,
  corpusId: string | null,
): CategorySteeringCategoryTree | null {
  const candidates = categoryTrees.filter((categoryTree) => categoryTree.status !== "deprecated");
  const matchingCategorySet = categorySetId ? candidates.filter((categoryTree) => categoryTree.id === categorySetId) : candidates;
  const matchingCorpus = corpusId ? candidates.filter((categoryTree) => categoryTree.corpusId === corpusId) : candidates;
  return matchingCategorySet[0] ?? matchingCorpus[0] ?? candidates[0] ?? null;
}

function categoryToCategoryTreeNode(category: CategorySteeringCategory): CategorySteeringCategoryTreeNode {
  return {
    id: category.id,
    categorySetId: category.categorySetId,
    corpusId: category.corpusId,
    categoryKey: category.categoryKey,
    parentCategoryKey: null,
    displayName: category.displayName,
    subtitle: category.subtitle,
    description: category.description,
    status: category.status,
    seedItemIds: category.seedItemIds,
    holdoutItemIds: category.holdoutItemIds,
    rank: category.rank,
    depth: 0,
    importRunId: null,
    updatedAt: category.updatedAt,
  };
}

function buildCategoryCopyVersion(
  category: CategorySteeringCategory,
  update: Pick<CategorySteeringCategory, "displayName" | "subtitle" | "description">,
  { actorLabel, now }: { actorLabel: string; now: string },
): CategorySteeringCategory {
  const lineageId = category.lineageId ?? category.id;
  const versionNumber = nextVersionNumber(category.versionNumber);
  const nextCategory: CategorySteeringCategory = {
    ...category,
    ...update,
    id: `${lineageId}-v${versionNumber}`,
    lineageId,
    versionNumber,
    previousVersionId: category.id,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: "manual category copy edit",
    updatedAt: now,
  };
  nextCategory.contentHash = contentHashFor(nextCategory);
  return nextCategory;
}

function nextVersionNumber(versionNumber: number | null | undefined): number {
  return typeof versionNumber === "number" && Number.isFinite(versionNumber)
    ? Math.max(1, Math.trunc(versionNumber)) + 1
    : 2;
}

function contentHashFor(value: unknown): string {
  return `fnv1a32:${stableHash(stripHash(value))}`;
}

function stripHash(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "contentHash") continue;
    copy[key] = entry;
  }
  return copy;
}

function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function countRelatedCategoryTreeProposals(
  categoryKey: string,
  subcategorys: CategorySteeringCategoryTreeNode[],
  proposals: CategorySteeringProposal[],
): number {
  const categoryKeys = new Set([categoryKey, ...subcategorys.map((subcategory) => subcategory.categoryKey)]);
  return proposals.filter((proposal) => {
    if (!TAXONOMY_PROPOSAL_KINDS.has(proposal.proposalKind)) return false;
    return Boolean(
      (proposal.categoryKey && categoryKeys.has(proposal.categoryKey)) ||
      (proposal.targetCategoryKey && categoryKeys.has(proposal.targetCategoryKey)),
    );
  }).length;
}

function getProposedSubcategoryProposals(rootCategoryUid: string, proposals: CategorySteeringProposal[]): CategorySteeringProposal[] {
  return proposals
    .filter((proposal) => (
      proposal.proposalKind === "create-category"
      && proposal.status === "proposed"
      && proposal.targetCategoryKey === rootCategoryUid
    ))
    .sort((left, right) => {
      const leftName = left.displayName ?? left.title;
      const rightName = right.displayName ?? right.title;
      return leftName.localeCompare(rightName);
    });
}

function CorpusCategorySetSummary({
  corpora,
  categorySets,
  importRuns,
  canonicalCategorySetId,
}: {
  corpora: CategorySteeringCorpus[];
  categorySets: CategorySteeringCategorySet[];
  importRuns: CategorySteeringImportRun[];
  canonicalCategorySetId: string | null;
}) {
  return (
    <section className="category-steering-section" aria-labelledby="corpus-category-sets-title">
      <SectionHeader title="Corpus Category Sets" detail={`${corpora.length} configured corpora / ${categorySets.length} registers`} />
      <div className="news-desk-ledger-list">
        {corpora.length ? corpora.map((corpus) => {
          const corpusCategorySets = categorySets.filter((categorySet) => categorySet.corpusId === corpus.id);
          const latestImport = importRuns.find((importRun) => importRun.corpusId === corpus.id);
          return (
            <article className="news-desk-ledger-item" key={corpus.id}>
              <header>
                <strong>{corpus.name}</strong>
                <span>{corpus.role}</span>
              </header>
              <dl>
                <div>
                  <dt>Category Sets</dt>
                  <dd>{formatCategorySetNames(corpusCategorySets, canonicalCategorySetId)}</dd>
                </div>
                <div>
                  <dt>Classifiers</dt>
                  <dd>{corpusCategorySets.map((categorySet) => categorySet.classifierId).join(" / ") || "none"}</dd>
                </div>
                <div>
                  <dt>Categorys</dt>
                  <dd>{String(corpusCategorySets.reduce((count, categorySet) => count + (categorySet.categoryCount ?? 0), 0))}</dd>
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

function formatCategorySetNames(categorySets: CategorySteeringCategorySet[], canonicalCategorySetId: string | null): string {
  if (!categorySets.length) return "No category sets";
  return categorySets
    .map((categorySet) => `${categorySet.displayName}${categorySet.id === canonicalCategorySetId ? " (canonical)" : ""}`)
    .join(" / ");
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function CategoryProposalRow({
  proposal,
  category,
  disabled,
  onAction,
}: {
  proposal: CategorySteeringProposal;
  category?: CategorySteeringCategory;
  disabled: boolean;
  onAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
}) {
  const evidence = compactArray(proposal.evidenceItemIds).slice(0, 3);

  return (
    <article className="category-steering-proposal" data-proposal-domain={proposal.steeringDomain}>
      <div className="category-steering-proposal__main">
        <div className="category-steering-proposal__title">
          <StatusPill status={proposal.status} />
          <strong>{proposal.title}</strong>
          <span>{proposal.proposalKind}</span>
        </div>
        <p>{proposal.summary ?? "No summary provided."}</p>
        <dl>
          <div>
            <dt>Category UID</dt>
            <dd>{proposal.categoryKey ?? category?.categoryKey ?? "new category"}</dd>
          </div>
          <div>
            <dt>Display</dt>
            <dd>{proposal.displayName ?? category?.displayName ?? "pending"}</dd>
          </div>
          <div>
            <dt>Subtitle</dt>
            <dd>{proposal.subtitle ?? category?.subtitle ?? "none"}</dd>
          </div>
        </dl>
        <div className="category-steering-evidence-chips">
          {evidence.length ? evidence.map((itemId) => (
            <span key={itemId}>{itemId}</span>
          )) : <span>No evidence rows</span>}
        </div>
      </div>
      <div className="category-steering-proposal__actions" aria-label={`${proposal.title} review actions`}>
        <button type="button" data-review-action="accept" disabled={disabled || proposal.status === "accepted"} onClick={() => onAction(proposal, "accept")}>Accept</button>
        <button type="button" data-review-action="reject" disabled={disabled || proposal.status === "rejected"} onClick={() => onAction(proposal, "reject")}>Reject</button>
      </div>
    </article>
  );
}

function CategoryEditor({
  category,
  disabled,
  onSave,
}: {
  category: CategorySteeringCategory;
  disabled: boolean;
  onSave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "subtitle" | "description">) => void;
}) {
  const [displayName, setDisplayName] = useState(category.displayName);
  const [subtitle, setSubtitle] = useState(category.subtitle ?? "");
  const [description, setDescription] = useState(category.description ?? "");

  return (
    <article className="category-steering-category-card" data-category-uid={category.categoryKey} data-saved-display-name={category.displayName}>
      <header>
        <span>{category.categoryKey}</span>
        <StatusPill status={category.status} />
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
        <span>{compactArray(category.seedItemIds).length} seeds / {compactArray(category.holdoutItemIds).length} holdouts</span>
        <button type="button" data-news-desk-command="save-copy" disabled={disabled || !displayName.trim()} onClick={() => onSave(category, { displayName, subtitle, description })}>Save Copy</button>
      </footer>
    </article>
  );
}

function CategorySetPanel({
  categorySet,
  artifacts,
  projections,
}: {
  categorySet: CategorySteeringCategorySet | null;
  artifacts: CategorySteeringArtifact[];
  projections: CategorySteeringProjection[];
}) {
  return (
    <section className="category-steering-section" aria-labelledby="pressroom-export-title">
      <SectionHeader title="Pressroom Export" detail={categorySet?.status ?? "No category set"} />
      <div className="category-steering-revision-panel">
        <dl>
          <div>
            <dt>Current Version</dt>
            <dd>{categorySet?.versionNumber ?? "none"}</dd>
          </div>
          <div>
            <dt>Version State</dt>
            <dd>{categorySet?.versionState ?? "unknown"}</dd>
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
        <div className="category-steering-artifacts">
          {artifacts.slice(0, 4).map((artifact) => (
            <span key={artifact.id}>{artifact.displayName ?? artifact.artifactId}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`category-steering-pill category-steering-pill--${status}`}>{status}</span>;
}

function EmptyRow({ label }: { label: string }) {
  return <div className="category-steering-empty">{label}</div>;
}

function compactArray(value: Array<string | null> | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function isTailoredCategoryProposal(proposal: CategorySteeringProposal): boolean {
  return proposal.steeringDomain === "category" && TAILORED_TOPIC_PROPOSAL_KINDS.has(proposal.proposalKind);
}

"use client";

import { Hub } from "aws-amplify/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import {
  loadEditorAssignmentsData,
  loadEditorCategoryTreeState,
  loadEditorDoctrineRecordsData,
  loadEditorUserDirectoryData,
  selectRootDeskCategoriesForDoctrine,
} from "./news-desk-taxonomy-client";
import { useOptionalNewsDeskClient } from "./news-desk-client-provider";
import { ReaderAuthControl } from "./reader-auth-control";
import type { ReaderAuthSnapshot } from "./reader-auth-state";
import type {
  AssignmentEventRecord,
  AssignmentRecord,
  CategorySteeringArtifact,
  CategorySteeringCorpus,
  CategorySteeringDashboard,
  CategorySteeringImportRun,
  CategorySteeringProposal,
  CategorySteeringCategoryTree,
  CategorySteeringCategoryTreeNode,
  CategorySteeringCategory,
  CategorySteeringCategorySet,
  CategoryKeywordRecord,
  DoctrineRecord,
  MessageRecord,
  LexicalSteeringRuleRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
  UserDirectoryEntry,
} from "../lib/category-repository";
import {
  type DoctrineKind,
  DOCTRINE_DEFINITION_BY_KIND,
  DOCTRINE_DEFINITIONS,
  DOCTRINE_ITEM_STATUS,
  DOCTRINE_ITEM_TYPE,
  DOCTRINE_ITEM_TYPE_STATUS,
  buildDeskDoctrineDefinition,
  deskDoctrineEditorialValue,
  doctrineBodyToText,
  doctrineEditorialValue,
  doctrineTextToBody,
} from "../lib/doctrine";
import {
  createSemanticGraphSnapshot,
  newsDeskHrefForSemanticObject,
  type SemanticNeighborGroup,
  type SemanticObjectSummary,
} from "../lib/semantic-graph";
import {
  buildCategoryDrilldownContext,
  buildTopicDrilldownContext,
  categoryDrilldownHref,
  categoryLineageId,
  referencesForCategoryContext,
  semanticNodesForCategoryContext,
  topicHref,
  uniqueNeighborGroupsForCategoryContext,
  type CategoryDrilldownContext,
} from "../lib/newsroom-category-drilldown";
import type { NewsDeskShellState } from "../lib/news-desk-session";

type ActionState = {
  id: string;
  message: string;
  tone: "ok" | "error" | "pending";
};

type ReviewAction = "accept" | "reject";
type ReferenceCurationAction = "accept" | "reject" | "reopen" | "archive";
type AssignmentAction = "claim" | "release" | "complete" | "cancel" | "reopen";
type UserRoleAction = "grant" | "revoke";
export type NewsDeskTab = "overview" | "users" | "desks" | "topics" | "concepts" | "references" | "messages" | "assignments" | "doctrine";
type LexicalRuleScope = "publication" | "corpus" | "classifier" | "category";
type LexicalRuleDraft = {
  term: string;
  scope: LexicalRuleScope;
  corpusId?: string | null;
  classifierId?: string | null;
  categorySetId?: string | null;
  categoryKey?: string | null;
  note?: string | null;
};

const REFERENCE_PAGE_SIZE = 25;
const TOPIC_REFERENCE_PAGE_SIZE = 12;

export type NewsDeskSelection = {
  reference?: string | null;
  category?: string | null;
  node?: string | null;
  message?: string | null;
  user?: string | null;
  item?: string | null;
};

type CategoryReviewResponse = {
  data?: {
    ok?: boolean | null;
    status?: string | null;
    proposalId?: string | null;
    decisionId?: string | null;
  } | null;
  errors?: Array<{ message?: string | null } | string | null> | null;
};

type ReferenceReviewResponse = {
  data?: {
    ok?: boolean | null;
    action?: string | null;
    referenceId?: string | null;
    status?: string | null;
    messageId?: string | null;
    relationId?: string | null;
  } | null;
  errors?: Array<{ message?: string | null } | string | null> | null;
};

type MergeSelection = {
  source: UserDirectoryEntry;
  targetUserKey: string;
  reason: string;
  notice?: string;
};

type DoctrineEditorState = Record<DoctrineKind, string>;

function useNewsroomRhythmOverlay() {
  const [showRhythmOverlay, setShowRhythmOverlay] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;

      if ((event.key === "=" || event.code === "Equal") && event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShowRhythmOverlay((current) => !current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return showRhythmOverlay;
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;

  return target.isContentEditable || target.closest("[contenteditable='true']") !== null;
}

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

const NEWS_DESK_TABS: Array<{ id: NewsDeskTab; label: string; detail: string; href: string }> = [
  { id: "overview", label: "Overview", detail: "Desk index", href: "/newsroom" },
  { id: "users", label: "Users", detail: "Roles", href: "/newsroom/users" },
  { id: "desks", label: "Desks", detail: "Sections & Doctrine", href: "/newsroom/desks" },
  { id: "topics", label: "Topics", detail: "Taxonomy", href: "/newsroom/topics" },
  { id: "concepts", label: "Concepts", detail: "Ontology", href: "/newsroom/concepts" },
  { id: "references", label: "References", detail: "Corpus", href: "/newsroom/references" },
  { id: "messages", label: "Messages", detail: "Commentary", href: "/newsroom/messages" },
  { id: "assignments", label: "Assignments", detail: "Placeholder", href: "/newsroom/assignments" },
  { id: "doctrine", label: "Doctrine", detail: "Mission & Policies", href: "/newsroom/doctrine" },
];

const TAXONOMY_PROPOSAL_KINDS = new Set([
  "create-category",
  "move-category",
  "archive-category",
  "merge-categories",
  "split-category",
]);

const USER_POOL_AUTH_MODE = "userPool";
type SemanticGraph = ReturnType<typeof createSemanticGraphSnapshot>;

export function NewsDeskWorkspace({
  dashboard,
  initialTab = "overview",
  initialSelection = {},
}: {
  dashboard: CategorySteeringDashboard | null;
  initialTab?: NewsDeskTab;
  initialSelection?: NewsDeskSelection;
}) {
  const session = useOptionalNewsDeskClient();

  if (dashboard) {
    return (
      <NewsDeskDashboard
        dashboard={dashboard}
        initialSelection={initialSelection}
        initialTab={initialTab}
        authState={{ status: "signedIn", label: "Demo Desk" }}
        isRefreshing={false}
        shellError={null}
      />
    );
  }

  if (session?.shell.dashboard) {
    return (
      <NewsDeskDashboard
        dashboard={session.shell.dashboard}
        initialSelection={initialSelection}
        initialTab={initialTab}
        authState={session.shell.auth}
        isRefreshing={session.shell.phase === "refreshing"}
        shellError={session.shell.error}
        onRefreshAssignments={session.refreshAssignments}
        onRefreshDoctrineRecords={session.refreshDoctrineRecords}
        onRefreshUserDirectory={session.refreshUserDirectory}
      />
    );
  }

  return <NewsDeskAccessGate shell={session?.shell ?? null} />;
}

function NewsDeskDashboard({
  dashboard,
  initialTab,
  initialSelection,
  authState,
  isRefreshing,
  shellError,
  onRefreshAssignments,
  onRefreshDoctrineRecords,
  onRefreshUserDirectory,
}: {
  dashboard: CategorySteeringDashboard;
  initialTab: NewsDeskTab;
  initialSelection: NewsDeskSelection;
  authState: ReaderAuthSnapshot;
  isRefreshing: boolean;
  shellError: string | null;
  onRefreshAssignments?: () => Promise<void>;
  onRefreshDoctrineRecords?: () => Promise<void>;
  onRefreshUserDirectory?: () => Promise<void>;
}) {
  const dataClient = useMemo(() => generateClient<Schema>(), []);
  const activeTab = initialTab;
  const [categorys, setCategorys] = useState(dashboard.categorys);
  const [categoryTrees, setTaxonomies] = useState(dashboard.categoryTrees);
  const [categoryNodes, setCategoryTreeNodes] = useState(dashboard.categoryNodes);
  const [categoryKeywords, setCategoryKeywords] = useState(dashboard.categoryKeywords);
  const [lexicalSteeringRules, setLexicalSteeringRules] = useState(dashboard.lexicalSteeringRules);
  const [categoryTreeLoadError, setCategoryTreeLoadError] = useState<string | null>(null);
  const [proposals, setProposals] = useState(dashboard.proposals);
  const [references, setReferences] = useState(dashboard.references);
  const [messages, setMessages] = useState(dashboard.messages);
  const [semanticRelations, setSemanticRelations] = useState(dashboard.semanticRelations);
  const [assignments, setAssignments] = useState(dashboard.assignments);
  const [assignmentEvents, setAssignmentEvents] = useState(dashboard.assignmentEvents);
  const [doctrineRecords, setDoctrineRecords] = useState(dashboard.doctrineRecords);
  const [userDirectory, setUserDirectory] = useState(dashboard.userDirectory);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [mergeSelection, setMergeSelection] = useState<MergeSelection | null>(null);
  const [isPending, startTransition] = useTransition();
  const showRhythmOverlay = useNewsroomRhythmOverlay();
  const [doctrineDrafts, setDoctrineDrafts] = useState<DoctrineEditorState>(() => buildDoctrineEditorState(dashboard.doctrineRecords));

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
  const rootDeskCategories = useMemo(() => selectRootDeskCategoriesForDoctrine({
    categorys,
    categoryNodes: activeCategoryTreeNodes,
    categorySetId: activeCategorySet?.id ?? null,
  }), [activeCategorySet?.id, activeCategoryTreeNodes, categorys]);
  const acceptedRootCategoryCount = activeCategoryTreeNodes.filter((node) => !node.parentCategoryKey && node.status === "accepted").length;
  const acceptedSubcategoryCount = activeCategoryTreeNodes.filter((node) => node.parentCategoryKey && node.status === "accepted").length;
  const latestImport = useMemo(() => (
    activeCategorySet
      ? dashboard.importRuns.find((importRun) => importRun.corpusId === activeCategorySet.corpusId) ?? dashboard.importRuns[0] ?? null
      : dashboard.importRuns[0] ?? null
  ), [activeCategorySet, dashboard.importRuns]);
  const openProposalCount = proposals.filter((proposal) => proposal.status === "proposed").length;
  const latestImportLabel = latestImport ? formatDateTime(latestImport.importedAt) : "Awaiting import";
  const assignmentMetrics = useMemo(() => getAssignmentMetrics(assignments), [assignments]);
  const mastheadSecondLabel = activeTab === "assignments" ? `${assignmentMetrics.open} open assignments` : latestImportLabel;
  const graph = useMemo(() => createSemanticGraphSnapshot({
    references,
    categories: mergeCategoryRecords(categorys, activeCategoryTreeNodes),
    semanticNodes: dashboard.semanticNodes,
    messages,
    semanticRelations,
    assignments,
    referenceAttachments: dashboard.referenceAttachments,
  }), [
    assignments,
    activeCategoryTreeNodes,
    categorys,
    dashboard.referenceAttachments,
    dashboard.semanticNodes,
    messages,
    references,
    semanticRelations,
  ]);

  const categoryByUid = useMemo(() => {
    const map = new Map<string, CategorySteeringCategory>();
    for (const category of categorys) map.set(category.categoryKey, category);
    return map;
  }, [categorys]);

  useEffect(() => {
    setCategorys(dashboard.categorys);
  }, [dashboard.categorys]);

  useEffect(() => {
    setCategoryKeywords(dashboard.categoryKeywords);
  }, [dashboard.categoryKeywords]);

  useEffect(() => {
    setLexicalSteeringRules(dashboard.lexicalSteeringRules);
  }, [dashboard.lexicalSteeringRules]);

  useEffect(() => {
    setProposals(dashboard.proposals);
  }, [dashboard.proposals]);

  useEffect(() => {
    setReferences(dashboard.references);
  }, [dashboard.references]);

  useEffect(() => {
    setMessages(dashboard.messages);
  }, [dashboard.messages]);

  useEffect(() => {
    setSemanticRelations(dashboard.semanticRelations);
  }, [dashboard.semanticRelations]);

  useEffect(() => {
    setAssignments(dashboard.assignments);
    setAssignmentEvents(dashboard.assignmentEvents);
  }, [dashboard.assignments, dashboard.assignmentEvents]);

  useEffect(() => {
    setDoctrineRecords(dashboard.doctrineRecords);
    setDoctrineDrafts(buildDoctrineEditorState(dashboard.doctrineRecords));
  }, [dashboard.doctrineRecords]);

  useEffect(() => {
    setUserDirectory(dashboard.userDirectory);
  }, [dashboard.userDirectory]);

  useEffect(() => {
    setTaxonomies(dashboard.categoryTrees);
    setCategoryTreeNodes(dashboard.categoryNodes);
    setCategoryTreeLoadError(null);
  }, [dashboard.categoryNodes, dashboard.categoryTrees]);

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
          const response = await dataClient.mutations.reviewSteeringProposal(
            {
              proposalId: proposal.id,
              action,
              actorLabel: "Papyrus newsroom",
              displayName: proposal.displayName ?? undefined,
              shortTitle: proposal.shortTitle ?? undefined,
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

  function runReferenceCurationAction(reference: ReferenceRecord, action: ReferenceCurationAction, note?: string) {
    const nextStatus = referenceCurationStatusForAction(action);
    setActionState({ id: reference.id, message: `${action} pending`, tone: "pending" });
    if (dashboard.isDemo) {
      const now = new Date().toISOString();
      const messageId = `message-demo-${reference.id}-${action}-${now.replace(/[^0-9]/g, "")}`;
      const relationId = `semantic-relation-demo-${messageId}`;
      setReferences((current) => current.map((entry) => entry.id === reference.id
        ? {
            ...entry,
            curationStatus: nextStatus,
            curationStatusKey: `${entry.corpusId}#${nextStatus}`,
            curationStatusUpdatedAt: now,
            curationStatusUpdatedBy: authState.label,
            curationStatusReason: note ?? null,
            updatedAt: now,
          }
        : entry));
      setMessages((current) => [{
        id: messageId,
        messageKind: "reference_curation",
        messageDomain: "commentary",
        status: "active",
        body: note?.trim() || `${authState.label} marked this reference ${nextStatus}.`,
        summary: `${reference.title ?? reference.externalItemId}: ${nextStatus}`,
        source: "newsroom",
        authorLabel: authState.label,
        createdAt: now,
        updatedAt: now,
      }, ...current]);
      setSemanticRelations((current) => [{
        id: relationId,
        relationState: "current",
        predicate: "comment",
        relationTypeId: "semantic-relation-type-comment",
        relationTypeKey: "comment",
        relationDomain: "commentary",
        subjectKind: "message",
        subjectId: messageId,
        subjectLineageId: messageId,
        subjectVersionNumber: 1,
        objectKind: "reference",
        objectId: reference.id,
        objectLineageId: reference.lineageId ?? reference.id,
        objectVersionNumber: reference.versionNumber ?? null,
        subjectStateKey: `message#${messageId}#current`,
        objectStateKey: `reference#${reference.lineageId ?? reference.id}#current`,
        objectSubjectStateKey: `reference#${reference.lineageId ?? reference.id}#current#message`,
        predicateObjectStateKey: `comment#reference#${reference.lineageId ?? reference.id}#current`,
        subjectVersionKey: `message#${messageId}`,
        objectVersionKey: `reference#${reference.id}`,
        rank: 1,
        reviewRecommended: false,
        importedAt: now,
      }, ...current]);
      setActionState({ id: reference.id, message: `${action} saved`, tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const response = await dataClient.mutations.reviewReferenceCuration(
            {
              referenceId: reference.id,
              action,
              actorLabel: authState.label,
              note: note?.trim() || undefined,
            },
            { authMode: USER_POOL_AUTH_MODE },
          );
          const review = assertReferenceReviewMutationSucceeded(response, reference.id);
          const status = review.status ?? nextStatus;
          const now = new Date().toISOString();
          setReferences((current) => current.map((entry) => entry.id === reference.id
            ? {
                ...entry,
                curationStatus: status,
                curationStatusKey: `${entry.corpusId}#${status}`,
                curationStatusUpdatedAt: now,
                curationStatusUpdatedBy: authState.label,
                curationStatusReason: note?.trim() || null,
                updatedAt: now,
              }
            : entry));
          setActionState({ id: reference.id, message: `${action} saved`, tone: "ok" });
        } catch (error) {
          setActionState({ id: reference.id, message: error instanceof Error ? error.message : `${action} failed`, tone: "error" });
        }
      })();
    });
  }

  function createLexicalSteeringRule(draft: LexicalRuleDraft) {
    const normalizedTerm = normalizeKeywordTerm(draft.term);
    if (!normalizedTerm) {
      setActionState({ id: "lexical-rule-empty", message: "keyword term is required", tone: "error" });
      return;
    }
    const now = new Date().toISOString();
    const rule: LexicalSteeringRuleRecord = {
      id: `lexical-rule-ignored-keyword-${hashUiKey([
        draft.scope,
        draft.corpusId ?? "",
        draft.classifierId ?? "",
        draft.categorySetId ?? "",
        draft.categoryKey ?? "",
        normalizedTerm,
      ])}`,
      ruleKind: "ignored_keyword",
      term: draft.term.trim(),
      normalizedTerm,
      scope: draft.scope,
      status: "active",
      corpusId: draft.corpusId ?? null,
      classifierId: draft.classifierId ?? null,
      categorySetId: draft.categorySetId ?? null,
      categoryKey: draft.categoryKey ?? null,
      note: draft.note ?? null,
      source: "newsroom",
      createdBy: authState.label,
      createdAt: now,
      updatedAt: now,
      metadata: { createdFrom: "newsroom/topics" },
    };
    setActionState({ id: rule.id, message: "ignore rule pending", tone: "pending" });
    if (dashboard.isDemo) {
      setLexicalSteeringRules((current) => upsertLocalLexicalRule(current, rule));
      setActionState({ id: rule.id, message: `ignoring "${rule.term}"`, tone: "ok" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          if (!("LexicalSteeringRule" in dataClient.models)) {
            throw new Error("GraphQL model LexicalSteeringRule is not available in the deployed schema.");
          }
          const response = await dataClient.models.LexicalSteeringRule.create(rule as never, { authMode: USER_POOL_AUTH_MODE });
          assertNoGraphQLErrors(response.errors);
          setLexicalSteeringRules((current) => upsertLocalLexicalRule(current, rule));
          setActionState({ id: rule.id, message: `ignoring "${rule.term}"`, tone: "ok" });
        } catch (error) {
          setActionState({ id: rule.id, message: error instanceof Error ? error.message : "ignore rule failed", tone: "error" });
        }
      })();
    });
  }

  function runAssignmentAction(assignment: AssignmentRecord, action: AssignmentAction, note = "") {
    setActionState({ id: assignment.id, message: `${action} pending`, tone: "pending" });
    if (dashboard.isDemo) {
      const now = new Date().toISOString();
      setAssignments((current) => current.map((entry) => entry.id === assignment.id ? applyAssignmentActionLocally(entry, action, now) : entry));
      setAssignmentEvents((current) => [demoAssignmentEvent(assignment, action, now, note), ...current]);
      setActionState({ id: assignment.id, message: `${action} saved`, tone: "ok" });
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const actorLabel = await getNewsDeskActorLabel();
          await executeAssignmentAction(assignment.id, action, actorLabel, note);
          await refreshEditorAssignments();
          setActionState({ id: assignment.id, message: `${action} saved`, tone: "ok" });
        } catch (error) {
          setActionState({
            id: assignment.id,
            message: error instanceof Error ? error.message : `${action} failed`,
            tone: "error",
          });
          await refreshEditorAssignments();
        }
      })();
    });
  }

  async function refreshEditorAssignments() {
    if (dashboard.isDemo) {
      setAssignments(dashboard.assignments);
      setAssignmentEvents(dashboard.assignmentEvents);
      return;
    }
    if (onRefreshAssignments) {
      await onRefreshAssignments();
      return;
    }
    const state = await loadEditorAssignmentsData();
    setAssignments(state.assignments);
    setAssignmentEvents(state.assignmentEvents);
  }

  async function refreshEditorUserDirectory() {
    if (dashboard.isDemo) {
      setUserDirectory(dashboard.userDirectory);
      return;
    }
    if (onRefreshUserDirectory) {
      await onRefreshUserDirectory();
      return;
    }
    setUserDirectory(await loadEditorUserDirectoryData());
  }

  async function refreshEditorDoctrineRecords() {
    if (dashboard.isDemo) {
      setDoctrineRecords(dashboard.doctrineRecords);
      setDoctrineDrafts(buildDoctrineEditorState(dashboard.doctrineRecords));
      return;
    }
    if (onRefreshDoctrineRecords) {
      await onRefreshDoctrineRecords();
      return;
    }
    const nextRecords = await loadEditorDoctrineRecordsData({ rootCategories: rootDeskCategories });
    setDoctrineRecords(nextRecords);
    setDoctrineDrafts(buildDoctrineEditorState(nextRecords));
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

  function updateDoctrineDraft(kind: DoctrineKind, text: string) {
    setDoctrineDrafts((current) => ({ ...current, [kind]: text }));
  }

  function saveDoctrine(kind: DoctrineKind) {
    const definition = requireDoctrineDefinition(kind);
    const currentRecord = doctrineRecords.find((record) => record.slug === definition.slug) ?? null;
    const recordKey = definition.slug;
    setActionState({ id: recordKey, message: "doctrine save pending", tone: "pending" });

    const nextBody = doctrineTextToBody(doctrineDrafts[kind]);
    const now = new Date().toISOString();

    if (dashboard.isDemo) {
      const nextRecord = buildDoctrineRecord(kind, nextBody, currentRecord, now, "Papyrus newsroom");
      setDoctrineRecords((current) => replaceDoctrineRecord(current, nextRecord));
      setActionState({ id: recordKey, message: "doctrine saved", tone: "ok" });
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const actorLabel = await getNewsDeskActorLabel();
          const nextRecord = buildDoctrineRecord(kind, nextBody, currentRecord, now, actorLabel);
          if (currentRecord) {
            const response = await dataClient.models.Item.update({
              id: currentRecord.id,
              title: nextRecord.title,
              headline: nextRecord.headline,
              body: nextRecord.body,
              editorial: nextRecord.editorial,
              updatedAt: nextRecord.updatedAt,
            }, { authMode: USER_POOL_AUTH_MODE });
            assertNoGraphQLErrors(response.errors);
            if (!response.data?.id) throw new Error("Doctrine update returned no saved record.");
          } else {
            const response = await dataClient.models.Item.create(nextRecord as never, { authMode: USER_POOL_AUTH_MODE });
            assertNoGraphQLErrors(response.errors);
            if (!response.data?.id) throw new Error("Doctrine create returned no saved record.");
          }
          await refreshEditorDoctrineRecords();
          setActionState({ id: recordKey, message: "doctrine saved", tone: "ok" });
        } catch (error) {
          setActionState({ id: recordKey, message: error instanceof Error ? error.message : "doctrine save failed", tone: "error" });
          await refreshEditorDoctrineRecords();
        }
      })();
    });
  }

  function saveDeskDoctrine(category: CategorySteeringCategory, kind: DoctrineKind, text: string) {
    const definition = buildDeskDoctrineDefinition(category, kind);
    const currentRecord = doctrineRecords.find((record) => record.slug === definition.slug) ?? null;
    const recordKey = definition.slug;
    setActionState({ id: recordKey, message: "desk doctrine save pending", tone: "pending" });

    const nextBody = doctrineTextToBody(text);
    const now = new Date().toISOString();

    if (dashboard.isDemo) {
      const nextRecord = buildDeskDoctrineRecord(category, kind, nextBody, currentRecord, now, "Papyrus newsroom");
      setDoctrineRecords((current) => replaceDoctrineRecord(current, nextRecord));
      setActionState({ id: recordKey, message: "desk doctrine saved", tone: "ok" });
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const actorLabel = await getNewsDeskActorLabel();
          const nextRecord = buildDeskDoctrineRecord(category, kind, nextBody, currentRecord, now, actorLabel);
          if (currentRecord) {
            const response = await dataClient.models.Item.update({
              id: currentRecord.id,
              title: nextRecord.title,
              headline: nextRecord.headline,
              body: nextRecord.body,
              editorial: nextRecord.editorial,
              updatedAt: nextRecord.updatedAt,
            }, { authMode: USER_POOL_AUTH_MODE });
            assertNoGraphQLErrors(response.errors);
            if (!response.data?.id) throw new Error("Desk doctrine update returned no saved record.");
          } else {
            const response = await dataClient.models.Item.create(nextRecord as never, { authMode: USER_POOL_AUTH_MODE });
            assertNoGraphQLErrors(response.errors);
            if (!response.data?.id) throw new Error("Desk doctrine create returned no saved record.");
          }
          await refreshEditorDoctrineRecords();
          setActionState({ id: recordKey, message: "desk doctrine saved", tone: "ok" });
        } catch (error) {
          setActionState({ id: recordKey, message: error instanceof Error ? error.message : "desk doctrine save failed", tone: "error" });
          await refreshEditorDoctrineRecords();
        }
      })();
    });
  }

  async function executeAssignmentAction(assignmentId: string, action: AssignmentAction, actorLabel: string, note: string) {
    const mutationName = `${action}Assignment` as keyof typeof dataClient.mutations;
    const mutation = dataClient.mutations[mutationName] as unknown as ((args: Record<string, unknown>, options: { authMode: typeof USER_POOL_AUTH_MODE }) => Promise<unknown>) | undefined;
    if (!mutation) throw new Error(`Assignment action ${mutationName} is not available in the deployed schema.`);
    await mutation({
      assignmentId,
      actorLabel,
      assigneeType: "user",
      assigneeId: actorLabel,
      note: note.trim() || undefined,
    }, { authMode: USER_POOL_AUTH_MODE });
  }

  function runUserRoleAction(user: UserDirectoryEntry, role: string, action: UserRoleAction) {
    const userId = user.userProfileId ?? user.userSub ?? "unknown-user";
    const label = action === "grant" ? "grant" : "revoke";
    setActionState({ id: userId, message: `${label} ${role} pending`, tone: "pending" });
    if (dashboard.isDemo) {
      setUserDirectory((current) => current.map((entry) => {
        if ((entry.userProfileId ?? entry.userSub) !== (user.userProfileId ?? user.userSub)) return entry;
        const roles = new Set(compactArray(entry.activeRoles));
        if (action === "grant") roles.add(role);
        if (action === "revoke") roles.delete(role);
        return { ...entry, activeRoles: Array.from(roles).sort() };
      }));
      setActionState({ id: userId, message: `${label} ${role} saved`, tone: "ok" });
      return;
    }
    if (!dashboard.canManageUsers) {
      setActionState({ id: userId, message: "admin role required", tone: "error" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const input = {
            userProfileId: user.userProfileId ?? undefined,
            userSub: user.userSub ?? undefined,
            cognitoSubs: compactArray(user.identities?.map((identity) => identity.cognitoSub) ?? []),
            role,
          };
          const response = action === "grant"
            ? await dataClient.mutations.grantUserRole(input, { authMode: USER_POOL_AUTH_MODE })
            : await dataClient.mutations.revokeUserRole(input, { authMode: USER_POOL_AUTH_MODE });
          assertNoGraphQLErrors(response.errors);
          const activeRoles = compactArray(response.data?.activeRoles ?? []);
          setUserDirectory((current) => current.map((entry) => (
            (entry.userProfileId ?? entry.userSub) === (user.userProfileId ?? user.userSub)
              ? { ...entry, activeRoles }
              : entry
          )));
          setActionState({ id: userId, message: `${label} ${role} saved`, tone: "ok" });
        } catch (error) {
          setActionState({ id: userId, message: error instanceof Error ? error.message : `${label} ${role} failed`, tone: "error" });
        }
      })();
    });
  }

  function openUserMerge(source: UserDirectoryEntry) {
    const sourceKey = getUserDirectoryEntryKey(source);
    const otherUsers = userDirectory.filter((entry) => getUserDirectoryEntryKey(entry) !== sourceKey);
    const target = otherUsers[0] ?? null;
    setMergeSelection({
      source,
      targetUserKey: target ? getUserDirectoryEntryKey(target) : "",
      reason: "",
    });
  }

  function updateUserMergeTarget(targetUserKey: string) {
    setMergeSelection((current) => current ? { ...current, targetUserKey } : current);
  }

  function updateUserMergeReason(reason: string) {
    setMergeSelection((current) => current ? { ...current, reason } : current);
  }

  function runUserMergeAction() {
    if (!mergeSelection) return;
    const { source, targetUserKey, reason } = mergeSelection;
    const target = userDirectory.find((entry) => getUserDirectoryEntryKey(entry) === targetUserKey) ?? null;
    const sourceId = source.userProfileId ?? source.userSub ?? "unknown-user";
    setActionState({ id: sourceId, message: "merge pending", tone: "pending" });
    if (!target) {
      setActionState({ id: sourceId, message: "choose a target user", tone: "error" });
      return;
    }
    if (getUserDirectoryEntryKey(source) === getUserDirectoryEntryKey(target)) {
      setActionState({ id: sourceId, message: "source and target users must be different", tone: "error" });
      return;
    }
    if (dashboard.isDemo) {
      setUserDirectory((current) => mergeDemoUsers(current, source, target));
      setMergeSelection(null);
      setActionState({ id: sourceId, message: "merge saved", tone: "ok" });
      return;
    }
    if (!dashboard.canManageUsers) {
      setActionState({ id: sourceId, message: "admin role required", tone: "error" });
      return;
    }
    startTransition(() => {
      void (async () => {
        try {
          const response = await (dataClient.mutations.mergeUserProfiles as unknown as (
            args: Record<string, unknown>,
            options: { authMode: typeof USER_POOL_AUTH_MODE },
          ) => Promise<{ errors?: Array<{ message?: string | null } | string | null> | null }>)({
            targetUserProfileId: target.userProfileId ?? undefined,
            targetUserSub: target.userSub ?? undefined,
            sourceUserProfileId: source.userProfileId ?? undefined,
            sourceUserSub: source.userSub ?? undefined,
            reason: reason.trim() || undefined,
          }, { authMode: USER_POOL_AUTH_MODE });
          assertNoGraphQLErrors(response.errors);
          await refreshEditorUserDirectory();
          setMergeSelection(null);
          setActionState({ id: sourceId, message: "merge saved", tone: "ok" });
        } catch (error) {
          setActionState({ id: sourceId, message: error instanceof Error ? error.message : "merge failed", tone: "error" });
          await refreshEditorUserDirectory();
        }
      })();
    });
  }

  function saveCategory(category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) {
    setActionState({ id: category.id, message: "category save pending", tone: "pending" });
    const updatedAt = new Date().toISOString();
    if (dashboard.isDemo) {
      const nextCategory = buildCategoryCopyVersion(category, update, {
        actorLabel: "Papyrus newsroom",
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
    <main
      className="site-shell news-desk-shell"
      data-news-desk
      data-category-steering
      data-category-steering-demo={dashboard.isDemo ? "true" : "false"}
      data-news-desk-refreshing={isRefreshing ? "true" : "false"}
      data-rhythm-overlay={showRhythmOverlay ? "true" : "false"}
    >
      <section className="scroll-edition news-desk-edition">
        <div className="paper-page paper-page--front paper-page--active">
          <article className="paper-page-content paper-page-content--front news-desk-page" aria-labelledby="news-desk-title">
        <header className="masthead news-desk-masthead">
          <div className="masthead__rule" />
          <h1 id="news-desk-title">
            <span>NEWSROOM</span>
          </h1>
          <div className="masthead__meta" aria-label="Newsroom edition status">
            <span>Steering Section</span>
            <span>{mastheadSecondLabel}</span>
            <span>{dashboard.isDemo ? "Demo Desk" : <ReaderAuthControl className="news-desk-auth-control" showIdentity authState={authState} />}</span>
          </div>
        </header>

        <nav className="news-desk-tabs" aria-label="Newsroom sections">
          {NEWS_DESK_TABS.map((tab) => (
            <Link
              key={tab.id}
              aria-current={tab.id === activeTab ? "page" : undefined}
              className={`news-desk-tab${tab.id === activeTab ? " news-desk-tab--active" : ""}`}
              data-news-desk-tab={tab.id}
              href={getNewsDeskTabHref(tab.href, dashboard.isDemo)}
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </Link>
          ))}
        </nav>

        <section className="news-desk-lede-grid" aria-label="Newsroom overview">
          <article className="news-desk-lede">
            <p className="story-label">{formatDeskSectionLabel(activeTab)}</p>
            <h2>{formatDeskSectionHeadline(activeTab)}</h2>
            <p>{formatDeskSectionLede(activeTab)}</p>
          </article>
          <aside className="news-desk-index" aria-label="Newsroom status index">
            <StatusMetric label="Users" value={String(userDirectory.length)} detail={dashboard.canManageUsers ? "admin directory" : "admin-only directory"} />
            <StatusMetric label="Desks" value={String(rootDeskCategories.length)} detail="root topic desks" />
            <StatusMetric label="Topics" value={String(canonicalCategorys.length)} detail={`${acceptedSubcategoryCount} accepted subtopics`} />
            <StatusMetric label="Concepts" value={String(dashboard.semanticNodes.length)} detail={`${dashboard.semanticRelations.length} semantic links`} />
            <StatusMetric label="References" value={String(dashboard.references.length)} detail={`${dashboard.referenceAttachments.length} private files`} />
            <StatusMetric label="Assignments" value={String(assignmentMetrics.total)} detail={`${assignmentMetrics.open} open / ${assignmentMetrics.claimed} claimed`} />
            <StatusMetric label="Doctrine" value={String(doctrineRecords.length)} detail="mission and policy slots" />
          </aside>
        </section>

        {dashboard.loadError ? (
          <div className="category-steering-alert" role="status">
            {dashboard.loadError}
          </div>
        ) : null}
        {isRefreshing ? (
          <div className="category-steering-alert" role="status">
            Refreshing newsroom data...
          </div>
        ) : null}
        {!isRefreshing && shellError ? (
          <div className="category-steering-alert" role="status">
            {shellError}
          </div>
        ) : null}
        {actionState ? (
          <div className={`category-steering-action category-steering-action--${actionState.tone}`} role="status" aria-live="polite">
            {actionState.message}
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <OverviewDeskView
            assignmentMetrics={assignmentMetrics}
            dashboard={dashboard}
            doctrineCount={doctrineRecords.length}
            graph={graph}
            latestImport={latestImport}
            userDirectory={userDirectory}
          />
        ) : null}
        {activeTab === "users" ? (
          <UsersDeskView
            canManageUsers={Boolean(dashboard.canManageUsers)}
            disabled={isPending}
            mergeSelection={mergeSelection}
            onCancelMerge={() => setMergeSelection(null)}
            onConfirmMerge={runUserMergeAction}
            onMergeReasonChange={updateUserMergeReason}
            onMergeRequest={openUserMerge}
            onMergeTargetChange={updateUserMergeTarget}
            users={userDirectory}
            onRoleAction={runUserRoleAction}
          />
        ) : null}
        {activeTab === "desks" ? (
          <DesksDeskView
            assignments={assignments}
            categoryByUid={categoryByUid}
            categoryNodes={activeCategoryTreeNodes}
            disabled={isPending}
            doctrineRecords={doctrineRecords}
            graph={graph}
            initialCategoryLineageId={initialSelection.category}
            isDemo={Boolean(dashboard.isDemo)}
            onCategorySave={saveCategory}
            onDeskDoctrineSave={saveDeskDoctrine}
            rootCategories={rootDeskCategories}
            statusMessage={actionState}
          />
        ) : null}
        {activeTab === "topics" ? (
          <TopicsDeskView
            activeCategorySet={activeCategorySet}
            activeCategoryTree={activeCategoryTree}
            artifacts={dashboard.artifacts}
            canonicalCategorys={canonicalCategorys}
            categoryByUid={categoryByUid}
            categoryKeywords={categoryKeywords}
            categoryProposals={categoryProposals}
            categoryTreeLoadError={categoryTreeLoadError}
            categoryNodes={activeCategoryTreeNodes}
            categorySets={dashboard.categorySets}
            corpora={dashboard.corpora}
            disabled={isPending}
            genericProposals={genericProposals}
            graph={graph}
            importRuns={dashboard.importRuns}
            initialCategoryLineageId={initialSelection.category}
            messages={messages}
            lexicalSteeringRules={lexicalSteeringRules}
            onCategorySave={saveCategory}
            onLexicalRuleCreate={createLexicalSteeringRule}
            onProposalAction={runProposalAction}
            proposals={proposals}
            referenceAttachments={dashboard.referenceAttachments}
            references={references}
            semanticRelations={semanticRelations}
          />
        ) : null}
        {activeTab === "concepts" ? (
          <ConceptsDeskView
            categories={mergeCategoryRecords(categorys, activeCategoryTreeNodes)}
            graph={graph}
            initialCategoryLineageId={initialSelection.category}
            initialNodeLineageId={initialSelection.node}
            semanticNodes={dashboard.semanticNodes}
          />
        ) : null}
        {activeTab === "references" ? (
          <ReferencesDeskView
            categories={mergeCategoryRecords(categorys, activeCategoryTreeNodes)}
            graph={graph}
            initialCategoryLineageId={initialSelection.category}
            initialReferenceLineageId={initialSelection.reference}
            references={references}
            disabled={isPending}
            onReview={runReferenceCurationAction}
          />
        ) : null}
        {activeTab === "messages" ? (
          <MessagesDeskView
            graph={graph}
            initialMessageId={initialSelection.message}
            messages={messages}
          />
        ) : null}
        {activeTab === "assignments" ? (
          <AssignmentDeskView
            assignments={assignments}
            assignmentEvents={assignmentEvents}
            graph={graph}
            disabled={isPending}
            onAction={runAssignmentAction}
          />
        ) : null}
        {activeTab === "doctrine" ? (
          <DoctrineDeskView
            doctrineDrafts={doctrineDrafts}
            doctrineRecords={doctrineRecords}
            disabled={isPending}
            onChange={updateDoctrineDraft}
            onSave={saveDoctrine}
            actionState={actionState}
          />
        ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}

function OverviewDeskView({
  assignmentMetrics,
  dashboard,
  doctrineCount,
  graph,
  latestImport,
  userDirectory,
}: {
  assignmentMetrics: AssignmentMetrics;
  dashboard: CategorySteeringDashboard;
  doctrineCount: number;
  graph: SemanticGraph;
  latestImport: CategorySteeringImportRun | null;
  userDirectory: UserDirectoryEntry[];
}) {
  const selectedReference = dashboard.references[0] ?? null;
  const selectedSummary = selectedReference ? graph.resolve("reference", selectedReference.lineageId ?? selectedReference.id) : null;
  return (
    <div className="news-desk-columns" data-news-desk-section="overview">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="knowledge-wire-title">
          <SectionHeader title="Knowledge Wire" detail={latestImport ? `${latestImport.importKind} / ${latestImport.status}` : "No import run"} />
          <div className="news-desk-ledger-list news-desk-ledger-list--compact">
            <DeskLinkCard href="/newsroom/references" label="References" value={dashboard.references.length} detail={`${dashboard.referenceAttachments.length} attachments`} />
            <DeskLinkCard href="/newsroom/messages" label="Messages" value={dashboard.messages.length} detail="private commentary" />
            <DeskLinkCard href="/newsroom/concepts" label="Concepts" value={dashboard.semanticNodes.length} detail={`${dashboard.semanticRelations.length} relations`} />
            <DeskLinkCard href="/newsroom/desks" label="Desks" value={dashboard.categorys.filter((category) => category.status === "accepted" && !category.parentCategoryKey).length} detail="sections and doctrine" />
            <DeskLinkCard href="/newsroom/topics" label="Topics" value={dashboard.categorys.length} detail={`${dashboard.proposals.filter((proposal) => proposal.status === "proposed").length} open proposals`} />
            <DeskLinkCard href="/newsroom/users" label="Users" value={userDirectory.length} detail={dashboard.canManageUsers ? "role desk available" : "admin role required"} />
            <DeskLinkCard href="/newsroom/assignments" label="Assignments" value={assignmentMetrics.total} detail={`${assignmentMetrics.open} open work items`} />
            <DeskLinkCard href="/newsroom/doctrine" label="Doctrine" value={doctrineCount} detail="mission and policy" />
          </div>
        </section>

        <section className="category-steering-section" aria-labelledby="reference-ledger-title">
          <SectionHeader title="Reference Ledger" detail={`${dashboard.references.length} private metadata rows`} />
          <ReferenceLedger references={dashboard.references.slice(0, 8)} selectedLineageId={selectedReference?.lineageId ?? null} />
        </section>
      </div>

      <aside className="news-desk-rail-column">
        <CorpusCategorySetSummary
          corpora={dashboard.corpora}
          categorySets={dashboard.categorySets}
          importRuns={dashboard.importRuns}
          canonicalCategorySetId={dashboard.canonicalCategorySetId ?? null}
        />
        <SemanticDetailPanel graph={graph} selected={selectedSummary} />
      </aside>
    </div>
  );
}

function DoctrineDeskView({
  doctrineDrafts,
  doctrineRecords,
  disabled,
  onChange,
  onSave,
  actionState,
}: {
  doctrineDrafts: DoctrineEditorState;
  doctrineRecords: DoctrineRecord[];
  disabled: boolean;
  onChange: (kind: DoctrineKind, text: string) => void;
  onSave: (kind: DoctrineKind) => void;
  actionState: ActionState | null;
}) {
  return (
    <div className="news-desk-columns" data-news-desk-section="doctrine">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="newsroom-doctrine-title">
          <SectionHeader title="Editorial Doctrine" detail="Private newsroom doctrine records" />
          <div className="news-desk-doctrine-list">
            {DOCTRINE_DEFINITIONS.map((definition) => {
              const record = doctrineRecords.find((entry) => entry.slug === definition.slug) ?? null;
              const statusId = definition.slug;
              const statusMessage = actionState?.id === statusId ? actionState : null;
              return (
                <DoctrineEditorCard
                  key={definition.kind}
                  body={doctrineDrafts[definition.kind]}
                  definition={definition}
                  disabled={disabled}
                  record={record}
                  statusMessage={statusMessage}
                  onChange={onChange}
                  onSave={onSave}
                />
              );
            })}
          </div>
        </section>
      </div>

      <aside className="news-desk-rail-column">
        <section className="category-steering-section" aria-labelledby="doctrine-notes-title">
          <SectionHeader title="Doctrine Notes" detail="Singleton editor records" />
          <div className="news-desk-ledger-list">
            <article className="news-desk-ledger-item">
              <header>
                <strong>Editorial Mission</strong>
                <span>Fixed slot</span>
              </header>
              <p>Use this slot for the publication&apos;s purpose, audience, and coverage focus.</p>
            </article>
            <article className="news-desk-ledger-item">
              <header>
                <strong>Editorial Policy</strong>
                <span>Fixed slot</span>
              </header>
              <p>Use this slot for sourcing, standards, review rules, corrections, and similar newsroom doctrine.</p>
            </article>
          </div>
        </section>
      </aside>
    </div>
  );
}

function DoctrineEditorCard({
  body,
  definition,
  disabled,
  record,
  statusMessage,
  onChange,
  onSave,
}: {
  body: string;
  definition: { kind: DoctrineKind; label: string; slug: string };
  disabled: boolean;
  record: DoctrineRecord | null;
  statusMessage: ActionState | null;
  onChange: (kind: DoctrineKind, text: string) => void;
  onSave: (kind: DoctrineKind) => void;
}) {
  const paragraphCount = doctrineTextToBody(body).length;
  return (
    <article className="news-desk-doctrine-card" data-news-desk-doctrine={definition.kind}>
      <header className="news-desk-doctrine-card__header">
        <div>
          <p className="story-label">Doctrine</p>
          <h3>{definition.label}</h3>
        </div>
        <span>{record ? "Saved record" : "Empty slot"}</span>
      </header>
      <label className="news-desk-doctrine-card__field">
        <span>{definition.label}</span>
        <textarea
          data-news-desk-doctrine-input={definition.kind}
          disabled={disabled}
          onChange={(event) => onChange(definition.kind, event.target.value)}
          placeholder={`Enter the ${definition.label.toLowerCase()}.`}
          value={body}
        />
      </label>
      <div className="news-desk-doctrine-card__footer">
        <span>{paragraphCount} paragraph{paragraphCount === 1 ? "" : "s"}</span>
        <div className="news-desk-doctrine-card__actions">
          {statusMessage ? <span data-tone={statusMessage.tone}>{statusMessage.message}</span> : null}
          <button
            type="button"
            data-news-desk-doctrine-save={definition.kind}
            disabled={disabled}
            onClick={() => onSave(definition.kind)}
          >
            Save
          </button>
        </div>
      </div>
    </article>
  );
}

function UsersDeskView({
  canManageUsers,
  disabled,
  mergeSelection,
  onCancelMerge,
  onConfirmMerge,
  onMergeReasonChange,
  onMergeRequest,
  onMergeTargetChange,
  users,
  onRoleAction,
}: {
  canManageUsers: boolean;
  disabled: boolean;
  mergeSelection: MergeSelection | null;
  onCancelMerge: () => void;
  onConfirmMerge: () => void;
  onMergeReasonChange: (reason: string) => void;
  onMergeRequest: (user: UserDirectoryEntry) => void;
  onMergeTargetChange: (targetUserProfileId: string) => void;
  users: UserDirectoryEntry[];
  onRoleAction: (user: UserDirectoryEntry, role: string, action: UserRoleAction) => void;
}) {
  return (
    <div className="news-desk-columns" data-news-desk-section="users">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="user-directory-title">
          <SectionHeader title="User Directory" detail={canManageUsers ? `${users.length} mapped users` : "Admin role required"} />
          {!canManageUsers ? <div className="category-steering-alert">Only admins can list Cognito users or change editor/admin roles.</div> : null}
          <div className="news-desk-user-list">
            {users.length ? users.map((user) => (
              <UserDirectoryRow
                key={user.userProfileId ?? user.userSub ?? user.email ?? "unknown"}
                canManageUsers={canManageUsers}
                canMerge={users.length > 1}
                disabled={disabled}
                onMergeRequest={onMergeRequest}
                onRoleAction={onRoleAction}
                user={user}
              />
            )) : <EmptyRow label={canManageUsers ? "No users returned by the directory" : "Sign in as an admin to load user records"} />}
          </div>
          {mergeSelection ? (
            <UserMergePanel
              disabled={disabled}
              onCancel={onCancelMerge}
              onConfirm={onConfirmMerge}
              onReasonChange={onMergeReasonChange}
              onTargetChange={onMergeTargetChange}
              selection={mergeSelection}
              users={users}
            />
          ) : null}
        </section>
      </div>
      <aside className="news-desk-rail-column">
        <section className="category-steering-section" aria-labelledby="identity-policy-title">
          <SectionHeader title="Identity Policy" detail="Profile first" />
          <div className="category-steering-revision-panel">
            <p>
              A Papyrus user is a stable profile. One profile can carry multiple Cognito identities, so separate Google accounts can still resolve to the same editor.
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function UserDirectoryRow({
  canManageUsers,
  canMerge,
  disabled,
  onMergeRequest,
  user,
  onRoleAction,
}: {
  canManageUsers: boolean;
  canMerge: boolean;
  disabled: boolean;
  onMergeRequest: (user: UserDirectoryEntry) => void;
  user: UserDirectoryEntry;
  onRoleAction: (user: UserDirectoryEntry, role: string, action: UserRoleAction) => void;
}) {
  const activeRoles = new Set(compactArray(user.activeRoles));
  const label = user.displayName ?? user.email ?? user.username ?? user.userSub ?? "Unknown user";
  const identityCount = user.identities.length;
  return (
    <article className="news-desk-user-row" data-news-desk-user={user.userProfileId ?? user.userSub ?? label}>
      <div>
        <header>
          <strong>{label}</strong>
          <span>{compactArray(user.activeRoles).join(" / ") || "reader"}</span>
        </header>
        <p>{user.email ?? "No email"} / {user.provider ?? "provider unknown"} / {user.cognitoStatus ?? "no Cognito status"} / {identityCount} {identityCount === 1 ? "identity" : "identities"}</p>
        <div className="news-desk-chip-row">
          {user.identities.length ? user.identities.map((identity) => (
            <span key={identity.id}>{identity.email ?? identity.cognitoSub} ({identity.status})</span>
          )) : <span>No linked identity row</span>}
        </div>
      </div>
      <div className="news-desk-user-row__actions">
        {["editor", "admin"].map((role) => {
          const active = activeRoles.has(role);
          return (
            <button
              key={role}
              type="button"
              disabled={disabled || !canManageUsers}
              onClick={() => onRoleAction(user, role, active ? "revoke" : "grant")}
            >
              {active ? `Revoke ${role}` : `Make ${role}`}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled || !canManageUsers || !canMerge}
          onClick={() => onMergeRequest(user)}
        >
          Merge
        </button>
      </div>
    </article>
  );
}

function UserMergePanel({
  disabled,
  selection,
  users,
  onCancel,
  onConfirm,
  onReasonChange,
  onTargetChange,
}: {
  disabled: boolean;
  selection: MergeSelection;
  users: UserDirectoryEntry[];
  onCancel: () => void;
  onConfirm: () => void;
  onReasonChange: (reason: string) => void;
  onTargetChange: (targetUserKey: string) => void;
}) {
  const source = selection.source;
  const sourceKey = getUserDirectoryEntryKey(source);
  const targetOptions = users.filter((user) => getUserDirectoryEntryKey(user) !== sourceKey);
  const target = targetOptions.find((user) => getUserDirectoryEntryKey(user) === selection.targetUserKey) ?? null;
  return (
    <section className="category-steering-section news-desk-merge-panel" aria-labelledby="user-merge-title" data-news-desk-user-merge-panel="true">
      <SectionHeader title="Merge Users" detail="Identity repair" />
      <div className="category-steering-revision-panel">
        {selection.notice ? <p>{selection.notice}</p> : null}
        <label>
          <span>Source</span>
          <strong>{formatUserLabel(source)}</strong>
        </label>
        <label>
          <span>Target user</span>
          <select
            data-news-desk-merge-target
            disabled={disabled}
            value={selection.targetUserKey}
            onChange={(event) => onTargetChange(event.target.value)}
          >
            <option value="">Choose target user</option>
            {targetOptions.map((user) => (
              <option key={getUserDirectoryEntryKey(user)} value={getUserDirectoryEntryKey(user)}>
                {formatUserLabel(user)}{user.userProfileId ? "" : " (create profile)"}
              </option>
            ))}
          </select>
        </label>
        {!targetOptions.length ? (
          <p>No other user is available as a merge target.</p>
        ) : null}
        <label>
          <span>Reason</span>
          <textarea
            data-news-desk-merge-reason
            disabled={disabled}
            placeholder="Same human account"
            rows={3}
            value={selection.reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
      </div>
      <div className="news-desk-merge-preview">
        <UserMergeIdentityBlock title="Source identities" user={source} />
        {target ? <UserMergeIdentityBlock title="Target identities" user={target} /> : null}
      </div>
      <div className="news-desk-user-row__actions">
        <button type="button" data-news-desk-merge-confirm disabled={disabled || !selection.targetUserKey} onClick={onConfirm}>Confirm Merge</button>
        <button type="button" disabled={disabled} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function UserMergeIdentityBlock({ title, user }: { title: string; user: UserDirectoryEntry }) {
  const fallback = user.userSub ?? user.email ?? "No linked identity row";
  return (
    <div>
      <p className="story-label">{title}</p>
      <div className="news-desk-chip-row">
        {user.identities.length ? user.identities.map((identity) => (
          <span key={identity.id}>{identity.email ?? identity.cognitoSub} ({identity.status})</span>
        )) : <span>{fallback}</span>}
      </div>
    </div>
  );
}

function DesksDeskView({
  assignments,
  categoryByUid,
  categoryNodes,
  disabled,
  doctrineRecords,
  graph,
  initialCategoryLineageId,
  isDemo,
  onCategorySave,
  onDeskDoctrineSave,
  rootCategories,
  statusMessage,
}: {
  assignments: AssignmentRecord[];
  categoryByUid: Map<string, CategorySteeringCategory>;
  categoryNodes: CategorySteeringCategoryTreeNode[];
  disabled: boolean;
  doctrineRecords: DoctrineRecord[];
  graph: SemanticGraph;
  initialCategoryLineageId?: string | null;
  isDemo: boolean;
  onCategorySave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) => void;
  onDeskDoctrineSave: (category: CategorySteeringCategory, kind: DoctrineKind, text: string) => void;
  rootCategories: CategorySteeringCategory[];
  statusMessage: ActionState | null;
}) {
  const roots = buildCanonicalTopicRoots(rootCategories, categoryNodes, []);
  const initialRootKey = selectInitialRootKey(roots, initialCategoryLineageId);
  const [selectedRootKey, setSelectedRootKey] = useState<string | null>(initialRootKey);
  const selectedRoot = roots.find((root) => root.category.categoryKey === selectedRootKey) ?? roots[0] ?? null;

  useEffect(() => {
    if (!roots.length) {
      setSelectedRootKey(null);
      return;
    }
    const nextRootKey = selectedRoot?.category.categoryKey ?? initialRootKey ?? roots[0].category.categoryKey;
    if (selectedRootKey !== nextRootKey) setSelectedRootKey(nextRootKey);
  }, [initialRootKey, roots, selectedRoot, selectedRootKey]);

  return (
    <div className="news-desk-columns" data-news-desk-section="desks">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="newsroom-desks-title">
          <SectionHeader title="News Desks" detail={`${roots.length} root topic desks`} />
          <div className="news-desk-desk-list">
            {roots.length ? roots.map((root) => {
              const rootNode = root.node ?? categoryToCategoryTreeNode(root.category);
              const rootContext = buildTopicDrilldownContext(root, rootNode, categoryByUid);
              const referenceCount = referencesForCategoryContext(graph, rootContext).length;
              const assignmentCount = countAssignmentsForDesk(assignments, graph, rootNode, root.subcategorys);
              const doctrineStatus = deskDoctrineStatus(root.category, doctrineRecords);
              const selected = selectedRoot?.category.categoryKey === root.category.categoryKey;
              return (
                <Link
                  className="news-desk-desk-card"
                  data-news-desk-card={root.category.categoryKey}
                  data-selected={selected || undefined}
                  href={getNewsDeskTabHref(`/newsroom/desks/${encodeURIComponent(root.category.categoryKey)}`, isDemo)}
                  key={root.category.categoryKey}
                  onClick={() => setSelectedRootKey(root.category.categoryKey)}
                >
                  <span>{rootNode.shortTitle ?? deriveShortTitle(rootNode.displayName)}</span>
                  <strong>{rootNode.displayName}</strong>
                  <p>{rootNode.description ?? "No desk description yet."}</p>
                  <small>{referenceCount} refs / {assignmentCount} assignments / {root.subcategorys.length} subtopics / {doctrineStatus.savedCount} of 2 doctrine slots</small>
                </Link>
              );
            }) : <EmptyRow label="No root topic desks are available in the canonical category set" />}
          </div>
        </section>

        {selectedRoot ? (
          <DeskDetailPanel
            assignments={assignments}
            categoryByUid={categoryByUid}
            disabled={disabled}
            doctrineRecords={doctrineRecords}
            graph={graph}
            onCategorySave={onCategorySave}
            onDeskDoctrineSave={onDeskDoctrineSave}
            root={selectedRoot}
            statusMessage={statusMessage}
          />
        ) : null}
      </div>

      <aside className="news-desk-rail-column">
        <section className="category-steering-section" aria-labelledby="desk-index-notes-title">
          <SectionHeader title="Desk Rules" detail="Root topics only" />
          <div className="news-desk-ledger-list">
            <article className="news-desk-ledger-item">
              <header>
                <strong>Desk Identity</strong>
                <span>Category</span>
              </header>
              <p>Official name, short title, subtitle, and description stay on the accepted root Category record.</p>
            </article>
            <article className="news-desk-ledger-item">
              <header>
                <strong>Desk Doctrine</strong>
                <span>Private Item</span>
              </header>
              <p>Mission and policies are private doctrine Items tied to the root category lineage.</p>
            </article>
            <article className="news-desk-ledger-item">
              <header>
                <strong>Subtopics</strong>
                <span>Inherited</span>
              </header>
              <p>Child topics inherit the root desk doctrine in v1.</p>
            </article>
          </div>
        </section>
      </aside>
    </div>
  );
}

function DeskDetailPanel({
  assignments,
  categoryByUid,
  disabled,
  doctrineRecords,
  graph,
  onCategorySave,
  onDeskDoctrineSave,
  root,
  statusMessage,
}: {
  assignments: AssignmentRecord[];
  categoryByUid: Map<string, CategorySteeringCategory>;
  disabled: boolean;
  doctrineRecords: DoctrineRecord[];
  graph: SemanticGraph;
  onCategorySave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) => void;
  onDeskDoctrineSave: (category: CategorySteeringCategory, kind: DoctrineKind, text: string) => void;
  root: CanonicalTopicRoot;
  statusMessage: ActionState | null;
}) {
  const rootNode = root.node ?? categoryToCategoryTreeNode(root.category);
  const rootContext = buildTopicDrilldownContext(root, rootNode, categoryByUid);
  const referenceCount = referencesForCategoryContext(graph, rootContext).length;
  const assignmentCount = countAssignmentsForDesk(assignments, graph, rootNode, root.subcategorys);
  const doctrineStatus = deskDoctrineStatus(root.category, doctrineRecords);

  return (
    <section className="category-steering-section news-desk-desk-detail" aria-labelledby="selected-desk-title">
      <header className="news-desk-topic-detail__header">
        <div>
          <p className="story-label">News Desk</p>
          <h3 id="selected-desk-title">{rootNode.displayName}</h3>
          <span>{rootNode.shortTitle ?? deriveShortTitle(rootNode.displayName)}</span>
        </div>
        <dl>
          <div>
            <dt>References</dt>
            <dd>{referenceCount}</dd>
          </div>
          <div>
            <dt>Assignments</dt>
            <dd>{assignmentCount}</dd>
          </div>
          <div>
            <dt>Subtopics</dt>
            <dd>{root.subcategorys.length}</dd>
          </div>
          <div>
            <dt>Doctrine</dt>
            <dd>{doctrineStatus.savedCount}/2</dd>
          </div>
        </dl>
      </header>

      <div className="news-desk-desk-detail__grid">
        <CategoryEditor category={root.category} disabled={disabled} onSave={onCategorySave} />
        <div className="news-desk-doctrine-list">
          {(["mission", "policy"] as DoctrineKind[]).map((kind) => {
            const definition = buildDeskDoctrineDefinition(root.category, kind);
            const record = doctrineRecords.find((entry) => entry.slug === definition.slug) ?? null;
            return (
              <DeskDoctrineEditorCard
                key={definition.slug}
                category={root.category}
                definition={definition}
                disabled={disabled}
                record={record}
                statusMessage={statusMessage?.id === definition.slug ? statusMessage : null}
                onSave={onDeskDoctrineSave}
              />
            );
          })}
        </div>
      </div>

      <div className="news-desk-desk-subtopics" aria-label={`${rootNode.displayName} inherited subtopics`}>
        <p className="category-steering-subcategory-list__label">Inherited Subtopics</p>
        <div className="news-desk-chip-row">
          {root.subcategorys.length ? root.subcategorys.map((subcategory) => (
            <span key={subcategory.id}>{subcategory.shortTitle ?? deriveShortTitle(subcategory.displayName)}</span>
          )) : <span>No accepted child topics</span>}
        </div>
      </div>
    </section>
  );
}

function DeskDoctrineEditorCard({
  category,
  definition,
  disabled,
  record,
  statusMessage,
  onSave,
}: {
  category: CategorySteeringCategory;
  definition: { kind: DoctrineKind; label: string; slug: string };
  disabled: boolean;
  record: DoctrineRecord | null;
  statusMessage: ActionState | null;
  onSave: (category: CategorySteeringCategory, kind: DoctrineKind, text: string) => void;
}) {
  const [body, setBody] = useState(() => doctrineBodyToText(record?.body));
  const paragraphCount = doctrineTextToBody(body).length;

  useEffect(() => {
    setBody(doctrineBodyToText(record?.body));
  }, [definition.slug, record?.id, record?.updatedAt, record?.body]);

  return (
    <article className="news-desk-doctrine-card" data-news-desk-doctrine={definition.slug}>
      <header className="news-desk-doctrine-card__header">
        <div>
          <p className="story-label">Desk Doctrine</p>
          <h3>{definition.label}</h3>
        </div>
        <span>{record ? "Saved record" : "Empty slot"}</span>
      </header>
      <label className="news-desk-doctrine-card__field">
        <span>{definition.label}</span>
        <textarea
          data-news-desk-doctrine-input={definition.slug}
          disabled={disabled}
          onChange={(event) => setBody(event.target.value)}
          placeholder={`Enter the ${category.displayName} ${definition.label.toLowerCase()}.`}
          value={body}
        />
      </label>
      <div className="news-desk-doctrine-card__footer">
        <span>{paragraphCount} paragraph{paragraphCount === 1 ? "" : "s"}</span>
        <div className="news-desk-doctrine-card__actions">
          {statusMessage ? <span data-tone={statusMessage.tone}>{statusMessage.message}</span> : null}
          <button
            type="button"
            data-news-desk-doctrine-save={definition.slug}
            disabled={disabled}
            onClick={() => onSave(category, definition.kind, body)}
          >
            Save
          </button>
        </div>
      </div>
    </article>
  );
}

function TopicsDeskView({
  activeCategorySet,
  activeCategoryTree,
  artifacts,
  canonicalCategorys,
  categoryByUid,
  categoryKeywords,
  categoryProposals,
  categoryTreeLoadError,
  categoryNodes,
  categorySets,
  corpora,
  disabled,
  genericProposals,
  graph,
  importRuns,
  initialCategoryLineageId,
  messages,
  lexicalSteeringRules,
  onCategorySave,
  onLexicalRuleCreate,
  onProposalAction,
  proposals,
  referenceAttachments,
  references,
  semanticRelations,
}: {
  activeCategorySet: CategorySteeringCategorySet | null;
  activeCategoryTree: CategorySteeringCategoryTree | null;
  artifacts: CategorySteeringArtifact[];
  canonicalCategorys: CategorySteeringCategory[];
  categoryByUid: Map<string, CategorySteeringCategory>;
  categoryKeywords: CategoryKeywordRecord[];
  categoryProposals: CategorySteeringProposal[];
  categoryTreeLoadError: string | null;
  categoryNodes: CategorySteeringCategoryTreeNode[];
  categorySets: CategorySteeringCategorySet[];
  corpora: CategorySteeringCorpus[];
  disabled: boolean;
  genericProposals: CategorySteeringProposal[];
  graph: SemanticGraph;
  importRuns: CategorySteeringImportRun[];
  initialCategoryLineageId?: string | null;
  messages: MessageRecord[];
  lexicalSteeringRules: LexicalSteeringRuleRecord[];
  onCategorySave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) => void;
  onLexicalRuleCreate: (draft: LexicalRuleDraft) => void;
  onProposalAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
  proposals: CategorySteeringProposal[];
  referenceAttachments: ReferenceAttachmentRecord[];
  references: ReferenceRecord[];
  semanticRelations: SemanticRelationRecord[];
}) {
  return (
    <div className="news-desk-columns" data-news-desk-section="topics">
      <div className="news-desk-main-column">
        <AcceptedCategoryTreeSection
          activeCategoryTree={activeCategoryTree}
          canonicalCategorys={canonicalCategorys}
          categoryByUid={categoryByUid}
          categoryKeywords={categoryKeywords}
          disabled={disabled}
          graph={graph}
          initialCategoryLineageId={initialCategoryLineageId}
          onAction={onProposalAction}
          onCategorySave={onCategorySave}
          onLexicalRuleCreate={onLexicalRuleCreate}
          proposals={proposals}
          lexicalSteeringRules={lexicalSteeringRules}
          categoryTreeLoadError={categoryTreeLoadError}
          categoryNodes={categoryNodes}
        />

        <section className="category-steering-section" aria-labelledby="category-proposals-title">
          <SectionHeader title="All Category Proposal Notes" detail={`${categoryProposals.length} tailored notes`} />
          <div className="category-steering-proposal-list">
            {categoryProposals.length ? categoryProposals.map((proposal) => (
              <CategoryProposalRow
                key={proposal.id}
                proposal={proposal}
                category={proposal.categoryKey ? categoryByUid.get(proposal.categoryKey) : undefined}
                disabled={disabled}
                onAction={onProposalAction}
              />
            )) : <EmptyRow label="No category proposals" />}
          </div>
        </section>

        <GenericProposalQueue proposals={genericProposals} disabled={disabled} onAction={onProposalAction} />
      </div>

      <aside className="news-desk-rail-column">
        <CorpusCategorySetSummary
          corpora={corpora}
          categorySets={categorySets}
          importRuns={importRuns}
          canonicalCategorySetId={activeCategorySet?.id ?? null}
        />

        <CategorySetPanel
          categorySet={activeCategorySet}
          artifacts={artifacts}
          references={references}
          referenceAttachments={referenceAttachments}
          messages={messages}
          semanticRelations={semanticRelations}
        />
      </aside>
    </div>
  );
}

function ConceptsDeskView({
  categories,
  graph,
  initialCategoryLineageId,
  initialNodeLineageId,
  semanticNodes,
}: {
  categories: CategorySteeringCategory[];
  graph: SemanticGraph;
  initialCategoryLineageId?: string | null;
  initialNodeLineageId?: string | null;
  semanticNodes: SemanticNodeRecord[];
}) {
  const categoryContext = useMemo(() => buildCategoryDrilldownContext(categories, initialCategoryLineageId), [categories, initialCategoryLineageId]);
  const categoryFilter = categoryContext.primary ? graph.resolve("category", categoryLineageId(categoryContext.primary)) : null;
  const categoryConceptLineages = useMemo(() => (
    categoryContext.primary
      ? new Set(semanticNodesForCategoryContext(graph, categoryContext).map((node) => node.lineageId))
      : null
  ), [categoryContext, graph]);
  const visibleNodes = useMemo(() => (
    categoryConceptLineages
      ? semanticNodes.filter((node) => categoryConceptLineages.has(node.lineageId ?? node.id))
      : semanticNodes
  ), [categoryConceptLineages, semanticNodes]);
  const selected = selectSemanticNodeSummary(graph, visibleNodes, initialNodeLineageId) ?? categoryFilter;
  const detail = categoryFilter
    ? `${visibleNodes.length} graph nodes associated with ${categoryFilter.label}`
    : `${visibleNodes.length} graph nodes`;
  return (
    <div className="news-desk-columns" data-news-desk-section="concepts">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="semantic-concepts-title">
          <SectionHeader title="Semantic Concepts" detail={detail} />
          <div className="news-desk-object-list">
            {visibleNodes.length ? visibleNodes.map((node) => {
              const lineageId = node.lineageId ?? node.id;
              return (
                <a
                  className={`news-desk-object-row${selected?.lineageId === lineageId ? " news-desk-object-row--active" : ""}`}
                  data-semantic-node={lineageId}
                  href={newsDeskHrefForSemanticObject("semanticNode", lineageId)}
                  key={node.id}
                >
                  <strong>{node.displayName ?? node.nodeKey}</strong>
                  <span>{node.nodeKind} / {node.status}</span>
                </a>
              );
            }) : <EmptyRow label="No semantic nodes imported" />}
          </div>
        </section>
      </div>
      <aside className="news-desk-rail-column">
        <SemanticDetailPanel graph={graph} selected={selected} />
      </aside>
    </div>
  );
}

function ReferencesDeskView({
  categories,
  disabled,
  graph,
  initialCategoryLineageId,
  initialReferenceLineageId,
  onReview,
  references,
}: {
  categories: CategorySteeringCategory[];
  disabled: boolean;
  graph: SemanticGraph;
  initialCategoryLineageId?: string | null;
  initialReferenceLineageId?: string | null;
  onReview: (reference: ReferenceRecord, action: ReferenceCurationAction, note?: string) => void;
  references: ReferenceRecord[];
}) {
  const categoryContext = useMemo(() => buildCategoryDrilldownContext(categories, initialCategoryLineageId), [categories, initialCategoryLineageId]);
  const categoryFilter = categoryContext.primary ? graph.resolve("category", categoryLineageId(categoryContext.primary)) : null;
  const categoryReferenceLineages = useMemo(() => (
    categoryContext.primary
      ? new Set(referencesForCategoryContext(graph, categoryContext).map((reference) => reference.lineageId))
      : null
  ), [categoryContext, graph]);
  const visibleReferences = useMemo(() => (
    categoryReferenceLineages
      ? references.filter((reference) => categoryReferenceLineages.has(reference.lineageId ?? reference.id))
      : references
  ), [categoryReferenceLineages, references]);
  const selected = selectReferenceSummary(graph, visibleReferences, initialReferenceLineageId) ?? categoryFilter;
  const selectedReferenceLineageId = selected?.kind === "reference" ? selected.lineageId : null;
  const detail = categoryFilter
    ? `${visibleReferences.length} references classified as ${categoryFilter.label}`
    : `${visibleReferences.length} private corpus items`;
  return (
    <div className="news-desk-columns" data-news-desk-section="references">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="reference-ledger-title">
          <SectionHeader title="Reference Ledger" detail={detail} />
          <ReferenceLedger references={visibleReferences} selectedLineageId={selectedReferenceLineageId} />
        </section>
      </div>
      <aside className="news-desk-rail-column">
        <SemanticDetailPanel disabled={disabled} graph={graph} onReferenceReview={onReview} selected={selected} />
      </aside>
    </div>
  );
}

function MessagesDeskView({
  graph,
  initialMessageId,
  messages,
}: {
  graph: SemanticGraph;
  initialMessageId?: string | null;
  messages: MessageRecord[];
}) {
  const [kindFilter, setKindFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const messageKinds = useMemo(() => uniqueStrings(messages.map((message) => message.messageKind)), [messages]);
  const messageDomains = useMemo(() => uniqueStrings(messages.map((message) => message.messageDomain)), [messages]);
  const visibleMessages = useMemo(() => messages
    .filter((message) => !kindFilter || message.messageKind === kindFilter)
    .filter((message) => !domainFilter || message.messageDomain === domainFilter)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [domainFilter, kindFilter, messages]);
  const selected = initialMessageId
    ? graph.resolve("message", initialMessageId)
    : visibleMessages[0]
      ? graph.resolve("message", visibleMessages[0].id)
      : null;
  return (
    <div className="news-desk-columns" data-news-desk-section="messages">
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="messages-title">
          <SectionHeader title="Message Wire" detail={`${visibleMessages.length} private messages`} />
          <div className="news-desk-reference-controls">
            <label>
              <span>Kind</span>
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                <option value="">All kinds</option>
                {messageKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label>
              <span>Domain</span>
              <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}>
                <option value="">All domains</option>
                {messageDomains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
              </select>
            </label>
          </div>
          <div className="news-desk-object-list">
            {visibleMessages.length ? visibleMessages.slice(0, 100).map((message) => (
              <a
                className={`news-desk-object-row${selected?.id === message.id ? " news-desk-object-row--active" : ""}`}
                data-message-id={message.id}
                href={newsDeskHrefForSemanticObject("message", message.id)}
                key={message.id}
              >
                <strong>{message.summary ?? message.body}</strong>
                <span>{message.messageKind} / {message.messageDomain} / {formatDateTime(message.createdAt)}</span>
              </a>
            )) : <EmptyRow label="No private messages recorded" />}
          </div>
        </section>
      </div>
      <aside className="news-desk-rail-column">
        <SemanticDetailPanel graph={graph} selected={selected} />
      </aside>
    </div>
  );
}

function ReferenceLedger({ references, selectedLineageId }: { references: ReferenceRecord[]; selectedLineageId?: string | null }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const sortedReferences = useMemo(() => sortReferencesByRecency(references), [references]);
  const filteredReferences = useMemo(() => (
    sortedReferences
      .filter((reference) => !statusFilter || (reference.curationStatus ?? "pending") === statusFilter)
      .filter((reference) => !normalizedQuery || referenceMatchesQuery(reference, normalizedQuery))
  ), [normalizedQuery, sortedReferences, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredReferences.length / REFERENCE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleReferences = filteredReferences.slice(currentPage * REFERENCE_PAGE_SIZE, (currentPage + 1) * REFERENCE_PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [normalizedQuery, references, statusFilter]);

  return (
    <>
      <ReferenceListControls
        label={`${filteredReferences.length} of ${references.length} references`}
        onNext={() => setPage((value) => Math.min(value + 1, pageCount - 1))}
        onPrevious={() => setPage((value) => Math.max(value - 1, 0))}
        onQueryChange={setQuery}
        onStatusChange={setStatusFilter}
        page={currentPage}
        pageCount={pageCount}
        query={query}
        status={statusFilter}
      />
      <div className="news-desk-object-list" data-news-desk-reference-ledger>
        {visibleReferences.length ? visibleReferences.map((reference) => {
          const lineageId = reference.lineageId ?? reference.id;
          return (
            <ReferenceRow
              active={selectedLineageId === lineageId}
              key={reference.id}
              reference={reference}
            />
          );
        }) : <EmptyRow label={references.length ? "No references match this search" : "No private references imported"} />}
      </div>
    </>
  );
}

function SemanticDetailPanel({
  disabled = false,
  graph,
  onReferenceReview,
  selected,
}: {
  disabled?: boolean;
  graph: SemanticGraph;
  onReferenceReview?: (reference: ReferenceRecord, action: ReferenceCurationAction, note?: string) => void;
  selected: SemanticObjectSummary | null;
}) {
  if (!selected) {
    return (
      <section className="category-steering-section" aria-labelledby="semantic-detail-title">
        <SectionHeader title="Semantic Detail" detail="No object selected" />
        <EmptyRow label="Select a reference, topic, concept, item, or message" />
      </section>
    );
  }

  const messages = graph.messagesFor(selected.kind, selected.lineageId);
  const attachments = selected.kind === "reference" ? graph.attachmentsForReference(selected.lineageId) : [];
  const neighborGroups = graph.neighbors(selected.kind, selected.lineageId);
  const selectedReference = selected.kind === "reference" ? selected.record as ReferenceRecord : null;

  return (
    <section className="category-steering-section" aria-labelledby="semantic-detail-title" data-news-desk-semantic-detail={selected.lineageId}>
      <SectionHeader title="Semantic Detail" detail={`${selected.kind} / v${selected.versionNumber ?? "?"}`} />
      <article className="news-desk-semantic-detail">
        <header>
          <strong>{selected.label}</strong>
          <span>{selected.subtitle ?? selected.lineageId}</span>
        </header>
        {attachments.length ? (
          <div className="news-desk-detail-block">
            <p className="story-label">Attachments</p>
            {attachments.map((attachment) => (
              <div className="news-desk-detail-line" key={attachment.id}>
                <span>{attachment.role}</span>
                <strong>{attachment.storagePath ?? attachment.sourceUri ?? attachment.filename ?? "unmapped file"}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {selectedReference && onReferenceReview ? (
          <ReferenceCurationPanel disabled={disabled} reference={selectedReference} onReview={onReferenceReview} />
        ) : null}
        {messages.length ? (
          <div className="news-desk-detail-block">
            <p className="story-label">Messages</p>
            {messages.slice(0, 4).map((message) => (
              <div className="news-desk-detail-line" key={message.id}>
                <span>{message.messageKind}</span>
                <strong>{message.body}</strong>
              </div>
            ))}
          </div>
        ) : null}
        <NeighborGroups groups={neighborGroups} />
      </article>
    </section>
  );
}

function ReferenceCurationPanel({
  disabled,
  onReview,
  reference,
}: {
  disabled: boolean;
  onReview: (reference: ReferenceRecord, action: ReferenceCurationAction, note?: string) => void;
  reference: ReferenceRecord;
}) {
  const [note, setNote] = useState("");
  const status = reference.curationStatus ?? "pending";
  const submit = (action: ReferenceCurationAction) => {
    onReview(reference, action, note);
    setNote("");
  };
  return (
    <div className="news-desk-detail-block" data-reference-curation-status={status}>
      <p className="story-label">Reference Curation</p>
      <div className="news-desk-detail-line">
        <span>Status</span>
        <strong>{status}</strong>
      </div>
      {reference.curationStatusReason ? (
        <div className="news-desk-detail-line">
          <span>Reason</span>
          <strong>{reference.curationStatusReason}</strong>
        </div>
      ) : null}
      <label className="news-desk-reference-curation-note">
        <span>Message</span>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional curation note"
        />
      </label>
      <div className="news-desk-assignment-row__button-row">
        <button type="button" disabled={disabled || status === "accepted"} onClick={() => submit("accept")}>Accept</button>
        <button type="button" disabled={disabled || status === "rejected"} onClick={() => submit("reject")}>Reject</button>
        <button type="button" disabled={disabled || status === "pending"} onClick={() => submit("reopen")}>Reopen</button>
        <button type="button" disabled={disabled || status === "archived"} onClick={() => submit("archive")}>Archive</button>
      </div>
    </div>
  );
}

function NeighborGroups({ groups }: { groups: SemanticNeighborGroup[] }) {
  return (
    <div className="news-desk-detail-block" data-news-desk-neighbors>
      <p className="story-label">Semantic Neighbors</p>
      {groups.length ? groups.map((group) => (
        <div className="news-desk-neighbor-group" key={`${group.direction}-${group.predicate}`}>
          <header>
            <strong>{group.label}</strong>
            <span>{group.direction} / {group.relations.length}</span>
          </header>
          {group.objects.map((object) => (
            <a href={object.href} key={`${group.direction}-${group.predicate}-${object.kind}-${object.lineageId}`}>
              <span>{object.kind}</span>
              <strong>{object.label}</strong>
            </a>
          ))}
        </div>
      )) : <EmptyRow label="No current semantic relations for this object" />}
    </div>
  );
}

function DeskLinkCard({ href, label, value, detail }: { href: string; label: string; value: number; detail: string }) {
  return (
    <Link className="news-desk-ledger-item news-desk-ledger-item--link" href={href}>
      <header>
        <strong>{label}</strong>
        <span>{value}</span>
      </header>
      <p>{detail}</p>
    </Link>
  );
}

function AssignmentDeskView({
  assignments,
  assignmentEvents,
  graph,
  disabled,
  onAction,
}: {
  assignments: AssignmentRecord[];
  assignmentEvents: AssignmentEventRecord[];
  graph: SemanticGraph;
  disabled: boolean;
  onAction: (assignment: AssignmentRecord, action: AssignmentAction, note?: string) => void;
}) {
  const sections = getAssignmentSections(assignments);
  const metrics = getAssignmentMetrics(assignments);

  return (
    <div className="news-desk-columns news-desk-columns--assignments" data-news-desk-assignments>
      <div className="news-desk-main-column">
        <section className="category-steering-section category-steering-section--lead" aria-labelledby="assignment-candidates-title">
          <SectionHeader title="Assignment Queue" detail={`${metrics.open} open / ${metrics.claimed} claimed / ${metrics.completed} completed`} />
          <div className="news-desk-assignment-section-list">
            {sections.length ? sections.map((section) => (
              <AssignmentSection key={section.name} graph={graph} section={section} disabled={disabled} onAction={onAction} />
            )) : <EmptyRow label="No assignments found" />}
          </div>
        </section>
      </div>

      <aside className="news-desk-rail-column">
        <section className="category-steering-section" aria-labelledby="assignment-edition-ledger-title">
          <SectionHeader title="Queue Ledger" detail={`${assignments.length} work items`} />
          <div className="news-desk-ledger-list">
            <article className="news-desk-ledger-item">
              <header>
                <strong>Universal Assignments</strong>
                <span>Semantic work queue</span>
              </header>
              <dl>
                <div>
                  <dt>Open</dt>
                  <dd>{metrics.open}</dd>
                </div>
                <div>
                  <dt>Claimed</dt>
                  <dd>{metrics.claimed}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{metrics.completed}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{assignmentEvents.length}</dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section className="category-steering-section" aria-labelledby="assignment-section-ledger-title">
          <SectionHeader title="Type Ledger" detail={`${sections.length} queues`} />
          <div className="news-desk-ledger-list">
            {sections.length ? sections.map((section) => {
              const sectionMetrics = getAssignmentMetrics(section.assignments);
              return (
                <article className="news-desk-ledger-item" key={section.name}>
                  <header>
                    <strong>{section.name}</strong>
                    <span>{sectionMetrics.total} assignments</span>
                  </header>
                  <dl>
                    <div>
                      <dt>Open</dt>
                      <dd>{sectionMetrics.open}</dd>
                    </div>
                    <div>
                      <dt>Claimed</dt>
                      <dd>{sectionMetrics.claimed}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{sectionMetrics.completed}</dd>
                    </div>
                    <div>
                      <dt>Canceled</dt>
                      <dd>{sectionMetrics.canceled}</dd>
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
  graph,
  section,
  disabled,
  onAction,
}: {
  graph: SemanticGraph;
  section: AssignmentSectionGroup;
  disabled: boolean;
  onAction: (assignment: AssignmentRecord, action: AssignmentAction, note?: string) => void;
}) {
  const metrics = getAssignmentMetrics(section.assignments);

  return (
    <section className="news-desk-assignment-section" aria-label={`${section.name} assignments`}>
      <header className="news-desk-assignment-section__header">
        <div>
          <p className="story-label">{section.name}</p>
          <h3>{section.name}</h3>
        </div>
        <span>{metrics.open} open / {metrics.claimed} claimed / {metrics.completed} completed / {metrics.canceled} canceled</span>
      </header>
      <div className="news-desk-assignment-list">
        {section.assignments.map((assignment) => (
          <AssignmentRow
            key={assignment.id}
            assignment={assignment}
            disabled={disabled}
            graph={graph}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function AssignmentRow({
  assignment,
  disabled,
  graph,
  onAction,
}: {
  assignment: AssignmentRecord;
  disabled: boolean;
  graph: SemanticGraph;
  onAction: (assignment: AssignmentRecord, action: AssignmentAction, note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const targets = graph.outgoing("assignment", assignment.id)
    .filter((relation) => relation.predicate === "requests_work_on")
    .map((relation) => graph.resolveRelationObject(relation, "outgoing"))
    .filter((target): target is SemanticObjectSummary => Boolean(target));
  const context = assignmentContextMetadata(assignment);
  const terminal = assignment.status === "completed" || assignment.status === "canceled";

  useEffect(() => {
    setNote("");
  }, [assignment.id, assignment.status]);

  return (
    <article
      className={`news-desk-assignment-row${terminal ? " news-desk-assignment-row--terminal" : ""}`}
      data-assignment-candidate={assignment.id}
      data-assignment-id={assignment.id}
      data-assignment-status={assignment.status}
    >
      <div className="news-desk-assignment-row__main">
        <header className="news-desk-assignment-row__title">
          <div>
            <StatusPill status={assignment.status} />
            <h4>{assignment.title}</h4>
          </div>
          <span>{assignment.assignmentTypeKey}</span>
        </header>
        <p>{assignment.brief ?? "No assignment brief filed."}</p>
        {context ? (
          <>
            <p className="news-desk-assignment-row__angle">
              <span>{context.deskTitle ?? context.deskKey ?? "Desk"}</span>
              {`${context.focusTitle ?? context.focusKey ?? "focus"} / ${context.targetSystemType ?? context.contextProfile ?? "context"}`}
            </p>
            {context.contextProfile || context.contextTokenBudget ? (
              <p className="news-desk-assignment-row__angle">
                <span>Context</span>
                {[context.contextProfile, context.contextTokenBudget ? `${context.contextTokenBudget} tokens` : null].filter(Boolean).join(" / ")}
              </p>
            ) : null}
            {context.expectedEvidenceClasses.length ? (
              <p className="news-desk-assignment-row__angle">
                <span>Evidence</span>
                {context.expectedEvidenceClasses.slice(0, 2).join(" / ")}
              </p>
            ) : null}
            {context.comparisonQuestions.length ? (
              <p className="news-desk-assignment-row__angle">
                <span>Compare</span>
                {context.comparisonQuestions.slice(0, 2).join(" / ")}
              </p>
            ) : null}
          </>
        ) : null}
        {assignment.instructions ? (
          <p className="news-desk-assignment-row__angle">
            <span>Instructions</span>
            {assignment.instructions}
          </p>
        ) : null}
        <div className="news-desk-assignment-row__meta">
          <span>{assignment.queueKey}</span>
          <span>{assignment.assigneeKey ?? "unassigned"}</span>
          <span>{targets.length ? targets.map((target) => target.label).join(" / ") : "no linked targets"}</span>
        </div>
      </div>
      <div className="news-desk-assignment-row__actions">
        <label>
          <span>Note</span>
          <textarea
            data-assignment-reason={assignment.id}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="news-desk-assignment-row__button-row">
          {assignment.status === "open" ? (
            <button type="button" data-assignment-action="claim" disabled={disabled} onClick={() => onAction(assignment, "claim", note)}>Claim</button>
          ) : null}
          {assignment.status === "claimed" ? (
            <button type="button" data-assignment-action="release" disabled={disabled} onClick={() => onAction(assignment, "release", note)}>Release</button>
          ) : null}
          {!terminal ? (
            <>
              <button type="button" data-assignment-action="complete" disabled={disabled} onClick={() => onAction(assignment, "complete", note)}>Complete</button>
              <button type="button" data-assignment-action="cancel" disabled={disabled} onClick={() => onAction(assignment, "cancel", note)}>Cancel</button>
            </>
          ) : (
            <button type="button" data-assignment-action="reopen" disabled={disabled} onClick={() => onAction(assignment, "reopen", note)}>Reopen</button>
          )}
        </div>
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

function formatDeskSectionLabel(section: NewsDeskTab): string {
  if (section === "users") return "Users Desk";
  if (section === "desks") return "Desks Desk";
  if (section === "topics") return "Topics Desk";
  if (section === "concepts") return "Concepts Desk";
  if (section === "references") return "References Desk";
  if (section === "messages") return "Messages Desk";
  if (section === "assignments") return "Assignments Desk";
  if (section === "doctrine") return "Doctrine Desk";
  return "Knowledge Desk";
}

function formatDeskSectionHeadline(section: NewsDeskTab): string {
  if (section === "users") return "Profiles Carry The Human, Identities Carry The Login";
  if (section === "desks") return "News Desks Carry Section Identity And Doctrine";
  if (section === "topics") return "Taxonomy Steering Stays Beside The Corpus";
  if (section === "concepts") return "Semantic Concepts Connect The Knowledge Graph";
  if (section === "references") return "Reference Metadata Leads To Private Corpus Files";
  if (section === "messages") return "Messages Preserve Editorial Commentary";
  if (section === "assignments") return "Assignment Operations Stay Ready For The Reporting Queue";
  if (section === "doctrine") return "Editorial Doctrine Should Stay Explicit Inside The Newsroom";
  return "The Desk Opens On The Whole Knowledge Wire";
}

function formatDeskSectionLede(section: NewsDeskTab): string {
  if (section === "users") return "Admins can map more than one Cognito identity to one Papyrus profile and mirror newsroom roles across those identities.";
  if (section === "desks") return "Each accepted root topic becomes a newsroom desk with category identity fields and two private doctrine slots for mission and policies.";
  if (section === "topics") return "Editors can inspect accepted topics, subtopics, open steering proposals, and the taxonomy artifacts imported from Biblicus.";
  if (section === "concepts") return "Graph concepts are private semantic nodes. Use them to surf from ontology terms to references, topics, messages, and Papyrus items.";
  if (section === "references") return "References store strict metadata and attachment paths only. Source contents stay in S3 and corpus storage.";
  if (section === "messages") return "Messages are private editorial commentary linked to references, topics, assignments, and other newsroom objects through typed relations.";
  if (section === "assignments") return "This section keeps the assignment desk visible while taxonomy and ontology monitoring take priority.";
  if (section === "doctrine") return "Editors can keep the publication's mission and policy in two fixed private doctrine slots without pushing them into reader-facing content.";
  return "Use the left sections to move between users, topics, semantic concepts, references, doctrine, and downstream newsroom work.";
}

function selectReferenceSummary(graph: SemanticGraph, references: ReferenceRecord[], lineageId?: string | null): SemanticObjectSummary | null {
  const selected = lineageId ? graph.resolve("reference", lineageId) : null;
  if (selected) return selected;
  const first = references[0];
  return first ? graph.resolve("reference", first.lineageId ?? first.id) : null;
}

function selectSemanticNodeSummary(graph: SemanticGraph, nodes: SemanticNodeRecord[], lineageId?: string | null): SemanticObjectSummary | null {
  const selected = lineageId ? graph.resolve("semanticNode", lineageId) : null;
  if (selected) return selected;
  const first = nodes[0];
  return first ? graph.resolve("semanticNode", first.lineageId ?? first.id) : null;
}

type AssignmentSectionGroup = {
  name: string;
  assignments: AssignmentRecord[];
};

type AssignmentMetrics = {
  total: number;
  open: number;
  claimed: number;
  completed: number;
  canceled: number;
};

function getAssignmentSections(assignments: AssignmentRecord[]): AssignmentSectionGroup[] {
  const sectionByName = new Map<string, AssignmentRecord[]>();
  for (const assignment of assignments) {
    const section = assignment.queueKey?.trim() || assignment.assignmentTypeKey || "Assignments";
    const entries = sectionByName.get(section) ?? [];
    entries.push(assignment);
    sectionByName.set(section, entries);
  }
  return Array.from(sectionByName.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => ({
      name,
      assignments: entries.sort(compareAssignments),
    }));
}

function getAssignmentMetrics(assignments: AssignmentRecord[]): AssignmentMetrics {
  return {
    total: assignments.length,
    open: assignments.filter((assignment) => assignment.status === "open").length,
    claimed: assignments.filter((assignment) => assignment.status === "claimed").length,
    completed: assignments.filter((assignment) => assignment.status === "completed").length,
    canceled: assignments.filter((assignment) => assignment.status === "canceled").length,
  };
}

function compareAssignments(left: AssignmentRecord, right: AssignmentRecord): number {
  const leftStatus = assignmentStatusRank(left.status);
  const rightStatus = assignmentStatusRank(right.status);
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;
  const priorityDiff = (left.priority ?? 999999) - (right.priority ?? 999999);
  if (priorityDiff !== 0) return priorityDiff;
  return left.createdAt.localeCompare(right.createdAt);
}

function assignmentStatusRank(status: string): number {
  if (status === "open") return 0;
  if (status === "claimed") return 1;
  if (status === "completed") return 6;
  if (status === "canceled") return 8;
  return 5;
}

function applyAssignmentActionLocally(assignment: AssignmentRecord, action: AssignmentAction, now: string): AssignmentRecord {
  const status = action === "claim"
    ? "claimed"
    : action === "release" || action === "reopen"
      ? "open"
      : action === "complete"
        ? "completed"
        : action === "cancel"
          ? "canceled"
          : assignment.status;
  return {
    ...assignment,
    status,
    queueStatusKey: `${assignment.queueKey}#${status}`,
    claimedAt: action === "claim" ? now : action === "release" ? null : assignment.claimedAt,
    completedAt: action === "complete" ? now : action === "reopen" ? null : assignment.completedAt,
    canceledAt: action === "cancel" ? now : action === "reopen" ? null : assignment.canceledAt,
    updatedAt: now,
  };
}

function demoAssignmentEvent(assignment: AssignmentRecord, action: AssignmentAction, now: string, note: string): AssignmentEventRecord {
  const next = applyAssignmentActionLocally(assignment, action, now);
  return {
    id: `assignment-event-demo-${assignment.id}-${now}`,
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    eventType: action,
    fromStatus: assignment.status,
    toStatus: next.status,
    actorLabel: "Papyrus newsroom",
    note: note.trim() || null,
    createdAt: now,
  };
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
    return claim ?? "Papyrus newsroom";
  } catch {
    return "Papyrus newsroom";
  }
}

function readTextClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function NewsDeskAccessGate({ shell }: { shell: NewsDeskShellState | null }) {
  const showRhythmOverlay = useNewsroomRhythmOverlay();
  const authState = shell?.auth ?? { status: "loading", label: "Checking sign-in" };

  return (
    <main className="site-shell news-desk-shell" data-news-desk-access={shell?.phase ?? "checkingAccess"} data-rhythm-overlay={showRhythmOverlay ? "true" : "false"}>
      <section className="scroll-edition news-desk-edition">
        <div className="paper-page paper-page--front paper-page--active">
          <article className="paper-page-content paper-page-content--front news-desk-page news-desk-page--gate" aria-labelledby="news-desk-access-title">
            <header className="masthead news-desk-masthead">
              <div className="masthead__rule" />
              <h1 id="news-desk-access-title">
                <span>NEWSROOM</span>
              </h1>
              <div className="masthead__meta" aria-label="Newsroom edition status">
                <span>Steering Section</span>
                <span>Restricted Desk</span>
                <span><ReaderAuthControl className="news-desk-auth-control" showIdentity authState={authState} /></span>
              </div>
            </header>
            <section className="news-desk-access-panel" aria-live="polite">
              <p className="story-label">Access</p>
              <h2>{formatAccessTitle(shell)}</h2>
              <p>{formatAccessDetail(shell)}</p>
              {shell?.error ? <p className="news-desk-access-panel__error">{shell.error}</p> : null}
              <p className="news-desk-access-panel__auth">Use the masthead sign-in control to enter the desk.</p>
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}

function formatAccessTitle(state: NewsDeskShellState | null): string {
  if (!state || state.phase === "checkingAccess" || state.phase === "loadingDesk") return "Checking Desk Credentials";
  if (state.phase === "forbidden") return "Editor Role Required";
  if (state.phase === "error") return "Newsroom Unavailable";
  return "Editor Sign-In Required";
}

function formatAccessDetail(state: NewsDeskShellState | null): string {
  if (!state || state.phase === "checkingAccess") return "Papyrus is checking the current browser session before loading steering state.";
  if (state.phase === "loadingDesk") return "Papyrus verified the browser session and is loading private Newsroom records.";
  if (state.phase === "forbidden") return "This account is signed in, but the Cognito session does not include the editor or admin group.";
  if (state.phase === "error") return "Papyrus could not verify this editor session or load the private Newsroom data.";
  return "Sign in with an editor or admin account to inspect category, category tree, ontology, and graph steering.";
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
              <tr><td colSpan={6}>No category tree, ontology, or graph proposals</td></tr>
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
  categoryByUid,
  categoryKeywords,
  disabled,
  graph,
  initialCategoryLineageId,
  onAction,
  onCategorySave,
  onLexicalRuleCreate,
  proposals,
  lexicalSteeringRules,
  categoryTreeLoadError,
  categoryNodes,
}: {
  activeCategoryTree: CategorySteeringCategoryTree | null;
  canonicalCategorys: CategorySteeringCategory[];
  categoryByUid: Map<string, CategorySteeringCategory>;
  categoryKeywords: CategoryKeywordRecord[];
  disabled: boolean;
  graph: SemanticGraph;
  initialCategoryLineageId?: string | null;
  onAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
  onCategorySave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) => void;
  onLexicalRuleCreate: (draft: LexicalRuleDraft) => void;
  proposals: CategorySteeringProposal[];
  lexicalSteeringRules: LexicalSteeringRuleRecord[];
  categoryTreeLoadError: string | null;
  categoryNodes: CategorySteeringCategoryTreeNode[];
}) {
  const roots = buildCanonicalTopicRoots(canonicalCategorys, categoryNodes, proposals);
  const subcategoryCount = roots.reduce((count, root) => count + root.subcategorys.length, 0);
  const proposedSubcategoryCount = roots.reduce((count, root) => count + root.proposedSubcategorys.length, 0);
  const initialRootKey = selectInitialRootKey(roots, initialCategoryLineageId);
  const [selectedRootKey, setSelectedRootKey] = useState<string | null>(initialRootKey);
  const selectedRoot = roots.find((root) => root.category.categoryKey === selectedRootKey) ?? roots[0] ?? null;
  const initialFocusKey = selectInitialFocusKey(selectedRoot, initialCategoryLineageId);
  const [focusedCategoryKey, setFocusedCategoryKey] = useState<string | null>(initialFocusKey);
  const focusedNode = selectedRoot
    ? [categoryToCategoryTreeNode(selectedRoot.category), ...(selectedRoot.node ? [selectedRoot.node] : []), ...selectedRoot.subcategorys]
      .find((node) => node.categoryKey === focusedCategoryKey)
      ?? categoryToCategoryTreeNode(selectedRoot.category)
    : null;
  const detail = activeCategoryTree
    ? `${roots.length} canonical / ${subcategoryCount} accepted subcategories / ${proposedSubcategoryCount} proposed`
    : categoryTreeLoadError
      ? "CategoryTree unavailable"
      : "Editor sign-in required";
  const editableCategory = focusedCategoryKey
    ? categoryByUid.get(focusedCategoryKey)
      ?? (selectedRoot?.category.categoryKey === focusedCategoryKey ? selectedRoot.category : undefined)
    : selectedRoot?.category;

  useEffect(() => {
    if (!roots.length) {
      setSelectedRootKey(null);
      setFocusedCategoryKey(null);
      return;
    }
    const nextRootKey = selectedRoot?.category.categoryKey ?? initialRootKey ?? roots[0].category.categoryKey;
    if (selectedRootKey !== nextRootKey) setSelectedRootKey(nextRootKey);
  }, [initialRootKey, roots, selectedRoot, selectedRootKey]);

  useEffect(() => {
    if (!selectedRoot) return;
    const validKeys = new Set([selectedRoot.category.categoryKey, ...selectedRoot.subcategorys.map((subcategory) => subcategory.categoryKey)]);
    if (!focusedCategoryKey || !validKeys.has(focusedCategoryKey)) {
      setFocusedCategoryKey(selectedRoot.category.categoryKey);
    }
  }, [focusedCategoryKey, selectedRoot]);

  return (
    <section className="category-steering-section category-steering-section--categoryTree" aria-labelledby="accepted-categoryTree-title">
      <SectionHeader title="Canonical Topics" detail={detail} />
      {categoryTreeLoadError ? (
        <div className="category-steering-alert" role="status">
          {categoryTreeLoadError}
        </div>
      ) : null}
      {!activeCategoryTree ? (
        <EmptyRow label="Accepted subcategories are visible to signed-in editors" />
      ) : (
        <div className="news-desk-topic-browser" data-news-desk-category-tree>
          <div className="news-desk-topic-browser__roots" aria-label="Canonical topic list">
            {roots.length ? roots.map((root) => {
              const rootNode = root.node ?? categoryToCategoryTreeNode(root.category);
              const relatedProposalCount = countRelatedCategoryTreeProposals(rootNode.categoryKey, root.subcategorys, proposals);
              const rootContext = buildTopicDrilldownContext(root, rootNode, categoryByUid);
              const rootReferenceCount = referencesForCategoryContext(graph, rootContext).length;
              const previewKeywords = keywordsForCategory(categoryKeywords, rootNode.categoryKey).slice(0, 4);
              const isSelected = selectedRoot?.category.categoryKey === root.category.categoryKey;
              return (
                <Link
                  aria-pressed={isSelected}
                  className="news-desk-topic-root-button"
                  data-selected={isSelected || undefined}
                  href={topicHref(rootNode.categoryKey)}
                  key={root.category.categoryKey}
	                  onClick={() => {
	                    setSelectedRootKey(root.category.categoryKey);
	                    setFocusedCategoryKey(root.category.categoryKey);
	                  }}
	                >
                  <span>{rootNode.shortTitle ?? deriveShortTitle(rootNode.displayName)}</span>
                  <strong>{rootNode.displayName}</strong>
                  <small>{rootReferenceCount} refs / {root.subcategorys.length} accepted / {root.proposedSubcategorys.length} proposed / {relatedProposalCount} notes</small>
	                  {previewKeywords.length ? (
	                    <em>{previewKeywords.map((keyword) => keyword.keyword).join(" / ")}</em>
	                  ) : null}
	                </Link>
              );
            }) : <EmptyRow label="No canonical roots available for category-tree display" />}
          </div>
          {selectedRoot ? (
            <>
              <CanonicalTopicDetail
                categoryByUid={categoryByUid}
                disabled={disabled}
                focusedCategoryKey={focusedCategoryKey}
                focusedNode={focusedNode}
                graph={graph}
                categoryKeywords={categoryKeywords}
                lexicalSteeringRules={lexicalSteeringRules}
                onAction={onAction}
                onFocusCategory={setFocusedCategoryKey}
                onLexicalRuleCreate={onLexicalRuleCreate}
                proposals={proposals}
                root={selectedRoot}
              />
              {editableCategory ? (
                <CategoryEditor category={editableCategory} disabled={disabled} onSave={onCategorySave} />
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

type CanonicalTopicRoot = {
  category: CategorySteeringCategory;
  node?: CategorySteeringCategoryTreeNode;
  subcategorys: CategorySteeringCategoryTreeNode[];
  proposedSubcategorys: CategorySteeringProposal[];
};

function buildCanonicalTopicRoots(
  canonicalCategorys: CategorySteeringCategory[],
  categoryNodes: CategorySteeringCategoryTreeNode[],
  proposals: CategorySteeringProposal[],
): CanonicalTopicRoot[] {
  return canonicalCategorys
    .filter((category) => category.status === "accepted" && !category.parentCategoryKey && category.versionState !== "superseded")
    .map((category) => {
      const node = categoryNodes.find((candidate) => (
        candidate.categoryKey === category.categoryKey
        && !candidate.parentCategoryKey
        && candidate.status === "accepted"
        && candidate.versionState !== "superseded"
      ));
      const subcategorys = categoryNodes.filter((candidate) => (
        candidate.parentCategoryKey === category.categoryKey
        && candidate.status === "accepted"
        && candidate.versionState !== "superseded"
      ));
      return {
        category,
        node,
        subcategorys,
        proposedSubcategorys: getProposedSubcategoryProposals(category.categoryKey, proposals),
      };
    });
}

function CanonicalTopicDetail({
  categoryByUid,
  categoryKeywords,
  disabled,
  focusedCategoryKey,
  focusedNode,
  graph,
  lexicalSteeringRules,
  onAction,
  onFocusCategory,
  onLexicalRuleCreate,
  proposals,
  root,
}: {
  categoryByUid: Map<string, CategorySteeringCategory>;
  categoryKeywords: CategoryKeywordRecord[];
  disabled: boolean;
  focusedCategoryKey: string | null;
  focusedNode: CategorySteeringCategoryTreeNode | null;
  graph: SemanticGraph;
  lexicalSteeringRules: LexicalSteeringRuleRecord[];
  onAction: (proposal: CategorySteeringProposal, action: ReviewAction) => void;
  onFocusCategory: (categoryKey: string) => void;
  onLexicalRuleCreate: (draft: LexicalRuleDraft) => void;
  proposals: CategorySteeringProposal[];
  root: CanonicalTopicRoot;
}) {
  const rootNode = root.node ?? categoryToCategoryTreeNode(root.category);
  const relatedProposalCount = countRelatedCategoryTreeProposals(rootNode.categoryKey, root.subcategorys, proposals);
  const rootContext = buildTopicDrilldownContext(root, rootNode, categoryByUid);
  const rootReferenceCount = referencesForCategoryContext(graph, rootContext).length;

  return (
    <article className="news-desk-topic-detail" data-news-desk-category-tree-root={rootNode.categoryKey}>
      <header className="news-desk-topic-detail__header">
        <div>
          <p className="story-label">Canonical Topic</p>
          <h3>{rootNode.displayName}</h3>
          <span>{rootNode.shortTitle ?? deriveShortTitle(rootNode.displayName)}</span>
        </div>
        <dl>
          <div>
            <dt>References</dt>
            <dd>{rootReferenceCount}</dd>
          </div>
          <div>
            <dt>Accepted Subtopics</dt>
            <dd>{root.subcategorys.length}</dd>
          </div>
          <div>
            <dt>Proposed</dt>
            <dd>{root.proposedSubcategorys.length}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{relatedProposalCount}</dd>
          </div>
        </dl>
      </header>
      {rootNode.subtitle ? <p className="category-steering-categoryTree-subtitle">{rootNode.subtitle}</p> : null}
      <p>{rootNode.description ?? "Accepted root category."}</p>
      <div className="category-steering-categoryTree-evidence">
        <span>{compactArray(rootNode.seedItemIds).length} seed refs</span>
        <span>{compactArray(rootNode.holdoutItemIds).length} holdout refs</span>
        <span>{rootNode.categoryKey}</span>
      </div>

      <div className="news-desk-topic-detail__body">
        <div className="news-desk-topic-detail__subtopics">
          <p className="category-steering-subcategory-list__label">Accepted Subtopics</p>
          <div className="news-desk-topic-subtopic-buttons">
            {(() => {
              const rootLineageId = categoryLineageId(rootNode);
              return (
              <TopicFocusButton
                active={focusedCategoryKey === rootNode.categoryKey}
              conceptCount={semanticNodesForCategoryContext(graph, buildTopicDrilldownContext(root, rootNode, categoryByUid)).length}
              count={referencesForCategoryContext(graph, buildTopicDrilldownContext(root, rootNode, categoryByUid)).length}
              dataCategoryKey={rootNode.categoryKey}
              label={rootNode.shortTitle ?? deriveShortTitle(rootNode.displayName)}
              lineageId={rootLineageId}
              rootCategoryKey={rootNode.categoryKey}
              title={rootNode.displayName}
              onClick={() => onFocusCategory(rootNode.categoryKey)}
            />
              );
            })()}
            {root.subcategorys.length ? root.subcategorys.map((subcategory) => (
              (() => {
                const subcategoryLineageId = categoryLineageId(subcategory);
                return (
                  <TopicFocusButton
                    active={focusedCategoryKey === subcategory.categoryKey}
                    conceptCount={semanticNodesForCategoryContext(graph, buildTopicDrilldownContext(root, subcategory, categoryByUid)).length}
                    count={referencesForCategoryContext(graph, buildTopicDrilldownContext(root, subcategory, categoryByUid)).length}
                    dataCategoryKey={subcategory.categoryKey}
                    key={subcategory.id}
                    label={subcategory.shortTitle ?? deriveShortTitle(subcategory.displayName)}
                    lineageId={subcategoryLineageId}
                    rootCategoryKey={rootNode.categoryKey}
                    title={subcategory.displayName}
                    onClick={() => onFocusCategory(subcategory.categoryKey)}
                  />
                );
              })()
            )) : null}
          </div>
          {!root.subcategorys.length ? <EmptyRow label="No accepted subtopics under this root" /> : null}

          {root.proposedSubcategorys.length ? (
            <div className="category-steering-subcategory-list category-steering-subcategory-list--proposed">
              <p className="category-steering-subcategory-list__label">Proposed Subtopics</p>
              {root.proposedSubcategorys.map((proposal) => (
                <article className="category-steering-subcategory category-steering-subcategory--proposed" data-news-desk-proposed-subcategory={proposal.categoryKey ?? proposal.id} key={proposal.id}>
                  <h4>{proposal.displayName ?? proposal.title}</h4>
                  <span>{proposal.shortTitle ?? deriveShortTitle(proposal.displayName ?? proposal.title)}</span>
                  {proposal.subtitle ? <p className="category-steering-categoryTree-subtitle">{proposal.subtitle}</p> : null}
                  <p>{proposal.description ?? proposal.summary ?? "Candidate subtopic from steering proposals."}</p>
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
        </div>

          <TopicSemanticContext
          categoryContext={focusedNode ? buildTopicDrilldownContext(root, focusedNode, categoryByUid) : rootContext}
          categoryKeywords={categoryKeywords}
          disabled={disabled}
          graph={graph}
          lexicalSteeringRules={lexicalSteeringRules}
          node={focusedNode ?? rootNode}
          onLexicalRuleCreate={onLexicalRuleCreate}
        />
      </div>
    </article>
  );
}

function TopicFocusButton({
  active,
  conceptCount,
  count,
  dataCategoryKey,
  label,
  lineageId,
  onClick,
  rootCategoryKey,
  title,
}: {
  active: boolean;
  conceptCount: number;
  count: number;
  dataCategoryKey?: string;
  label: string;
  lineageId: string;
  onClick: () => void;
  rootCategoryKey: string;
  title: string;
}) {
  return (
    <div className="news-desk-topic-focus-row" data-selected={active || undefined}>
      <Link
        className="news-desk-topic-focus-button"
        data-news-desk-subcategory={dataCategoryKey}
        data-selected={active || undefined}
        href={topicHref(rootCategoryKey, dataCategoryKey)}
        onClick={onClick}
      >
        <strong>{label}</strong>
        <span>{title}</span>
        <small>{count} refs / {conceptCount} concepts</small>
      </Link>
      <div className="news-desk-topic-focus-row__actions" aria-label={`${title} drill-down links`}>
        <Link href={topicHref(rootCategoryKey, dataCategoryKey)}>Topic page</Link>
        <Link href={categoryDrilldownHref("references", dataCategoryKey ?? lineageId)}>References</Link>
        <Link href={categoryDrilldownHref("concepts", dataCategoryKey ?? lineageId)}>Concepts</Link>
      </div>
    </div>
  );
}

function TopicSemanticContext({
  categoryContext,
  categoryKeywords,
  disabled,
  graph,
  lexicalSteeringRules,
  node,
  onLexicalRuleCreate,
}: {
  categoryContext: CategoryDrilldownContext;
  categoryKeywords: CategoryKeywordRecord[];
  disabled: boolean;
  graph: SemanticGraph;
  lexicalSteeringRules: LexicalSteeringRuleRecord[];
  node: CategorySteeringCategoryTreeNode;
  onLexicalRuleCreate: (draft: LexicalRuleDraft) => void;
}) {
  const lineageId = categoryLineageId(node);
  const [referencePage, setReferencePage] = useState(0);
  const references = useMemo(() => sortReferenceSummariesByRecency(referencesForCategoryContext(graph, categoryContext)), [categoryContext, graph]);
  const pageCount = Math.max(1, Math.ceil(references.length / TOPIC_REFERENCE_PAGE_SIZE));
  const currentPage = Math.min(referencePage, pageCount - 1);
  const visibleReferences = references.slice(currentPage * TOPIC_REFERENCE_PAGE_SIZE, (currentPage + 1) * TOPIC_REFERENCE_PAGE_SIZE);
  const concepts = uniqueSemanticSummaries(
    semanticNodesForCategoryContext(graph, categoryContext),
  ).slice(0, 8);
  const neighborGroups = uniqueNeighborGroupsForCategoryContext(graph, categoryContext);

  useEffect(() => {
    setReferencePage(0);
  }, [lineageId]);

  return (
    <aside className="news-desk-topic-context" data-news-desk-topic-context={node.categoryKey}>
      <p className="story-label">Selected Topic</p>
      <h4>{node.displayName}</h4>
      {node.subtitle ? <p className="category-steering-categoryTree-subtitle">{node.subtitle}</p> : null}
      <p>{node.description ?? "No description imported for this topic."}</p>
      <div className="news-desk-topic-context__stats" aria-label="Selected topic reference counts">
        <div>
          <span>{categoryContext.includeDescendants ? "References including subtopics" : "References"}</span>
          <strong>{references.length}</strong>
        </div>
        <div>
          <span>Seed</span>
          <strong>{compactArray(node.seedItemIds).length}</strong>
        </div>
        <div>
          <span>Holdout</span>
          <strong>{compactArray(node.holdoutItemIds).length}</strong>
        </div>
      </div>
      <TopicReferencePanel
        currentPage={currentPage}
        includeDescendants={categoryContext.includeDescendants}
        node={node}
        pageCount={pageCount}
        references={references}
        visibleReferences={visibleReferences}
        onNext={() => setReferencePage((value) => Math.min(value + 1, pageCount - 1))}
        onPrevious={() => setReferencePage((value) => Math.max(value - 1, 0))}
      />
      <TopicKeywordsPanel
        categorySetId={node.categorySetId}
        categoryKey={node.categoryKey}
        classifierId={null}
        corpusId={node.corpusId}
        disabled={disabled}
        keywords={keywordsForCategory(categoryKeywords, node.categoryKey)}
        rules={lexicalSteeringRules}
        onLexicalRuleCreate={onLexicalRuleCreate}
      />
      <div className="news-desk-topic-context__block">
        <header>
          <strong>Associated Concepts</strong>
          <span>{concepts.length}</span>
        </header>
        {concepts.length ? concepts.map((concept) => (
          <Link href={concept.href} key={concept.lineageId}>
            <span>{concept.subtitle ?? "concept"}</span>
            <strong>{concept.label}</strong>
          </Link>
        )) : <EmptyRow label="No graph concepts attached yet" />}
        <Link className="news-desk-topic-reference-ledger-link" href={categoryDrilldownHref("concepts", node.categoryKey)}>
          View graph concepts
        </Link>
      </div>
      <NeighborGroups groups={neighborGroups} />
    </aside>
  );
}

function TopicReferencePanel({
  currentPage,
  includeDescendants,
  node,
  onNext,
  onPrevious,
  pageCount,
  references,
  visibleReferences,
}: {
  currentPage: number;
  includeDescendants: boolean;
  node: CategorySteeringCategoryTreeNode;
  onNext: () => void;
  onPrevious: () => void;
  pageCount: number;
  references: SemanticObjectSummary[];
  visibleReferences: SemanticObjectSummary[];
}) {
  return (
    <section className="news-desk-topic-reference-panel" data-news-desk-topic-references={node.categoryKey}>
      <header>
        <div>
          <p className="story-label">Reference Ledger</p>
          <h5>References In This Topic</h5>
        </div>
        <span>{references.length}</span>
      </header>
      {includeDescendants ? <p className="news-desk-topic-reference-panel__note">Including accepted subtopics.</p> : null}
      {visibleReferences.length ? (
        <div className="news-desk-topic-reference-list">
          {visibleReferences.map((reference) => (
            <Link className="news-desk-topic-reference-link" href={reference.href} key={reference.lineageId}>
              <span>{formatReferenceSummaryDate(reference)} / {reference.subtitle ?? "reference"}</span>
              <strong>{reference.label}</strong>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyRow label="No classified references are attached to this topic yet. Run the curation cycle after importing projections." />
      )}
      {references.length > TOPIC_REFERENCE_PAGE_SIZE ? (
        <ReferencePager
          onNext={onNext}
          onPrevious={onPrevious}
          page={currentPage}
          pageCount={pageCount}
        />
      ) : null}
      {references.length ? (
        <Link className="news-desk-topic-reference-ledger-link" href={categoryDrilldownHref("references", node.categoryKey)}>
          View all references
        </Link>
      ) : null}
    </section>
  );
}

function TopicKeywordsPanel({
  categoryKey,
  categorySetId,
  classifierId,
  corpusId,
  disabled,
  keywords,
  rules,
  onLexicalRuleCreate,
}: {
  categoryKey: string;
  categorySetId: string;
  classifierId?: string | null;
  corpusId: string;
  disabled: boolean;
  keywords: CategoryKeywordRecord[];
  rules: LexicalSteeringRuleRecord[];
  onLexicalRuleCreate: (draft: LexicalRuleDraft) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [manualTerm, setManualTerm] = useState("");
  const activeIgnoredTerms = useMemo(() => ignoredTermSet(rules, { categorySetId, corpusId, classifierId, categoryKey }, false), [categoryKey, categorySetId, classifierId, corpusId, rules]);
  const archivedIgnoredTerms = useMemo(() => ignoredTermSet(rules, { categorySetId, corpusId, classifierId, categoryKey }, true), [categoryKey, categorySetId, classifierId, corpusId, rules]);
  const activeRules = rules.filter((rule) => rule.ruleKind === "ignored_keyword" && rule.status === "active");
  const archivedRules = rules.filter((rule) => rule.ruleKind === "ignored_keyword" && rule.status !== "active");
  const visibleKeywords = showAll ? keywords : keywords.slice(0, 14);

  function createRule(term: string, scope: LexicalRuleScope = "publication", note?: string) {
    const normalized = normalizeKeywordTerm(term);
    if (!normalized) return;
    onLexicalRuleCreate({
      term,
      scope,
      corpusId: scope === "corpus" || scope === "classifier" || scope === "category" ? corpusId : null,
      classifierId: scope === "classifier" || scope === "category" ? classifierId : null,
      categorySetId: scope === "category" ? categorySetId : null,
      categoryKey: scope === "category" ? categoryKey : null,
      note,
    });
  }

  return (
    <div className="news-desk-topic-context__block news-desk-topic-keywords" data-news-desk-topic-keywords={categoryKey}>
      <header>
        <strong>Topic Keywords</strong>
        <span>{keywords.length}</span>
      </header>
      <div className="news-desk-keyword-controls">
        <label>
          <span>Ignore term</span>
          <input
            type="text"
            value={manualTerm}
            onChange={(event) => setManualTerm(event.target.value)}
            placeholder="et, al, boilerplate"
          />
        </label>
        <button
          type="button"
          disabled={disabled || !normalizeKeywordTerm(manualTerm)}
          onClick={() => {
            createRule(manualTerm, "publication", "Manual lexical steering from Newsroom.");
            setManualTerm("");
          }}
        >
          Ignore
        </button>
      </div>
      {visibleKeywords.length ? (
        <div className="news-desk-keyword-list">
          {visibleKeywords.map((keyword) => {
            const isIgnored = activeIgnoredTerms.has(keyword.normalizedKeyword);
            const wasIgnored = archivedIgnoredTerms.has(keyword.normalizedKeyword);
            return (
              <div
                className="news-desk-keyword-row"
                data-ignored={isIgnored || undefined}
                data-archived-ignored={wasIgnored || undefined}
                key={keyword.id}
              >
                <span>{keyword.rank ?? "-"}</span>
                <strong>{keyword.keyword}</strong>
                <small>{keyword.weight != null ? keyword.weight.toFixed(3) : keyword.source}</small>
                <button
                  type="button"
                  disabled={disabled || isIgnored}
                  onClick={() => createRule(keyword.keyword, "publication", `Ignored from topic ${categoryKey}.`)}
                >
                  {isIgnored ? "Ignored" : "Ignore"}
                </button>
              </div>
            );
          })}
        </div>
      ) : <EmptyRow label="No keyword evidence imported for this topic yet" />}
      {keywords.length > visibleKeywords.length ? (
        <button className="news-desk-keyword-more" type="button" onClick={() => setShowAll(true)}>
          Show all {keywords.length} keywords
        </button>
      ) : showAll && keywords.length > 14 ? (
        <button className="news-desk-keyword-more" type="button" onClick={() => setShowAll(false)}>
          Show fewer keywords
        </button>
      ) : null}
      <details className="news-desk-ignored-terms" open={activeRules.length > 0}>
        <summary>{activeRules.length} active ignored terms</summary>
        <div>
          {activeRules.slice(0, 24).map((rule) => (
            <span key={rule.id}>{rule.term} <small>{rule.scope}</small></span>
          ))}
          {!activeRules.length ? <span>No active lexical rules</span> : null}
        </div>
      </details>
      {archivedRules.length ? (
        <label className="news-desk-keyword-toggle">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          <span>Show archived ignored terms</span>
        </label>
      ) : null}
      {showArchived ? (
        <div className="news-desk-ignored-terms__archive">
          {archivedRules.map((rule) => <span key={rule.id}>{rule.term} <small>{rule.scope}</small></span>)}
        </div>
      ) : null}
    </div>
  );
}

function ReferenceListControls({
  label,
  onNext,
  onPrevious,
  onQueryChange,
  onStatusChange,
  page,
  pageCount,
  query,
  status,
}: {
  label: string;
  onNext: () => void;
  onPrevious: () => void;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: string) => void;
  page: number;
  pageCount: number;
  query: string;
  status: string;
}) {
  return (
    <div className="news-desk-reference-controls">
      <label>
        <span>Search references</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Title, source path, author, item id"
        />
      </label>
      <label>
        <span>Curation status</span>
        <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <div>
        <span>{label}</span>
        <ReferencePager onNext={onNext} onPrevious={onPrevious} page={page} pageCount={pageCount} />
      </div>
    </div>
  );
}

function ReferencePager({
  onNext,
  onPrevious,
  page,
  pageCount,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
}) {
  return (
    <div className="news-desk-reference-pager">
      <button type="button" disabled={page <= 0} onClick={onPrevious}>Previous</button>
      <span>Page {page + 1} / {pageCount}</span>
      <button type="button" disabled={page >= pageCount - 1} onClick={onNext}>Next</button>
    </div>
  );
}

function ReferenceRow({ active, reference }: { active?: boolean; reference: ReferenceRecord }) {
  const lineageId = reference.lineageId ?? reference.id;
  const date = formatReferenceDate(reference);
  return (
    <a
      className={`news-desk-object-row${active ? " news-desk-object-row--active" : ""}`}
      data-reference-lineage={lineageId}
      href={newsDeskHrefForSemanticObject("reference", lineageId)}
    >
      <strong>{reference.title ?? reference.externalItemId}</strong>
      <span>{reference.curationStatus ?? "pending"} / {date} / {reference.mediaType ?? "metadata"} / {reference.storagePath ?? reference.sourceUri ?? "no file path"}</span>
    </a>
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

function assertReferenceReviewMutationSucceeded(response: ReferenceReviewResponse, referenceId: string): NonNullable<ReferenceReviewResponse["data"]> {
  if (response.errors?.length) {
    throw new Error(response.errors.map(formatGraphQLError).join("; "));
  }
  if (!response.data?.ok) {
    throw new Error(`Reference curation review was not saved for ${referenceId}.`);
  }
  if (response.data.referenceId && response.data.referenceId !== referenceId) {
    throw new Error(`Reference review response did not match ${referenceId}.`);
  }
  if (!response.data.messageId || !response.data.relationId) {
    throw new Error(`Reference review saved without commentary audit rows for ${referenceId}.`);
  }
  return response.data;
}

function referenceCurationStatusForAction(action: ReferenceCurationAction): "accepted" | "rejected" | "pending" | "archived" {
  if (action === "accept") return "accepted";
  if (action === "reject") return "rejected";
  if (action === "archive") return "archived";
  return "pending";
}

function assertNoGraphQLErrors(errors?: unknown[] | null) {
  if (!errors?.length) return;
  throw new Error(errors.map((error) => formatGraphQLError(error as { message?: string | null } | string | null)).join("; "));
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
    lineageId: category.lineageId ?? category.id,
    versionNumber: category.versionNumber,
    previousVersionId: category.previousVersionId,
    versionState: category.versionState,
    versionCreatedAt: category.versionCreatedAt,
    versionCreatedBy: category.versionCreatedBy,
    changeReason: category.changeReason,
    contentHash: category.contentHash,
    categorySetId: category.categorySetId,
    corpusId: category.corpusId,
    categoryKey: category.categoryKey,
    parentCategoryId: category.parentCategoryId,
    parentCategoryKey: null,
    displayName: category.displayName,
    shortTitle: category.shortTitle,
    subtitle: category.subtitle,
    description: category.description,
    aliases: category.aliases,
    status: category.status,
    seedItemIds: category.seedItemIds,
    holdoutItemIds: category.holdoutItemIds,
    rank: category.rank,
    depth: 0,
    isPinned: category.isPinned,
    importRunId: category.importRunId,
    updatedAt: category.updatedAt,
  };
}

function mergeCategoryRecords(
  categorys: CategorySteeringCategory[],
  categoryNodes: CategorySteeringCategoryTreeNode[],
): CategorySteeringCategory[] {
  const records = new Map<string, CategorySteeringCategory>();
  for (const category of [...categorys, ...categoryNodes]) {
    records.set(category.id, category);
  }
  return Array.from(records.values());
}

function keywordsForCategory(keywords: CategoryKeywordRecord[], categoryKey: string): CategoryKeywordRecord[] {
  return keywords
    .filter((keyword) => keyword.categoryKey === categoryKey)
    .sort((left, right) => {
      const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
      if (rankDiff !== 0) return rankDiff;
      const weightDiff = (right.weight ?? -Infinity) - (left.weight ?? -Infinity);
      if (Number.isFinite(weightDiff) && weightDiff !== 0) return weightDiff;
      return left.normalizedKeyword.localeCompare(right.normalizedKeyword);
    });
}

function ignoredTermSet(
  rules: LexicalSteeringRuleRecord[],
  context: { categorySetId: string; corpusId: string; classifierId?: string | null; categoryKey: string },
  archived: boolean,
): Set<string> {
  return new Set(
    rules
      .filter((rule) => rule.ruleKind === "ignored_keyword")
      .filter((rule) => archived ? rule.status !== "active" : rule.status === "active")
      .filter((rule) => lexicalRuleApplies(rule, context))
      .map((rule) => rule.normalizedTerm),
  );
}

function lexicalRuleApplies(
  rule: LexicalSteeringRuleRecord,
  context: { categorySetId: string; corpusId: string; classifierId?: string | null; categoryKey: string },
): boolean {
  if (rule.scope === "publication") return true;
  if (rule.scope === "corpus") return !rule.corpusId || rule.corpusId === context.corpusId;
  if (rule.scope === "classifier") {
    return (!rule.corpusId || rule.corpusId === context.corpusId)
      && (!rule.classifierId || rule.classifierId === context.classifierId);
  }
  if (rule.scope === "category") {
    return (!rule.categorySetId || rule.categorySetId === context.categorySetId)
      && (!rule.categoryKey || rule.categoryKey === context.categoryKey);
  }
  return false;
}

function normalizeKeywordTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function upsertLocalLexicalRule(rules: LexicalSteeringRuleRecord[], rule: LexicalSteeringRuleRecord): LexicalSteeringRuleRecord[] {
  const withoutExisting = rules.filter((entry) => entry.id !== rule.id);
  return [rule, ...withoutExisting].sort((left, right) => `${left.scope}#${left.normalizedTerm}`.localeCompare(`${right.scope}#${right.normalizedTerm}`));
}

function hashUiKey(values: unknown[]): string {
  const text = values.map((value) => String(value ?? "")).join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function uniqueSemanticSummaries(objects: SemanticObjectSummary[]): SemanticObjectSummary[] {
  const map = new Map<string, SemanticObjectSummary>();
  for (const object of objects) map.set(`${object.kind}#${object.lineageId}`, object);
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function sortReferencesByRecency(references: ReferenceRecord[]): ReferenceRecord[] {
  return [...references].sort(compareReferencesByRecency);
}

function sortReferenceSummariesByRecency(references: SemanticObjectSummary[]): SemanticObjectSummary[] {
  return [...references].sort((left, right) => {
    const dateDiff = referenceSummarySortDate(right).localeCompare(referenceSummarySortDate(left));
    if (dateDiff !== 0) return dateDiff;
    return left.label.localeCompare(right.label);
  });
}

function compareReferencesByRecency(left: ReferenceRecord, right: ReferenceRecord): number {
  const dateDiff = referenceSortDate(right).localeCompare(referenceSortDate(left));
  if (dateDiff !== 0) return dateDiff;
  return (left.title ?? left.externalItemId).localeCompare(right.title ?? right.externalItemId);
}

function referenceSortDate(reference: ReferenceRecord): string {
  return reference.sourcePublishedAt
    ?? reference.sourceUpdatedAt
    ?? reference.retrievedAt
    ?? reference.importedAt
    ?? reference.updatedAt
    ?? "";
}

function referenceSummarySortDate(reference: SemanticObjectSummary): string {
  return reference.kind === "reference" && reference.record
    ? referenceSortDate(reference.record as ReferenceRecord)
    : "";
}

function formatReferenceDate(reference: ReferenceRecord): string {
  const value = referenceSortDate(reference);
  return value ? formatShortDate(value) : "undated";
}

function formatReferenceSummaryDate(reference: SemanticObjectSummary): string {
  const value = referenceSummarySortDate(reference);
  return value ? formatShortDate(value) : "undated";
}

function formatShortDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function referenceMatchesQuery(reference: ReferenceRecord, normalizedQuery: string): boolean {
  const authors = compactArray(reference.authors).join(" ");
  return [
    reference.title,
    reference.externalItemId,
    reference.sourceUri,
    reference.storagePath,
    reference.mediaType,
    authors,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function selectInitialRootKey(roots: CanonicalTopicRoot[], initialCategoryLineageId?: string | null): string | null {
  if (!roots.length) return null;
  if (!initialCategoryLineageId) return roots[0].category.categoryKey;
  for (const root of roots) {
    if (matchesCategorySelection(root.category, initialCategoryLineageId) || (root.node && matchesCategorySelection(root.node, initialCategoryLineageId))) {
      return root.category.categoryKey;
    }
    if (root.subcategorys.some((subcategory) => matchesCategorySelection(subcategory, initialCategoryLineageId))) {
      return root.category.categoryKey;
    }
  }
  return roots[0].category.categoryKey;
}

function selectInitialFocusKey(root: CanonicalTopicRoot | null, initialCategoryLineageId?: string | null): string | null {
  if (!root) return null;
  if (!initialCategoryLineageId) return root.category.categoryKey;
  if (matchesCategorySelection(root.category, initialCategoryLineageId) || (root.node && matchesCategorySelection(root.node, initialCategoryLineageId))) {
    return root.category.categoryKey;
  }
  const subcategory = root.subcategorys.find((candidate) => matchesCategorySelection(candidate, initialCategoryLineageId));
  return subcategory?.categoryKey ?? root.category.categoryKey;
}

function matchesCategorySelection(category: CategorySteeringCategory | CategorySteeringCategoryTreeNode, selection: string): boolean {
  return category.id === selection || category.lineageId === selection || category.categoryKey === selection;
}

function buildCategoryCopyVersion(
  category: CategorySteeringCategory,
  update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">,
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

function deskDoctrineStatus(category: CategorySteeringCategory, records: DoctrineRecord[]): { savedCount: number } {
  const savedCount = (["mission", "policy"] as DoctrineKind[]).filter((kind) => {
    const definition = buildDeskDoctrineDefinition(category, kind);
    const record = records.find((entry) => entry.slug === definition.slug);
    return doctrineTextToBody(doctrineBodyToText(record?.body)).length > 0;
  }).length;
  return { savedCount };
}

function countAssignmentsForDesk(
  assignments: AssignmentRecord[],
  graph: SemanticGraph,
  rootNode: CategorySteeringCategoryTreeNode,
  subcategorys: CategorySteeringCategoryTreeNode[],
): number {
  const categoryKeys = new Set([rootNode.categoryKey, ...subcategorys.map((subcategory) => subcategory.categoryKey)]);
  const categoryLineages = new Set([rootNode, ...subcategorys].map((category) => categoryLineageId(category)));
  return assignments.filter((assignment) => {
    const metadataCategoryKey = assignmentMetadataCategoryKey(assignment);
    if (metadataCategoryKey && categoryKeys.has(metadataCategoryKey)) return true;
    return graph.outgoing("assignment", assignment.id).some((relation) => (
      relation.objectKind === "category"
      && categoryLineages.has(relation.objectLineageId)
    ));
  }).length;
}

function assignmentMetadataCategoryKey(assignment: AssignmentRecord): string | null {
  const metadata = parseMetadataObject(assignment.metadata);
  return normalizeMetadataString(metadata?.focusCategoryKey)
    ?? normalizeMetadataString(metadata?.deskCategoryKey)
    ?? normalizeMetadataString(metadata?.categoryKey)
    ?? normalizeMetadataString(metadata?.category_key)
    ?? normalizeMetadataString(metadata?.rootCategoryKey)
    ?? normalizeMetadataString(metadata?.root_category_key)
    ?? normalizeMetadataString(metadata?.topicUid)
    ?? normalizeMetadataString(metadata?.topic_uid)
    ?? nestedMetadataCategoryKey(metadata?.newsroom)
    ?? nestedMetadataCategoryKey(metadata?.assignment);
}

function nestedMetadataCategoryKey(value: unknown): string | null {
  const metadata = parseMetadataObject(value);
  return normalizeMetadataString(metadata?.focusCategoryKey)
    ?? normalizeMetadataString(metadata?.deskCategoryKey)
    ?? normalizeMetadataString(metadata?.categoryKey)
    ?? normalizeMetadataString(metadata?.category_key)
    ?? normalizeMetadataString(metadata?.rootCategoryKey)
    ?? normalizeMetadataString(metadata?.root_category_key)
    ?? normalizeMetadataString(metadata?.topicUid)
    ?? normalizeMetadataString(metadata?.topic_uid);
}

function parseMetadataObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeMetadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMetadataStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeMetadataString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function assignmentContextMetadata(assignment: AssignmentRecord): {
  deskKey: string | null;
  deskTitle: string | null;
  focusKey: string | null;
  focusTitle: string | null;
  contextProfile: string | null;
  contextTokenBudget: number | null;
  contextSources: string[];
  targetSystemType: string | null;
  expectedEvidenceClasses: string[];
  comparisonQuestions: string[];
} | null {
  const metadata = parseMetadataObject(assignment.metadata);
  if (!metadata) return null;
  const deskKey = normalizeMetadataString(metadata.deskCategoryKey)
    ?? normalizeMetadataString(metadata.rootCategoryKey);
  const focusKey = normalizeMetadataString(metadata.focusCategoryKey)
    ?? normalizeMetadataString(metadata.researchLens);
  if (!deskKey && !focusKey) return null;
  const contextTokenBudgetValue = typeof metadata.contextTokenBudget === "number"
    ? metadata.contextTokenBudget
    : typeof metadata.contextTokenBudget === "string" && metadata.contextTokenBudget.trim()
      ? Number(metadata.contextTokenBudget)
      : null;
  return {
    deskKey,
    deskTitle: normalizeMetadataString(metadata.deskCategoryTitle)
      ?? normalizeMetadataString(metadata.rootCategoryTitle)
      ?? deskKey,
    focusKey,
    focusTitle: normalizeMetadataString(metadata.focusCategoryTitle)
      ?? normalizeMetadataString(metadata.researchLensTitle)
      ?? focusKey,
    contextProfile: normalizeMetadataString(metadata.contextProfile),
    contextTokenBudget: Number.isFinite(contextTokenBudgetValue) ? Number(contextTokenBudgetValue) : null,
    contextSources: normalizeMetadataStringList(metadata.contextSources),
    targetSystemType: normalizeMetadataString(metadata.targetSystemType),
    expectedEvidenceClasses: normalizeMetadataStringList(metadata.expectedEvidenceClasses),
    comparisonQuestions: normalizeMetadataStringList(metadata.comparisonQuestions),
  };
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
                  <dt>Categories</dt>
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

function deriveShortTitle(value: string | null | undefined): string {
  const words = String(value ?? "")
    .replace(/[_/|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s&+-]/gu, "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.length ? words.slice(0, 3).join(" ") : "Topic";
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
            <dt>Short Title</dt>
            <dd>{proposal.shortTitle ?? category?.shortTitle ?? "auto"}</dd>
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
  onSave: (category: CategorySteeringCategory, update: Pick<CategorySteeringCategory, "displayName" | "shortTitle" | "subtitle" | "description">) => void;
}) {
  const [displayName, setDisplayName] = useState(category.displayName);
  const [shortTitle, setShortTitle] = useState(category.shortTitle ?? deriveShortTitle(category.displayName));
  const [subtitle, setSubtitle] = useState(category.subtitle ?? "");
  const [description, setDescription] = useState(category.description ?? "");

  useEffect(() => {
    setDisplayName(category.displayName);
    setShortTitle(category.shortTitle ?? deriveShortTitle(category.displayName));
    setSubtitle(category.subtitle ?? "");
    setDescription(category.description ?? "");
  }, [category.description, category.displayName, category.id, category.shortTitle, category.subtitle]);

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
        <span>Short Title</span>
        <input
          aria-describedby={`${category.id}-short-title-help`}
          value={shortTitle}
          onChange={(event) => setShortTitle(event.target.value)}
        />
        <small id={`${category.id}-short-title-help`}>Used for URL slugs and eyebrow headers; it does not need to be unique.</small>
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
        <button type="button" data-news-desk-command="save-copy" disabled={disabled || !displayName.trim() || !shortTitle.trim()} onClick={() => onSave(category, { displayName, shortTitle, subtitle, description })}>Save Copy</button>
      </footer>
    </article>
  );
}

function CategorySetPanel({
  categorySet,
  artifacts,
  references,
  referenceAttachments,
  messages,
  semanticRelations,
}: {
  categorySet: CategorySteeringCategorySet | null;
  artifacts: CategorySteeringArtifact[];
  references: ReferenceRecord[];
  referenceAttachments: { id: string }[];
  messages: { id: string; messageKind: string }[];
  semanticRelations: SemanticRelationRecord[];
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
            <dt>References</dt>
            <dd>{references.length}</dd>
          </div>
          <div>
            <dt>Attachments</dt>
            <dd>{referenceAttachments.length}</dd>
          </div>
          <div>
            <dt>Import Messages</dt>
            <dd>{messages.filter((message) => message.messageKind === "import_rationale").length}</dd>
          </div>
          <div>
            <dt>Review Links</dt>
            <dd>{semanticRelations.filter((relation) => relation.reviewRecommended).length}</dd>
          </div>
        </dl>
        <div className="category-steering-artifacts">
          {artifacts.slice(0, 4).map((artifact) => {
            const label = artifact.displayName ?? artifact.artifactId;
            return (
              <span key={artifact.id} aria-label={label} title={label}>
                {formatArtifactChipLabel(label)}
              </span>
            );
          })}
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

function buildDoctrineEditorState(records: DoctrineRecord[]): DoctrineEditorState {
  return {
    mission: doctrineBodyToText(findDoctrineRecord(records, "mission")?.body),
    policy: doctrineBodyToText(findDoctrineRecord(records, "policy")?.body),
  };
}

function findDoctrineRecord(records: DoctrineRecord[], kind: DoctrineKind): DoctrineRecord | null {
  const definition = requireDoctrineDefinition(kind);
  return records.find((record) => record.slug === definition.slug) ?? null;
}

function requireDoctrineDefinition(kind: DoctrineKind) {
  const definition = DOCTRINE_DEFINITION_BY_KIND.get(kind);
  if (!definition) throw new Error(`Unknown doctrine kind ${kind}`);
  return definition;
}

function buildDoctrineRecord(
  kind: DoctrineKind,
  body: string[],
  currentRecord: DoctrineRecord | null,
  now: string,
  actorLabel: string,
): DoctrineRecord {
  const definition = requireDoctrineDefinition(kind);
  return {
    id: currentRecord?.id ?? definition.id,
    lineageId: currentRecord?.lineageId ?? definition.lineageId,
    versionNumber: currentRecord?.versionNumber ?? 1,
    versionState: currentRecord?.versionState ?? "current",
    versionCreatedAt: currentRecord?.versionCreatedAt ?? now,
    versionCreatedBy: currentRecord?.versionCreatedBy ?? actorLabel,
    type: DOCTRINE_ITEM_TYPE,
    status: currentRecord?.status ?? DOCTRINE_ITEM_STATUS,
    typeStatus: currentRecord?.typeStatus ?? DOCTRINE_ITEM_TYPE_STATUS,
    slug: definition.slug,
    title: definition.label,
    headline: definition.label,
    body,
    editorial: doctrineEditorialValue(kind),
    updatedAt: now,
  };
}

function buildDeskDoctrineRecord(
  category: CategorySteeringCategory,
  kind: DoctrineKind,
  body: string[],
  currentRecord: DoctrineRecord | null,
  now: string,
  actorLabel: string,
): DoctrineRecord {
  const definition = buildDeskDoctrineDefinition(category, kind);
  const title = `${category.displayName} ${definition.label}`;
  return {
    id: currentRecord?.id ?? definition.id,
    lineageId: currentRecord?.lineageId ?? definition.lineageId,
    versionNumber: currentRecord?.versionNumber ?? 1,
    versionState: currentRecord?.versionState ?? "current",
    versionCreatedAt: currentRecord?.versionCreatedAt ?? now,
    versionCreatedBy: currentRecord?.versionCreatedBy ?? actorLabel,
    type: DOCTRINE_ITEM_TYPE,
    status: currentRecord?.status ?? DOCTRINE_ITEM_STATUS,
    typeStatus: currentRecord?.typeStatus ?? DOCTRINE_ITEM_TYPE_STATUS,
    slug: definition.slug,
    title,
    headline: title,
    body,
    editorial: deskDoctrineEditorialValue(category, kind),
    updatedAt: now,
  };
}

function replaceDoctrineRecord(records: DoctrineRecord[], nextRecord: DoctrineRecord): DoctrineRecord[] {
  const next = records.filter((record) => record.slug !== nextRecord.slug);
  next.push(nextRecord);
  return next.sort((left, right) => left.slug.localeCompare(right.slug));
}

function compactArray(value: Array<string | null> | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).sort();
}

function formatArtifactChipLabel(value: string | null | undefined): string {
  const label = value?.trim() ?? "";
  if (!label) return "Untitled artifact";
  if (label.length <= 44) return label;

  const kindHashMatch = label.match(/^([^:\s]+:)([a-f0-9]{24,})$/i);
  if (kindHashMatch) {
    const [, prefix, hash] = kindHashMatch;
    return `${prefix}${hash.slice(0, 8)}…${hash.slice(-8)}`;
  }

  return `${label.slice(0, 24)}…${label.slice(-12)}`;
}

function formatUserLabel(user: UserDirectoryEntry): string {
  return user.displayName ?? user.email ?? user.username ?? user.userSub ?? user.userProfileId ?? "Unknown user";
}

function getUserDirectoryEntryKey(user: UserDirectoryEntry): string {
  return user.userProfileId ?? user.userSub ?? user.email ?? user.username ?? formatUserLabel(user);
}

function mergeDemoUsers(users: UserDirectoryEntry[], source: UserDirectoryEntry, target: UserDirectoryEntry): UserDirectoryEntry[] {
  const sourceKey = getUserDirectoryEntryKey(source);
  const targetKey = getUserDirectoryEntryKey(target);
  const targetProfileId = target.userProfileId ?? `user-profile-demo-${targetKey.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
  return users.reduce<UserDirectoryEntry[]>((entries, entry) => {
    if (getUserDirectoryEntryKey(entry) === targetKey) {
      const mergedIdentity = source.identities.length
        ? source.identities.map((identity) => ({ ...identity, userProfileId: targetProfileId }))
        : source.userSub
          ? [{
              id: `user-identity-demo-merged-${source.userSub}`,
              userProfileId: targetProfileId,
              cognitoSub: source.userSub,
              provider: source.provider ?? "cognito",
              email: source.email ?? null,
              status: "active",
              linkedAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
            }]
          : [];
      entries.push({
        ...entry,
        userProfileId: targetProfileId,
        activeRoles: Array.from(new Set([...compactArray(entry.activeRoles), ...compactArray(source.activeRoles)])).sort(),
        identities: uniqueIdentities([...entry.identities, ...mergedIdentity]),
      });
      return entries;
    }
    if (getUserDirectoryEntryKey(entry) === sourceKey) return entries;
    entries.push(entry);
    return entries;
  }, []);
}

function uniqueIdentities(identities: UserDirectoryEntry["identities"]): UserDirectoryEntry["identities"] {
  const seen = new Set<string>();
  const unique = [];
  for (const identity of identities) {
    const key = identity.cognitoSub || identity.id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(identity);
  }
  return unique;
}

function isTailoredCategoryProposal(proposal: CategorySteeringProposal): boolean {
  return proposal.steeringDomain === "category" && TAILORED_TOPIC_PROPOSAL_KINDS.has(proposal.proposalKind);
}

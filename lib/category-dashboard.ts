import type { CategorySteeringDashboard } from "./category-repository";

export function createEmptyCategorySteeringDashboard(): CategorySteeringDashboard {
  return {
    isPublicSkeleton: true,
    summary: null,
    canManageUsers: false,
    canonicalCorpusId: null,
    canonicalCategorySetId: null,
    userDirectory: [],
    corpora: [],
    importRuns: [],
    categorySets: [],
    categorys: [],
    categoryTrees: [],
    categoryNodes: [],
    categoryKeywords: [],
    lexicalSteeringRules: [],
    proposals: [],
    artifacts: [],
    references: [],
    referenceAttachments: [],
    semanticNodes: [],
    messages: [],
    semanticRelations: [],
    assignments: [],
    assignmentEvents: [],
    doctrineRecords: [],
    newsroomSections: [],
    loadError: null,
  };
}

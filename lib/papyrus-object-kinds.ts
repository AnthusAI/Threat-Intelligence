export type PapyrusObjectKind =
  | "assignment"
  | "category"
  | "categorySet"
  | "item"
  | "message"
  | "newsroomSection"
  | "reference"
  | "semanticNode"
  | "semanticRelation"
  | "steeringProposal";

export const PAPYRUS_OBJECT_KINDS = new Set<PapyrusObjectKind>([
  "assignment",
  "category",
  "categorySet",
  "item",
  "message",
  "newsroomSection",
  "reference",
  "semanticNode",
  "semanticRelation",
  "steeringProposal",
]);

import { defineStorage } from "@aws-amplify/backend";
import { assignmentAction } from "../functions/assignment-action/resource";
import { categoryAction } from "../functions/category-action/resource";
import { knowledgeQuery } from "../functions/knowledge-query/resource";
import { modelAttachmentUpload } from "../functions/model-attachment-upload/resource";
import { newsroomSummary } from "../functions/newsroom-summary/resource";

export const storage = defineStorage({
  name: "papyrusMedia",
  isDefault: true,
  access: (allow) => ({
    "media/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
      allow.groups(["editor", "admin"]).to(["read", "write", "delete"]),
    ],
    "corpora/*": [
      allow.groups(["editor", "admin"]).to(["read"]),
      allow.resource(knowledgeQuery).to(["read"]),
    ],
    "newsroom/*": [
      allow.groups(["editor", "admin"]).to(["read", "write", "delete"]),
      allow.resource(assignmentAction).to(["read", "write"]),
      allow.resource(categoryAction).to(["read", "write"]),
      allow.resource(modelAttachmentUpload).to(["read", "write", "delete"]),
      allow.resource(newsroomSummary).to(["read", "write"]),
    ],
  }),
});

import { defineFunction } from "@aws-amplify/backend";

export const modelAttachmentUpload = defineFunction({
  name: "papyrus-model-attachment-upload",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  memoryMB: 256,
});

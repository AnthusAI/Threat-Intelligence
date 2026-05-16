import { defineFunction } from "@aws-amplify/backend";

export const curationAction = defineFunction({
  name: "papyrus-curation-action",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  memoryMB: 256,
});

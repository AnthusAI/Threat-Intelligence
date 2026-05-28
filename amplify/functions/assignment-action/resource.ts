import { defineFunction } from "@aws-amplify/backend";

export const assignmentAction = defineFunction({
  name: "papyrus-assignment-action",
  entry: "./handler.ts",
  timeoutSeconds: 120,
  memoryMB: 256,
});

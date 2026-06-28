import { defineFunction } from "@aws-amplify/backend";

export const procedureAction = defineFunction({
  name: "papyrus-procedure-action",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
});

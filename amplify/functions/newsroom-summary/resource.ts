import { defineFunction } from "@aws-amplify/backend";

export const newsroomSummary = defineFunction({
  name: "papyrus-newsroom-summary",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
});

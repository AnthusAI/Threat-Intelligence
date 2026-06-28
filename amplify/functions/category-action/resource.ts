import { defineFunction } from "@aws-amplify/backend";

export const categoryAction = defineFunction({
  name: "papyrus-category-action",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  memoryMB: 256,
  resourceGroupName: "data",
});

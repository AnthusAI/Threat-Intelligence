import { defineFunction } from "@aws-amplify/backend";

export const manageUserRole = defineFunction({
  name: "papyrus-manage-user-role",
  entry: "./handler.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});

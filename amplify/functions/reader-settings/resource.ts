import { defineFunction } from "@aws-amplify/backend";

export const readerSettings = defineFunction({
  name: "papyrus-reader-settings",
  entry: "./handler.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});

import { defineFunction } from "@aws-amplify/backend";

export const sesInboundReceive = defineFunction(
  {
    name: "papyrus-ses-inbound-receive",
    entry: "./handler.ts",
    timeoutSeconds: 60,
    memoryMB: 512,
  },
  { resourceGroupName: "data" },
);

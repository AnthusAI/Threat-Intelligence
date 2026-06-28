import { defineFunction, secret } from "@aws-amplify/backend";

export const slackEvents = defineFunction({
  name: "papyrus-slack-events",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
  environment: {
    PAPYRUS_SLACK_SIGNING_SECRET: secret("PAPYRUS_SLACK_SIGNING_SECRET"),
  },
});

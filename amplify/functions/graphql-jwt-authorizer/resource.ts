import { defineFunction, secret } from "@aws-amplify/backend";

export const graphqlJwtAuthorizer = defineFunction({
  name: "papyrus-graphql-jwt-authorizer",
  entry: "./handler.ts",
  timeoutSeconds: 5,
  memoryMB: 256,
  resourceGroupName: "data",
  environment: {
    PAPYRUS_JWT_SECRET: secret("PAPYRUS_JWT_SECRET"),
    PAPYRUS_JWT_ISSUER: "papyrus-cli",
    PAPYRUS_JWT_AUDIENCE: "papyrus-authoring",
    PAPYRUS_JWT_REQUIRED_SCOPE: "papyrus:write",
  },
});

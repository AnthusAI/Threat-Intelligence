import { defineData } from "@aws-amplify/backend";
import { graphqlJwtAuthorizer } from "../functions/graphql-jwt-authorizer/resource";
import { schema } from "./schema";

export type { Schema } from "./schema";

export const data = defineData({
  name: "PapyrusCmsApi",
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
    lambdaAuthorizationMode: {
      function: graphqlJwtAuthorizer,
      timeToLiveInSeconds: 300,
    },
  },
});

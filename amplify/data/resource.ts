import { defineData } from "@aws-amplify/backend";
import { graphqlJwtAuthorizer } from "../functions/graphql-jwt-authorizer/resource";
import { schema } from "./schema";

// Keep handler typings permissive while Threat Intelligence uses the lean deploy schema.
export type Schema = any;

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

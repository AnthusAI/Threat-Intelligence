import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { graphqlJwtAuthorizer } from "./functions/graphql-jwt-authorizer/resource";
import { storage } from "./storage/resource";

defineBackend({
  auth,
  data,
  graphqlJwtAuthorizer,
  storage,
});

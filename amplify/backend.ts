import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { curationAction } from "./functions/curation-action/resource";
import { graphqlJwtAuthorizer } from "./functions/graphql-jwt-authorizer/resource";
import { manageUserRole } from "./functions/manage-user-role/resource";
import { storage } from "./storage/resource";

defineBackend({
  auth,
  curationAction,
  data,
  graphqlJwtAuthorizer,
  manageUserRole,
  storage,
});

import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { categoryAction } from "./functions/category-action/resource";
import { graphqlJwtAuthorizer } from "./functions/graphql-jwt-authorizer/resource";
import { manageUserRole } from "./functions/manage-user-role/resource";
import { storage } from "./storage/resource";

defineBackend({
  auth,
  categoryAction,
  data,
  graphqlJwtAuthorizer,
  manageUserRole,
  storage,
});

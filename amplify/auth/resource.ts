import { defineAuth, secret } from "@aws-amplify/backend";
import { manageUserRole } from "../functions/manage-user-role/resource";

const authRedirectUrls = [
  "http://localhost:3001/",
  "http://localhost:3000/",
  "https://p.apyr.us/",
  "https://main.dbsyytcm9drqa.amplifyapp.com/",
];

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret("GOOGLE_CLIENT_ID"),
        clientSecret: secret("GOOGLE_CLIENT_SECRET"),
        scopes: ["email", "profile", "openid"],
      },
      scopes: ["EMAIL", "PROFILE", "OPENID"],
      callbackUrls: authRedirectUrls,
      logoutUrls: authRedirectUrls,
    },
  },
  groups: ["admin", "editor", "curator"],
  access: (allow) => [
    allow.resource(manageUserRole).to(["addUserToGroup", "removeUserFromGroup", "listUsers", "listGroupsForUser"]),
  ],
});

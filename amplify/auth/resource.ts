import { defineAuth, secret } from "@aws-amplify/backend";

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
        attributeMapping: {
          email: "email",
        },
      },
      scopes: ["EMAIL", "PROFILE", "OPENID"],
      callbackUrls: authRedirectUrls,
      logoutUrls: authRedirectUrls,
    },
  },
  groups: ["editor"],
});

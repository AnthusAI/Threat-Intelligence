import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "papyrusMedia",
  isDefault: true,
  access: (allow) => ({
    "media/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
      allow.groups(["editor"]).to(["read", "write", "delete"]),
    ],
  }),
});

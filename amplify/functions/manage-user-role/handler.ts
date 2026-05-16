import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Schema } from "../../data/resource";

const MANAGED_ROLES = new Set(["admin", "editor", "curator"]);

type GrantHandler = Schema["grantUserRole"]["functionHandler"];
type RevokeHandler = Schema["revokeUserRole"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

export const handler: GrantHandler | RevokeHandler = async (event) => {
  const operation = event.info.fieldName;
  const userSub = normalizeRequiredString(event.arguments.userSub, "userSub");
  const role = normalizeRole(event.arguments.role);
  const userPoolId = getUserPoolId();

  const username = await findUsernameBySub(userPoolId, userSub);

  if (operation === "grantUserRole") {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: role,
      }),
    );
  } else if (operation === "revokeUserRole") {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: role,
      }),
    );
  } else {
    throw new Error(`Unsupported role operation ${operation}.`);
  }

  const groups = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }),
  );

  return {
    ok: true,
    userSub,
    username,
    role,
    activeRoles: groups.Groups?.map((group) => group.GroupName).filter(isString).sort() ?? [],
  };
};

async function findUsernameBySub(userPoolId: string, userSub: string): Promise<string> {
  const response = await cognito.send(
    new ListUsersCommand({
      Filter: `sub = "${userSub.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`,
      Limit: 1,
      UserPoolId: userPoolId,
    }),
  );

  const username = response.Users?.[0]?.Username;
  if (!username) throw new Error(`No Cognito user found for sub ${userSub}.`);
  return username;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function normalizeRole(value: unknown): string {
  const role = normalizeRequiredString(value, "role").toLowerCase();
  if (!MANAGED_ROLES.has(role)) {
    throw new Error(`Role ${role} is not managed by Papyrus.`);
  }
  return role;
}

function getUserPoolId(): string {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("AMPLIFY_AUTH_USERPOOL_ID is not configured.");
  return userPoolId;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

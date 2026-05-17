import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

const MANAGED_ROLES = new Set(["admin", "editor", "curator"]);
const ACTIVE_IDENTITY_STATUS = "active";
const ACTIVE_ROLE_STATUS = "active";
const REVOKED_ROLE_STATUS = "revoked";

type GrantHandler = Schema["grantUserRole"]["functionHandler"];
type RevokeHandler = Schema["revokeUserRole"]["functionHandler"];
type DirectoryHandler = Schema["listUserDirectory"]["functionHandler"];
type MergeHandler = Schema["mergeUserProfiles"]["functionHandler"];
type RoleFunctionEvent = (
  | Parameters<GrantHandler>[0]
  | Parameters<RevokeHandler>[0]
  | Parameters<DirectoryHandler>[0]
  | Parameters<MergeHandler>[0]
) & {
  fieldName?: string | null;
  info?: { fieldName?: string | null } | null;
};
type DataClient = ReturnType<typeof generateClient<Schema>>;
type DataClientErrors = Array<{ message?: string | null } | string | null> | null | undefined;
type DataClientResult<T = unknown> = {
  data?: T | null;
  errors?: DataClientErrors;
  nextToken?: string | null;
};

type UserProfileRecord = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  status?: string | null;
  mergedIntoProfileId?: string | null;
  mergedAt?: string | null;
  mergedBy?: string | null;
  mergeReason?: string | null;
};

type UserIdentityRecord = {
  id: string;
  userProfileId: string;
  cognitoSub: string;
  provider?: string | null;
  email?: string | null;
  status: string;
  linkedAt: string;
  lastSeenAt?: string | null;
};

type UserRoleAssignmentRecord = {
  id: string;
  userProfileId: string;
  userSub?: string | null;
  email?: string | null;
  role: string;
  status: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt?: string | null;
  notes?: string | null;
};

type CognitoDirectoryUser = {
  userSub: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
  provider?: string | null;
  enabled?: boolean | null;
  cognitoStatus?: string | null;
  activeRoles: string[];
};

const cognito = new CognitoIdentityProviderClient();
let clientPromise: Promise<DataClient> | null = null;

export const handler = async (event: RoleFunctionEvent) => {
  const operation = getOperationName(event);
  if (operation === "listUserDirectory") return listUserDirectory();
  if (operation === "mergeUserProfiles") return mergeUserProfiles(event as Parameters<MergeHandler>[0]);
  if (operation === "grantUserRole" || operation === "revokeUserRole") {
    return updateUserRole(event as Parameters<GrantHandler>[0] | Parameters<RevokeHandler>[0], operation);
  }
  throw new Error(`Unsupported role operation ${operation}.`);
};

function getOperationName(event: RoleFunctionEvent): string {
  const operation = normalizeOptionalString(event.info?.fieldName) ?? normalizeOptionalString(event.fieldName);
  if (!operation) throw new Error("Role operation event did not include a field name.");
  return operation;
}

async function listUserDirectory() {
  const { entries, profiles, identities, cognitoUsers } = await loadUserDirectorySnapshot();
  return {
    entries,
    profileCount: profiles.length,
    identityCount: identities.length,
    cognitoUserCount: cognitoUsers.length,
  };
}

async function loadUserDirectorySnapshot() {
  const client = await getDataClient();
  const userPoolId = getUserPoolId();
  const [profiles, identities, assignments, cognitoUsers] = await Promise.all([
    listDataRecords<UserProfileRecord>(client.models.UserProfile),
    listDataRecords<UserIdentityRecord>(client.models.UserIdentity),
    listDataRecords<UserRoleAssignmentRecord>(client.models.UserRoleAssignment),
    listCognitoUsers(userPoolId),
  ]);

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeProfiles = profiles.filter((profile) => (profile.status ?? ACTIVE_IDENTITY_STATUS) !== "merged");
  const identitiesBySub = new Map(identities.map((identity) => [identity.cognitoSub, identity]));
  const identitiesByProfile = groupBy(identities, (identity) => identity.userProfileId);
  const assignmentsByProfile = groupBy(assignments, (assignment) => assignment.userProfileId);
  const cognitoUsersBySub = new Map(cognitoUsers.map((user) => [user.userSub, user]));
  const entries = [];
  const seenCognitoSubs = new Set<string>();

  for (const profile of activeProfiles) {
    const profileIdentities = identitiesByProfile.get(profile.id) ?? [];
    const roleAssignments = assignmentsByProfile.get(profile.id) ?? [];
    const profileCognitoUsers = compactStrings(profileIdentities.map((identity) => identity.cognitoSub))
      .map((sub) => cognitoUsersBySub.get(sub))
      .filter(isDefined);
    for (const user of profileCognitoUsers) seenCognitoSubs.add(user.userSub);
    const primaryCognito = profileCognitoUsers[0] ?? null;
    const primaryIdentity = profileIdentities[0] ?? null;
    entries.push({
      userProfileId: profile.id,
      userSub: primaryCognito?.userSub ?? primaryIdentity?.cognitoSub ?? null,
      username: primaryCognito?.username ?? null,
      email: profile.email ?? primaryIdentity?.email ?? primaryCognito?.email ?? null,
      displayName: profile.displayName ?? profile.email ?? primaryCognito?.displayName ?? primaryCognito?.email ?? profile.id,
      provider: primaryIdentity?.provider ?? primaryCognito?.provider ?? null,
      enabled: profileCognitoUsers.some((user) => user.enabled === true) || null,
      cognitoStatus: compactStrings(profileCognitoUsers.map((user) => user.cognitoStatus)).join(" / ") || null,
      profileStatus: profile.status ?? ACTIVE_IDENTITY_STATUS,
      mergedIntoProfileId: profile.mergedIntoProfileId ?? null,
      identityStatus: primaryIdentity?.status ?? null,
      activeRoles: mergeRoles(activeAssignmentRoles(roleAssignments), ...profileCognitoUsers.map((user) => user.activeRoles)),
      identities: profileIdentities.map(identitySnapshot),
    });
  }

  for (const cognitoUser of cognitoUsers) {
    if (seenCognitoSubs.has(cognitoUser.userSub)) continue;
    const identity = identitiesBySub.get(cognitoUser.userSub);
    const profile = identity ? profilesById.get(identity.userProfileId) : null;
    const profileIdentities = profile?.id ? identitiesByProfile.get(profile.id) ?? [] : identity ? [identity] : [];
    const roleAssignments = profile?.id ? assignmentsByProfile.get(profile.id) ?? [] : [];
    entries.push({
      userProfileId: profile?.id ?? identity?.userProfileId ?? null,
      userSub: cognitoUser.userSub,
      username: cognitoUser.username,
      email: profile?.email ?? identity?.email ?? cognitoUser.email ?? null,
      displayName: profile?.displayName ?? cognitoUser.displayName ?? cognitoUser.email ?? cognitoUser.username,
      provider: identity?.provider ?? cognitoUser.provider ?? null,
      enabled: cognitoUser.enabled ?? null,
      cognitoStatus: cognitoUser.cognitoStatus ?? null,
      profileStatus: profile?.status ?? null,
      mergedIntoProfileId: profile?.mergedIntoProfileId ?? null,
      identityStatus: identity?.status ?? null,
      activeRoles: mergeRoles(cognitoUser.activeRoles, activeAssignmentRoles(roleAssignments)),
      identities: profileIdentities.map(identitySnapshot),
    });
  }

  entries.sort((left, right) => String(left.displayName ?? left.email ?? left.userSub ?? "").localeCompare(String(right.displayName ?? right.email ?? right.userSub ?? "")));
  return { entries, profiles, identities, assignments, cognitoUsers };
}

async function updateUserRole(
  event: Parameters<GrantHandler>[0] | Parameters<RevokeHandler>[0],
  operation: "grantUserRole" | "revokeUserRole",
) {
  const client = await getDataClient();
  const userPoolId = getUserPoolId();
  const role = normalizeRole(event.arguments.role);
  const now = new Date().toISOString();
  const actor = getIdentityLabel(event) ?? "Papyrus admin";
  const target = await resolveRoleTarget(client, event.arguments);
  const cognitoTargets = await Promise.all(target.cognitoSubs.map((sub) => findCognitoUserBySub(userPoolId, sub)));

  for (const user of cognitoTargets) {
    if (operation === "grantUserRole") {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          GroupName: role,
        }),
      );
    } else {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          GroupName: role,
        }),
      );
    }
  }

  if (target.profileId) {
    await upsertRoleAssignment(client, {
      operation,
      userProfileId: target.profileId,
      userSub: target.cognitoSubs[0] ?? null,
      email: target.email ?? cognitoTargets[0]?.email ?? null,
      role,
      actor,
      now,
    });
  }

  const refreshedGroups = await Promise.all(
    cognitoTargets.map((user) => listGroupsForUsername(userPoolId, user.username)),
  );
  const activeRoles = mergeRoles(...refreshedGroups);

  return {
    ok: true,
    userProfileId: target.profileId ?? null,
    userSub: target.cognitoSubs[0] ?? null,
    username: cognitoTargets[0]?.username ?? null,
    role,
    userSubs: target.cognitoSubs,
    usernames: cognitoTargets.map((user) => user.username),
    activeRoles,
  };
}

async function mergeUserProfiles(event: Parameters<MergeHandler>[0]) {
  const client = await getDataClient();
  const userPoolId = getUserPoolId();
  const now = new Date().toISOString();
  const actor = getIdentityLabel(event) ?? "Papyrus admin";
  const requestedTargetProfileId = normalizeOptionalString(event.arguments.targetUserProfileId);
  const requestedTargetSub = normalizeOptionalString((event.arguments as { targetUserSub?: string | null }).targetUserSub);
  const requestedSourceProfileId = normalizeOptionalString(event.arguments.sourceUserProfileId);
  const requestedSourceSub = normalizeOptionalString(event.arguments.sourceUserSub);
  const reason = normalizeOptionalString(event.arguments.reason);
  if (!requestedTargetProfileId && !requestedTargetSub) {
    throw new Error("targetUserProfileId or targetUserSub is required.");
  }
  if (!requestedSourceProfileId && !requestedSourceSub) {
    throw new Error("sourceUserProfileId or sourceUserSub is required.");
  }

  const [profiles, identities, assignments] = await Promise.all([
    listDataRecords<UserProfileRecord>(client.models.UserProfile),
    listDataRecords<UserIdentityRecord>(client.models.UserIdentity),
    listDataRecords<UserRoleAssignmentRecord>(client.models.UserRoleAssignment),
  ]);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const targetProfileId = await ensureMergeTargetProfile(client, {
    userPoolId,
    now,
    requestedTargetProfileId,
    requestedTargetSub,
    profilesById,
    identities,
  });
  const targetProfile = profilesById.get(targetProfileId)
    ?? (await getDataRecord<UserProfileRecord>(client.models.UserProfile, targetProfileId, "Target UserProfile"));
  if (!targetProfile) throw new Error(`Target profile ${targetProfileId} was not found.`);
  if ((targetProfile.status ?? ACTIVE_IDENTITY_STATUS) === "merged") {
    throw new Error(`Target profile ${targetProfileId} is already merged.`);
  }

  const existingSourceIdentity = requestedSourceSub ? identities.find((identity) => identity.cognitoSub === requestedSourceSub) : undefined;
  const sourceProfileId = requestedSourceProfileId ?? existingSourceIdentity?.userProfileId ?? null;
  if (sourceProfileId && sourceProfileId === targetProfileId) {
    throw new Error("Source and target profiles must be different.");
  }
  const sourceProfile = sourceProfileId ? profilesById.get(sourceProfileId) : null;
  if (sourceProfileId && !sourceProfile) throw new Error(`Source profile ${sourceProfileId} was not found.`);

  const sourceIdentities = sourceProfileId
    ? identities.filter((identity) => identity.userProfileId === sourceProfileId)
    : [];
  const identitiesToMove = uniqueBy(
    [...sourceIdentities, ...(existingSourceIdentity ? [existingSourceIdentity] : [])],
    (identity) => identity.id,
  );

  if (!identitiesToMove.length && requestedSourceSub) {
    const cognitoUser = await findCognitoUserBySub(userPoolId, requestedSourceSub);
    await requireDataResult(
      client.models.UserIdentity.create({
        id: `user-identity-${safeId(requestedSourceSub)}-${randomUUID().slice(0, 8)}`,
        userProfileId: targetProfileId,
        cognitoSub: requestedSourceSub,
        provider: cognitoUser.provider ?? null,
        email: cognitoUser.email ?? null,
        status: ACTIVE_IDENTITY_STATUS,
        linkedAt: now,
        lastSeenAt: now,
      }),
      "create merged UserIdentity",
    );
  } else {
    await Promise.all(identitiesToMove.map((identity) =>
      requireDataResult(
        client.models.UserIdentity.update({
          id: identity.id,
          userProfileId: targetProfileId,
          status: identity.status || ACTIVE_IDENTITY_STATUS,
          lastSeenAt: now,
        }),
        "move UserIdentity",
      ),
    ));
  }

  const targetAssignments = assignments.filter((assignment) => assignment.userProfileId === targetProfileId);
  const sourceAssignments = sourceProfileId ? assignments.filter((assignment) => assignment.userProfileId === sourceProfileId) : [];
  const sourceActiveRoles = activeAssignmentRoles(sourceAssignments);
  const targetActiveRoles = activeAssignmentRoles(targetAssignments);
  const movedCognitoSubs = compactStrings([
    ...identitiesToMove.map((identity) => identity.cognitoSub),
    requestedSourceSub,
    ...identities.filter((identity) => identity.userProfileId === targetProfileId).map((identity) => identity.cognitoSub),
  ]);
  const movedCognitoUsers = await Promise.all(movedCognitoSubs.map((sub) => findCognitoUserBySub(userPoolId, sub)));
  const targetRoleUnion = mergeRoles(sourceActiveRoles, targetActiveRoles, ...movedCognitoUsers.map((user) => user.activeRoles));
  const primaryTargetSub = movedCognitoSubs[0] ?? null;
  const primaryTargetEmail = movedCognitoUsers[0]?.email ?? null;

  await Promise.all(targetRoleUnion.map((role) =>
    upsertRoleAssignment(client, {
      operation: "grantUserRole",
      userProfileId: targetProfileId,
      userSub: primaryTargetSub,
      email: primaryTargetEmail,
      role,
      actor,
      now,
    }),
  ));

  await Promise.all(sourceAssignments.filter((assignment) => assignment.status === ACTIVE_ROLE_STATUS).map((assignment) =>
    requireDataResult(
      client.models.UserRoleAssignment.update({
        id: assignment.id,
        status: REVOKED_ROLE_STATUS,
        revokedAt: now,
        notes: `Merged into ${targetProfileId}${assignment.notes ? `; ${assignment.notes}` : ""}`,
      }),
      "archive source UserRoleAssignment",
    ),
  ));

  if (sourceProfile) {
    await requireDataResult(
      client.models.UserProfile.update({
        id: sourceProfile.id,
        status: "merged",
        mergedIntoProfileId: targetProfileId,
        mergedAt: now,
        mergedBy: actor,
        mergeReason: reason,
        updatedAt: now,
      }),
      "archive source UserProfile",
    );
  }

  await mirrorRolesToCognitoUsers(userPoolId, movedCognitoUsers, targetRoleUnion);

  const snapshot = await loadUserDirectorySnapshot();
  const targetEntry = snapshot.entries.find((entry) => entry.userProfileId === targetProfileId);
  if (!targetEntry) throw new Error(`Merged target profile ${targetProfileId} was not returned by the directory.`);
  return targetEntry;
}

async function ensureMergeTargetProfile(
  client: DataClient,
  input: {
    userPoolId: string;
    now: string;
    requestedTargetProfileId: string | null;
    requestedTargetSub: string | null;
    profilesById: Map<string, UserProfileRecord>;
    identities: UserIdentityRecord[];
  },
): Promise<string> {
  if (input.requestedTargetProfileId) {
    if (!input.profilesById.has(input.requestedTargetProfileId)) {
      throw new Error(`Target profile ${input.requestedTargetProfileId} was not found.`);
    }
    return input.requestedTargetProfileId;
  }

  const targetSub = input.requestedTargetSub;
  if (!targetSub) throw new Error("targetUserProfileId or targetUserSub is required.");
  const existingIdentity = input.identities.find((identity) => identity.cognitoSub === targetSub);
  if (existingIdentity) {
    if (!input.profilesById.has(existingIdentity.userProfileId)) {
      throw new Error(`Target profile ${existingIdentity.userProfileId} was not found.`);
    }
    return existingIdentity.userProfileId;
  }

  const cognitoUser = await findCognitoUserBySub(input.userPoolId, targetSub);
  const profileId = `user-profile-${safeId(targetSub)}`;
  if (!input.profilesById.has(profileId)) {
    await requireDataResult(
      client.models.UserProfile.create({
        id: profileId,
        email: cognitoUser.email ?? null,
        displayName: cognitoUser.displayName ?? cognitoUser.email ?? cognitoUser.username,
        status: ACTIVE_IDENTITY_STATUS,
        createdAt: input.now,
        updatedAt: input.now,
      }),
      "create target UserProfile",
    );
  }
  await requireDataResult(
    client.models.UserIdentity.create({
      id: `user-identity-${safeId(targetSub)}-${randomUUID().slice(0, 8)}`,
      userProfileId: profileId,
      cognitoSub: targetSub,
      provider: cognitoUser.provider ?? null,
      email: cognitoUser.email ?? null,
      status: ACTIVE_IDENTITY_STATUS,
      linkedAt: input.now,
      lastSeenAt: input.now,
    }),
    "create target UserIdentity",
  );
  return profileId;
}

async function resolveRoleTarget(
  client: DataClient,
  args: { userProfileId?: string | null; userSub?: string | null; cognitoSubs?: Array<string | null> | null },
): Promise<{ profileId: string | null; cognitoSubs: string[]; email?: string | null }> {
  const requestedProfileId = normalizeOptionalString(args.userProfileId);
  const requestedSubs = compactStrings([...(args.cognitoSubs ?? []), args.userSub]);
  const identities = await listDataRecords<UserIdentityRecord>(client.models.UserIdentity);

  if (requestedProfileId) {
    const profileIdentities = identities.filter((identity) => (
      identity.userProfileId === requestedProfileId && identity.status === ACTIVE_IDENTITY_STATUS
    ));
    const subs = compactStrings([...requestedSubs, ...profileIdentities.map((identity) => identity.cognitoSub)]);
    return {
      profileId: requestedProfileId,
      cognitoSubs: uniqueStrings(subs),
      email: profileIdentities[0]?.email ?? null,
    };
  }

  const firstRequestedSub = requestedSubs[0];
  if (!firstRequestedSub) throw new Error("userProfileId or userSub is required.");
  const existingIdentity = identities.find((identity) => identity.cognitoSub === firstRequestedSub);
  if (existingIdentity) {
    const profileIdentities = identities.filter((identity) => (
      identity.userProfileId === existingIdentity.userProfileId && identity.status === ACTIVE_IDENTITY_STATUS
    ));
    return {
      profileId: existingIdentity.userProfileId,
      cognitoSubs: uniqueStrings([...requestedSubs, ...profileIdentities.map((identity) => identity.cognitoSub)]),
      email: existingIdentity.email ?? null,
    };
  }

  const cognitoUser = await findCognitoUserBySub(getUserPoolId(), firstRequestedSub);
  const profileId = `user-profile-${safeId(firstRequestedSub)}`;
  const linkedAt = new Date().toISOString();
  await requireDataResult(
    client.models.UserProfile.create({
      id: profileId,
      email: cognitoUser.email ?? null,
      displayName: cognitoUser.displayName ?? cognitoUser.email ?? cognitoUser.username,
      createdAt: linkedAt,
      updatedAt: linkedAt,
    }),
    "create UserProfile",
  );
  await requireDataResult(
    client.models.UserIdentity.create({
      id: `user-identity-${safeId(firstRequestedSub)}-${randomUUID().slice(0, 8)}`,
      userProfileId: profileId,
      cognitoSub: firstRequestedSub,
      provider: cognitoUser.provider ?? null,
      email: cognitoUser.email ?? null,
      status: ACTIVE_IDENTITY_STATUS,
      linkedAt,
      lastSeenAt: linkedAt,
    }),
    "create UserIdentity",
  );
  return {
    profileId,
    cognitoSubs: uniqueStrings(requestedSubs),
    email: cognitoUser.email ?? null,
  };
}

async function upsertRoleAssignment(
  client: DataClient,
  input: {
    operation: "grantUserRole" | "revokeUserRole";
    userProfileId: string;
    userSub: string | null;
    email: string | null;
    role: string;
    actor: string;
    now: string;
  },
): Promise<void> {
  const id = `user-role-${safeId(input.userProfileId)}-${safeId(input.role)}`;
  const existing = await client.models.UserRoleAssignment.get({ id });
  assertNoDataErrors(existing.errors, "get UserRoleAssignment");

  if (existing.data) {
    await requireDataResult(
      client.models.UserRoleAssignment.update({
        id,
        userSub: input.userSub,
        email: input.email,
        status: input.operation === "grantUserRole" ? ACTIVE_ROLE_STATUS : REVOKED_ROLE_STATUS,
        grantedBy: input.operation === "grantUserRole" ? input.actor : existing.data.grantedBy,
        grantedAt: input.operation === "grantUserRole" ? input.now : existing.data.grantedAt,
        revokedAt: input.operation === "revokeUserRole" ? input.now : null,
      }),
      "update UserRoleAssignment",
    );
    return;
  }

  await requireDataResult(
    client.models.UserRoleAssignment.create({
      id,
      userProfileId: input.userProfileId,
      userSub: input.userSub,
      email: input.email,
      role: input.role,
      status: input.operation === "grantUserRole" ? ACTIVE_ROLE_STATUS : REVOKED_ROLE_STATUS,
      grantedBy: input.actor,
      grantedAt: input.now,
      revokedAt: input.operation === "revokeUserRole" ? input.now : null,
      notes: "Managed by Papyrus News Desk",
    }),
    "create UserRoleAssignment",
  );
}

async function listCognitoUsers(userPoolId: string): Promise<CognitoDirectoryUser[]> {
  const users: CognitoDirectoryUser[] = [];
  let paginationToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of page.Users ?? []) {
      const username = user.Username;
      const sub = readCognitoAttribute(user.Attributes, "sub");
      if (!username || !sub) continue;
      users.push({
        userSub: sub,
        username,
        email: readCognitoAttribute(user.Attributes, "email"),
        displayName: readCognitoAttribute(user.Attributes, "name"),
        provider: readCognitoAttribute(user.Attributes, "identities") ? "federated" : "cognito",
        enabled: user.Enabled ?? null,
        cognitoStatus: user.UserStatus ?? null,
        activeRoles: await listGroupsForUsername(userPoolId, username),
      });
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);
  return users;
}

async function findCognitoUserBySub(userPoolId: string, userSub: string): Promise<CognitoDirectoryUser> {
  const response = await cognito.send(
    new ListUsersCommand({
      Filter: `sub = "${userSub.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`,
      Limit: 1,
      UserPoolId: userPoolId,
    }),
  );
  const user = response.Users?.[0];
  const username = user?.Username;
  const sub = readCognitoAttribute(user?.Attributes, "sub");
  if (!user || !username || !sub) throw new Error(`No Cognito user found for sub ${userSub}.`);
  return {
    userSub: sub,
    username,
    email: readCognitoAttribute(user.Attributes, "email"),
    displayName: readCognitoAttribute(user.Attributes, "name"),
    provider: readCognitoAttribute(user.Attributes, "identities") ? "federated" : "cognito",
    enabled: user.Enabled ?? null,
    cognitoStatus: user.UserStatus ?? null,
    activeRoles: await listGroupsForUsername(userPoolId, username),
  };
}

async function listGroupsForUsername(userPoolId: string, username: string): Promise<string[]> {
  const groups = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }),
  );
  return groups.Groups?.map((group) => group.GroupName).filter(isString).sort() ?? [];
}

async function getDataClient(): Promise<DataClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as never);
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>();
    })();
  }
  return clientPromise;
}

async function listDataRecords<T>(model: { list(input?: Record<string, unknown>): Promise<DataClientResult<T[]>> }): Promise<T[]> {
  const records: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await model.list({ limit: 100, nextToken });
    assertNoDataErrors(page.errors, "list records");
    records.push(...((page.data ?? []).filter(Boolean) as T[]));
    nextToken = page.nextToken;
  } while (nextToken);
  return records;
}

async function getDataRecord<T>(
  model: { get(input: { id: string }): Promise<DataClientResult<T>> },
  id: string,
  operation: string,
): Promise<T | null> {
  const response = await model.get({ id });
  assertNoDataErrors(response.errors, operation);
  return response.data ?? null;
}

async function requireDataResult<T>(promise: Promise<DataClientResult<T>>, operation: string): Promise<T> {
  const response = await promise;
  assertNoDataErrors(response.errors, operation);
  if (!response.data) throw new Error(`${operation} returned no data.`);
  return response.data;
}

function assertNoDataErrors(errors: DataClientErrors, operation: string): void {
  if (!errors?.length) return;
  throw new Error(`${operation} failed: ${errors.map(formatDataError).join("; ")}`);
}

function formatDataError(error: { message?: string | null } | string | null): string {
  if (typeof error === "string") return error;
  return error?.message ?? "GraphQL data operation failed.";
}

function activeAssignmentRoles(assignments: UserRoleAssignmentRecord[]): string[] {
  return assignments.filter((assignment) => assignment.status === ACTIVE_ROLE_STATUS).map((assignment) => assignment.role).sort();
}

function identitySnapshot(identity: UserIdentityRecord) {
  return {
    id: identity.id,
    userProfileId: identity.userProfileId,
    cognitoSub: identity.cognitoSub,
    provider: identity.provider ?? null,
    email: identity.email ?? null,
    status: identity.status,
    linkedAt: identity.linkedAt,
    lastSeenAt: identity.lastSeenAt ?? null,
  };
}

function mergeRoles(...roleSets: string[][]): string[] {
  return uniqueStrings(roleSets.flat().filter((role) => MANAGED_ROLES.has(role)));
}

async function mirrorRolesToCognitoUsers(userPoolId: string, users: CognitoDirectoryUser[], roles: string[]): Promise<void> {
  await Promise.all(users.flatMap((user) =>
    roles.filter((role) => !user.activeRoles.includes(role)).map((role) =>
      cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          GroupName: role,
        }),
      ),
    ),
  ));
}

function readCognitoAttribute(
  attributes: Array<{ Name?: string | null; Value?: string | null }> | undefined,
  name: string,
): string | null {
  const value = attributes?.find((attribute) => attribute.Name === name)?.Value;
  return normalizeOptionalString(value);
}

function normalizeRole(value: unknown): string {
  const role = normalizeRequiredString(value, "role").toLowerCase();
  if (!MANAGED_ROLES.has(role)) {
    throw new Error(`Role ${role} is not managed by Papyrus.`);
  }
  return role;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getIdentityLabel(event: Parameters<GrantHandler>[0] | Parameters<RevokeHandler>[0] | Parameters<MergeHandler>[0]): string | null {
  const claims = event.identity && "claims" in event.identity ? event.identity.claims : null;
  return normalizeOptionalString(claims?.email)
    ?? normalizeOptionalString(claims?.name)
    ?? normalizeOptionalString(claims?.username)
    ?? normalizeOptionalString(claims?.sub);
}

function getUserPoolId(): string {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("AMPLIFY_AUTH_USERPOOL_ID is not configured.");
  return userPoolId;
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.map((value) => normalizeOptionalString(value)).filter(isString);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

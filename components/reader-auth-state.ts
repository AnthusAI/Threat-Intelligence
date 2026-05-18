"use client";

import { fetchAuthSession } from "aws-amplify/auth";
import { configureAmplifyClient } from "./amplify-client-provider";

export type ReaderAuthSnapshot =
  | { status: "loading"; label: string }
  | { status: "signedOut"; label: string }
  | { status: "signedIn"; label: string };

export type ReaderSessionSnapshot = {
  auth: ReaderAuthSnapshot;
  groups: string[];
  hasSession: boolean;
};

export async function loadReaderSessionSnapshot(): Promise<ReaderSessionSnapshot> {
  configureAmplifyClient();
  try {
    const session = await fetchAuthSession();
    const accessPayload = session.tokens?.accessToken?.payload ?? {};
    const idPayload = session.tokens?.idToken?.payload ?? {};
    const groups = [
      ...readGroups(accessPayload["cognito:groups"]),
      ...readGroups(idPayload["cognito:groups"]),
    ];
    const label = readIdentityLabel({
      email: idPayload.email ?? accessPayload.email,
      name: idPayload.name ?? accessPayload.name,
      username: idPayload["cognito:username"] ?? accessPayload["cognito:username"] ?? accessPayload.username,
      sub: idPayload.sub ?? accessPayload.sub,
    });

    if (!session.tokens?.accessToken) {
      return {
        auth: { status: "signedOut", label: "Signed out" },
        groups,
        hasSession: false,
      };
    }

    return {
      auth: { status: "signedIn", label },
      groups,
      hasSession: true,
    };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return {
        auth: { status: "signedOut", label: "Signed out" },
        groups: [],
        hasSession: false,
      };
    }
    throw error;
  }
}

export function isUnauthenticatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unauth|not authenticated|no current user|not signed in/i.test(message);
}

function readIdentityLabel(claims: {
  email: unknown;
  name: unknown;
  username: unknown;
  sub: unknown;
}): string {
  return readTextClaim(claims.email)
    ?? readTextClaim(claims.name)
    ?? readTextClaim(claims.username)
    ?? readTextClaim(claims.sub)
    ?? "Signed in";
}

function readTextClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}

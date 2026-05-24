"use client";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import { configureAmplifyClient } from "../components/amplify-client-provider";

const USER_POOL_AUTH_MODE = "userPool";

const CONSOLE_THREAD_FIELDS = `
  id
  threadKind
  status
  title
  summary
  primaryAnchorKind
  primaryAnchorId
  primaryAnchorLineageId
  primaryAnchorKey
  createdByLabel
  messageCount
  lastMessageId
  lastMessageAt
  contextDigest
  metadata
  createdAt
  updatedAt
  newsroomFeedKey
`;

const CONSOLE_MESSAGE_FIELDS = `
  id
  threadId
  parentMessageId
  sequenceNumber
  role
  messageKind
  messageType
  content
  summary
  responseStatus
  responseOwner
  responseStartedAt
  responseCompletedAt
  responseError
  createdAt
  updatedAt
`;

const LIST_CONSOLE_THREADS_BY_KIND = `
  query ListMessageThreadsByKindAndUpdatedAt(
    $threadKind: String!
    $sortDirection: ModelSortDirection
    $limit: Int
  ) {
    listMessageThreadsByKindAndUpdatedAt(
      threadKind: $threadKind
      sortDirection: $sortDirection
      limit: $limit
    ) {
      items {
        ${CONSOLE_THREAD_FIELDS}
      }
    }
  }
`;

const LIST_CONSOLE_THREAD_BY_ANCHOR = `
  query ListMessageThreadsByAnchorAndUpdatedAt(
    $primaryAnchorKey: String!
    $sortDirection: ModelSortDirection
    $limit: Int
  ) {
    listMessageThreadsByAnchorAndUpdatedAt(
      primaryAnchorKey: $primaryAnchorKey
      sortDirection: $sortDirection
      limit: $limit
    ) {
      items {
        ${CONSOLE_THREAD_FIELDS}
      }
    }
  }
`;

const LIST_CONSOLE_MESSAGES_BY_THREAD = `
  query ListMessagesByThreadAndSequence(
    $threadId: ID!
    $sortDirection: ModelSortDirection
    $limit: Int
  ) {
    listMessagesByThreadAndSequence(
      threadId: $threadId
      sortDirection: $sortDirection
      limit: $limit
    ) {
      items {
        ${CONSOLE_MESSAGE_FIELDS}
      }
    }
  }
`;

const CREATE_CONSOLE_THREAD = `
  mutation CreateMessageThread($input: CreateMessageThreadInput!) {
    createMessageThread(input: $input) {
      ${CONSOLE_THREAD_FIELDS}
    }
  }
`;

const UPDATE_CONSOLE_THREAD = `
  mutation UpdateMessageThread($input: UpdateMessageThreadInput!) {
    updateMessageThread(input: $input) {
      ${CONSOLE_THREAD_FIELDS}
    }
  }
`;

const CREATE_CONSOLE_MESSAGE = `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      ${CONSOLE_MESSAGE_FIELDS}
    }
  }
`;

export type ConsoleChatThread = {
  id: string;
  threadKind: string;
  status: string;
  title: string;
  summary?: string | null;
  primaryAnchorKind?: string | null;
  primaryAnchorId?: string | null;
  primaryAnchorLineageId?: string | null;
  primaryAnchorKey?: string | null;
  createdByLabel?: string | null;
  messageCount?: number | null;
  lastMessageId?: string | null;
  lastMessageAt?: string | null;
  contextDigest?: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
  newsroomFeedKey?: string | null;
};

export type ConsoleChatMessage = {
  id: string;
  threadId?: string | null;
  parentMessageId?: string | null;
  sequenceNumber?: number | null;
  role?: string | null;
  messageKind?: string | null;
  messageType?: string | null;
  content?: string | null;
  summary?: string | null;
  responseStatus?: string | null;
  responseOwner?: string | null;
  responseStartedAt?: string | null;
  responseCompletedAt?: string | null;
  responseError?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};

type GraphQLClient = {
  graphql: (options: {
    query: string;
    variables?: Record<string, unknown>;
    authMode?: typeof USER_POOL_AUTH_MODE;
  }) => Promise<{
    data?: Record<string, unknown> | null;
    errors?: Array<{ message?: string | null; errorType?: string | null } | string | null> | null;
  }>;
};

function getGraphQLClient(): GraphQLClient {
  configureAmplifyClient();
  return generateClient<Schema>() as unknown as GraphQLClient;
}

function formatGraphQLError(error: { message?: string | null; errorType?: string | null } | string | null): string {
  if (typeof error === "string") return error;
  if (!error) return "Unknown GraphQL error";
  return [error.errorType, error.message].filter(Boolean).join(": ") || "Unknown GraphQL error";
}

function assertGraphQL<T>(response: {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string | null; errorType?: string | null } | string | null> | null;
}, field: string): T {
  if (response.errors?.length) {
    throw new Error(response.errors.map(formatGraphQLError).join("; "));
  }
  const value = response.data?.[field];
  if (value === undefined || value === null) {
    throw new Error(
      `Console chat API is unavailable (${field}). Regenerate amplify_outputs.json from the current backend or deploy the MessageThread schema.`,
    );
  }
  return value as T;
}

function readConnectionItems<T>(value: unknown): T[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items as T[] : [];
}

export async function listConsoleThreads(limit = 25): Promise<ConsoleChatThread[]> {
  const response = await getGraphQLClient().graphql({
    query: LIST_CONSOLE_THREADS_BY_KIND,
    variables: { threadKind: "console", sortDirection: "DESC", limit },
    authMode: USER_POOL_AUTH_MODE,
  });
  const connection = assertGraphQL<unknown>(response, "listMessageThreadsByKindAndUpdatedAt");
  return readConnectionItems<ConsoleChatThread>(connection);
}

export async function listConsoleThreadByAnchor(primaryAnchorKey: string): Promise<ConsoleChatThread | null> {
  const response = await getGraphQLClient().graphql({
    query: LIST_CONSOLE_THREAD_BY_ANCHOR,
    variables: { primaryAnchorKey, sortDirection: "DESC", limit: 1 },
    authMode: USER_POOL_AUTH_MODE,
  });
  const connection = assertGraphQL<unknown>(response, "listMessageThreadsByAnchorAndUpdatedAt");
  return readConnectionItems<ConsoleChatThread>(connection)[0] ?? null;
}

export async function listConsoleMessagesByThread(threadId: string): Promise<ConsoleChatMessage[]> {
  const response = await getGraphQLClient().graphql({
    query: LIST_CONSOLE_MESSAGES_BY_THREAD,
    variables: { threadId, sortDirection: "ASC", limit: 100 },
    authMode: USER_POOL_AUTH_MODE,
  });
  const connection = assertGraphQL<unknown>(response, "listMessagesByThreadAndSequence");
  return readConnectionItems<ConsoleChatMessage>(connection);
}

export async function createConsoleThread(input: ConsoleChatThread): Promise<ConsoleChatThread> {
  const response = await getGraphQLClient().graphql({
    query: CREATE_CONSOLE_THREAD,
    variables: { input },
    authMode: USER_POOL_AUTH_MODE,
  });
  return assertGraphQL<ConsoleChatThread>(response, "createMessageThread");
}

export async function updateConsoleThread(input: Pick<ConsoleChatThread, "id"> & Partial<ConsoleChatThread>): Promise<ConsoleChatThread> {
  const response = await getGraphQLClient().graphql({
    query: UPDATE_CONSOLE_THREAD,
    variables: { input },
    authMode: USER_POOL_AUTH_MODE,
  });
  return assertGraphQL<ConsoleChatThread>(response, "updateMessageThread");
}

export type CreateConsoleMessageInput = ConsoleChatMessage & {
  messageDomain: string;
  status: string;
  source: string;
  authorLabel: string;
  semanticLayer: string;
  searchVisibility: string;
  responseTarget: string;
  metadata: string;
  updatedAt: string;
  newsroomFeedKey: string;
};

export async function createConsoleMessage(input: CreateConsoleMessageInput): Promise<ConsoleChatMessage> {
  const response = await getGraphQLClient().graphql({
    query: CREATE_CONSOLE_MESSAGE,
    variables: { input },
    authMode: USER_POOL_AUTH_MODE,
  });
  return assertGraphQL<ConsoleChatMessage>(response, "createMessage");
}

export function subscribeConsoleMessages(
  threadId: string,
  onMessage: (message: ConsoleChatMessage) => void,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  const fingerprints = new Map<string, string>();
  const pollMessages = async () => {
    try {
      const messages = await listConsoleMessagesByThread(threadId);
      if (!active) return;
      for (const message of messages) {
        const fingerprint = JSON.stringify([
          message.updatedAt,
          message.responseStatus,
          message.responseStartedAt,
          message.responseCompletedAt,
          message.responseError,
          message.content,
        ]);
        if (fingerprints.get(message.id) === fingerprint) continue;
        fingerprints.set(message.id, fingerprint);
        onMessage(message);
      }
    } catch (error) {
      onError?.(error);
    }
  };
  void pollMessages();
  const interval = window.setInterval(() => {
    void pollMessages();
  }, 2500);
  return () => {
    active = false;
    window.clearInterval(interval);
  };
}

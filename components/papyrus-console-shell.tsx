"use client";

import { generateClient } from "aws-amplify/data";
import { usePathname } from "next/navigation";
import type { Schema } from "../amplify/data/resource";
import { loadReaderSessionSnapshot, type ReaderSessionSnapshot } from "./reader-auth-state";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

const USER_POOL_AUTH_MODE = "userPool";
const CONSOLE_THREAD_ANCHOR_KEY = "site#papyrus";
const CONSOLE_NEWSROOM_FEED_KEY = "consoleChat";
const CONSOLE_MESSAGE_KIND = "console_chat_turn";
const CONSOLE_MESSAGE_DOMAIN = "conversation";
const CONSOLE_SEMANTIC_LAYER = "chat_detail";
const CONSOLE_SEARCH_VISIBILITY = "explicit";
const CONSOLE_RESPONSE_TARGET = process.env.NEXT_PUBLIC_PAPYRUS_CONSOLE_RESPONSE_TARGET?.trim() || "cloud";

type DataClient = ReturnType<typeof generateClient<Schema>>;
type GraphQLClient = {
  graphql: (options: {
    authMode?: typeof USER_POOL_AUTH_MODE;
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<{
    data?: Record<string, unknown> | null;
    errors?: Array<{ message?: string | null; errorType?: string | null } | string | null> | null;
  }>;
};

type ConsoleMessage = {
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
  responseError?: string | null;
  createdAt: string;
};

type ConsoleThread = {
  id: string;
  title: string;
  status: string;
  threadKind: string;
  contextDigest?: string | null;
  messageCount?: number | null;
  lastMessageId?: string | null;
  lastMessageAt?: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

type AmplifyResult<T> = {
  data?: T | null;
  errors?: Array<{ message?: string | null; errorType?: string | null } | string | null> | null;
};

type PapyrusConsoleShellProps = {
  children: ReactNode;
};

let dataClient: DataClient | null = null;
let graphqlClient: GraphQLClient | null = null;

function getClient(): DataClient {
  dataClient ??= generateClient<Schema>({ authMode: USER_POOL_AUTH_MODE });
  return dataClient;
}

function getGraphQLClient(): GraphQLClient {
  graphqlClient ??= generateClient<Schema>() as unknown as GraphQLClient;
  return graphqlClient;
}

export function PapyrusConsoleShell({ children }: PapyrusConsoleShellProps) {
  const pathname = usePathname();
  const [session, setSession] = useState<ReaderSessionSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const isNewsroomPath = pathname === "/newsroom" || pathname.startsWith("/newsroom/");
  const canUseConsole = Boolean(session?.hasSession && session.groups.some((group) => group === "editor" || group === "admin"));
  const shouldOfferConsole = isNewsroomPath && canUseConsole;

  useEffect(() => {
    let active = true;
    void loadReaderSessionSnapshot()
      .then((snapshot) => {
        if (active) setSession(snapshot);
      })
      .catch(() => {
        if (active) setSession({ auth: { status: "signedOut", label: "Signed out" }, groups: [], hasSession: false });
      });
    try {
      setOpen(window.localStorage.getItem("papyrus:console-open") === "true");
    } catch {
      setOpen(false);
    }
    return () => {
      active = false;
    };
  }, []);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("papyrus:console-open", String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  };

  return (
    <>
      <div className={canUseConsole && open ? "papyrus-console-page papyrus-console-page--open" : "papyrus-console-page"}>
        {children}
      </div>
      {shouldOfferConsole ? (
        <aside className={open ? "papyrus-console papyrus-console--open" : "papyrus-console"} aria-label="Papyrus console">
          <button className="papyrus-console__tab" onClick={toggleOpen} type="button" aria-expanded={open} aria-label={open ? "Close console" : "Open console"}>
            <MessagesSquareIcon />
          </button>
          {open ? (
            canUseConsole
              ? <ConsolePanel actorLabel={session?.auth.label ?? "Papyrus editor"} onClose={toggleOpen} />
              : <ConsoleAccessPanel onClose={toggleOpen} session={session} />
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function ConsoleAccessPanel({ onClose, session }: { onClose: () => void; session: ReaderSessionSnapshot | null }) {
  return (
    <div className="papyrus-console__panel papyrus-console__panel--access">
      <ConsolePanelHeader onClose={onClose} />
      <div className="papyrus-console__empty">
        <strong>Checking Newsroom credentials.</strong>
        <span>
          The Newsroom is visible, but this console is waiting for the client session groups.
          Refresh after the current deployment finishes if this does not resolve.
        </span>
        <span>Groups: {session?.groups.length ? session.groups.join(", ") : "none loaded"}</span>
      </div>
    </div>
  );
}

function ConsolePanel({ actorLabel, onClose }: { actorLabel: string; onClose: () => void }) {
  const [thread, setThread] = useState<ConsoleThread | null>(null);
  const [threads, setThreads] = useState<ConsoleThread[]>([]);
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  const hasLoadedRef = useRef(false);

  const sortedMessages = useMemo(() => (
    [...messages].sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt))
  ), [messages]);

  const loadMessages = useCallback(async (threadId: string) => {
    const response = await (getClient().models.Message.listMessagesByThreadAndSequence as never as (input: {
      threadId: string;
      sortDirection?: "ASC" | "DESC";
      limit?: number;
    }, options?: { authMode: typeof USER_POOL_AUTH_MODE }) => Promise<{ data?: ConsoleMessage[] | null }>)(
      { threadId, sortDirection: "ASC", limit: 100 },
      { authMode: USER_POOL_AUTH_MODE },
    );
    setMessages(Array.isArray(response.data) ? response.data : []);
  }, []);

  const loadThreads = useCallback(async () => {
    return listConsoleThreads(25);
  }, []);

  const loadThread = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setLoading(true);
    setError(null);
    try {
      const recentThreads = await loadThreads();
      const existingThread = thread && recentThreads.some((entry) => entry.id === thread.id)
        ? recentThreads.find((entry) => entry.id === thread.id) ?? thread
        : recentThreads[0] ?? null;
      setThreads(recentThreads);
      setThread(existingThread);
      if (existingThread) await loadMessages(existingThread.id);
    } catch (nextError) {
      console.error("[PapyrusConsole] Unable to load console thread", nextError);
      if (initialLoad) setError(nextError instanceof Error ? nextError.message : "Unable to load console thread.");
    } finally {
      hasLoadedRef.current = true;
      if (initialLoad) setLoading(false);
    }
  }, [loadMessages, loadThreads, thread]);

  useEffect(() => {
    loadRef.current = loadThread;
  }, [loadThread]);

  useEffect(() => {
    void loadThread();
    const interval = window.setInterval(() => {
      void loadRef.current();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [loadThread]);

  const selectThread = useCallback((threadId: string) => {
    const nextThread = threads.find((entry) => entry.id === threadId) ?? null;
    setThread(nextThread);
    setMessages([]);
    if (nextThread) void loadMessages(nextThread.id);
  }, [loadMessages, threads]);

  async function createNewThread(): Promise<ConsoleThread> {
    const now = new Date().toISOString();
    const nextThread: ConsoleThread = {
      id: `message-thread-console-${crypto.randomUUID()}`,
      threadKind: "console",
      status: "active",
      title: "Papyrus Console",
      summary: "General editor console thread for Papyrus.",
      primaryAnchorKind: "site",
      primaryAnchorId: "papyrus",
      primaryAnchorLineageId: "papyrus",
      primaryAnchorKey: CONSOLE_THREAD_ANCHOR_KEY,
      createdByLabel: actorLabel,
      messageCount: 0,
      metadata: toAwsJson({
        console: {
          cache: "lambda-tmp-jit",
          rawChatSearchVisibility: CONSOLE_SEARCH_VISIBILITY,
        },
      }),
      newsroomFeedKey: CONSOLE_NEWSROOM_FEED_KEY,
      createdAt: now,
      updatedAt: now,
    } as ConsoleThread;
    const response = await getClient().models.MessageThread.create(nextThread as never, { authMode: USER_POOL_AUTH_MODE }) as AmplifyResult<ConsoleThread>;
    const created = requireAmplifyData(response, "create console thread", {
      id: nextThread.id,
      primaryAnchorKey: CONSOLE_THREAD_ANCHOR_KEY,
    });
    setThread(created);
    setThreads((current) => [created, ...current.filter((entry) => entry.id !== created.id)]);
    setMessages([]);
    return created;
  }

  async function ensureThread(): Promise<ConsoleThread> {
    return thread ?? createNewThread();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const activeThread = await ensureThread();
      const previousMessage = sortedMessages[sortedMessages.length - 1] ?? null;
      const previousSequenceNumber = previousMessage?.sequenceNumber ?? activeThread.messageCount ?? 0;
      const sequenceNumber = previousSequenceNumber + 1;
      const now = new Date().toISOString();
      const message: ConsoleMessage = {
        id: `message-console-user-${crypto.randomUUID()}`,
        threadId: activeThread.id,
        parentMessageId: previousMessage?.id ?? null,
        sequenceNumber,
        role: "USER",
        messageKind: CONSOLE_MESSAGE_KIND,
        messageType: "MESSAGE",
        content,
        summary: truncateConsoleSummary(content),
        responseStatus: "PENDING",
        createdAt: now,
      };
      setMessages((current) => [...current, message]);
      setDraft("");
      requireAmplifyData(await getClient().models.Message.create({
        ...message,
        messageDomain: CONSOLE_MESSAGE_DOMAIN,
        status: "active",
        source: "papyrus-console",
        authorLabel: actorLabel,
        semanticLayer: CONSOLE_SEMANTIC_LAYER,
        searchVisibility: CONSOLE_SEARCH_VISIBILITY,
        responseTarget: CONSOLE_RESPONSE_TARGET,
        metadata: toAwsJson({
          previousSequenceNumber,
          previousMessageId: previousMessage?.id ?? null,
          previousContextDigest: activeThread.contextDigest ?? null,
          cacheHint: "lambda-tmp-jit",
        }),
        updatedAt: now,
        newsroomFeedKey: CONSOLE_NEWSROOM_FEED_KEY,
      } as never, { authMode: USER_POOL_AUTH_MODE }) as AmplifyResult<ConsoleMessage>, "create console message", {
        id: message.id,
        threadId: activeThread.id,
      });
      requireAmplifyData(await getClient().models.MessageThread.update({
        id: activeThread.id,
        messageCount: sequenceNumber,
        lastMessageId: message.id,
        lastMessageAt: now,
        updatedAt: now,
      } as never, { authMode: USER_POOL_AUTH_MODE }) as AmplifyResult<ConsoleThread>, "update console thread", {
        id: activeThread.id,
        lastMessageId: message.id,
      });
      setThread((current) => current ? {
        ...current,
        messageCount: sequenceNumber,
        lastMessageId: message.id,
        lastMessageAt: now,
        updatedAt: now,
      } : current);
    } catch (nextError) {
      console.error("[PapyrusConsole] Unable to send console message", nextError);
      setError(nextError instanceof Error ? nextError.message : "Unable to send console message.");
    } finally {
      setSending(false);
    }
  }

  const pending = sortedMessages.some((message) => message.role === "USER" && message.responseStatus === "PENDING");

  return (
    <div className="papyrus-console__panel">
      <ConsolePanelHeader onClose={onClose} />
      <div className="papyrus-console__sessions">
        <label>
          <span>Session</span>
          <select
            aria-label="Console chat session"
            onChange={(event) => selectThread(event.target.value)}
            value={thread?.id ?? ""}
          >
            {!thread ? <option value="">No session selected</option> : null}
            {threads.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {formatConsoleThreadOption(entry)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="papyrus-console__new-session"
          disabled={sending}
          onClick={() => void createNewThread().catch((nextError) => {
            console.error("[PapyrusConsole] Unable to create console thread", nextError);
            setError(nextError instanceof Error ? nextError.message : "Unable to create console thread.");
          })}
          type="button"
        >
          New chat
        </button>
      </div>
      <div className="papyrus-console__body" role="log" aria-live="polite">
        {loading && !sortedMessages.length ? <p className="papyrus-console__empty">Loading conversation…</p> : null}
        {!loading && !sortedMessages.length ? (
          <div className="papyrus-console__empty">
            <strong>Ask Papyrus about this newsroom.</strong>
            <span>Raw chat turns are marked as chat detail and excluded from default semantic search.</span>
          </div>
        ) : null}
        {sortedMessages.map((message) => (
          <article className={message.role === "USER" ? "papyrus-console-message papyrus-console-message--user" : "papyrus-console-message papyrus-console-message--assistant"} key={message.id}>
            <p>{message.role === "USER" ? "You" : message.role === "TOOL" ? "Tool" : "Papyrus"}</p>
            <div>{message.content ?? message.summary}</div>
            {message.responseStatus === "FAILED" ? <span className="papyrus-console-message__error">{message.responseError ?? "Responder failed"}</span> : null}
          </article>
        ))}
        {pending ? <p className="papyrus-console__pending">Responder is reading the thread cache…</p> : null}
      </div>
      {error ? <p className="papyrus-console__error">{error}</p> : null}
      <form className="papyrus-console__composer" onSubmit={(event) => void sendMessage(event)}>
        <textarea
          aria-label="Console message"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this edition, newsroom, or knowledge graph…"
          rows={3}
          value={draft}
        />
        <button disabled={!draft.trim() || sending} type="submit">{sending ? "Sending…" : "Send"}</button>
      </form>
    </div>
  );
}

function truncateConsoleSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized;
}

function formatConsoleThreadOption(thread: ConsoleThread): string {
  const stamp = thread.lastMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp) : null;
  const suffix = date && Number.isFinite(date.getTime())
    ? ` — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${thread.title || "Papyrus Console"}${suffix}`;
}

async function listConsoleThreads(limit: number): Promise<ConsoleThread[]> {
  const response = await getGraphQLClient().graphql({
    authMode: USER_POOL_AUTH_MODE,
    query: `
      query ListMessageThreadsByKindAndUpdatedAt($threadKind: String!, $sortDirection: ModelSortDirection, $limit: Int) {
        listMessageThreadsByKindAndUpdatedAt(threadKind: $threadKind, sortDirection: $sortDirection, limit: $limit) {
          items {
            id
            threadKind
            status
            title
            summary
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
          }
        }
      }
    `,
    variables: { threadKind: "console", sortDirection: "DESC", limit },
  });
  return readGraphQLConnection<ConsoleThread>(response, "listMessageThreadsByKindAndUpdatedAt");
}

function readGraphQLConnection<T>(
  response: Awaited<ReturnType<GraphQLClient["graphql"]>>,
  fieldName: string,
): T[] {
  if (response.errors?.length) {
    throw new Error(response.errors.map(formatAmplifyError).join("; "));
  }
  const connection = response.data?.[fieldName];
  if (!connection || typeof connection !== "object") return [];
  const items = (connection as { items?: unknown }).items;
  return Array.isArray(items) ? items as T[] : [];
}

function ConsolePanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="papyrus-console__header">
      <p className="papyrus-console__header-label">Chat</p>
      <button className="papyrus-console__close" onClick={onClose} type="button" aria-label="Close console">
        <LucideXIcon />
      </button>
    </header>
  );
}

function LucideXIcon() {
  return (
    <svg
      aria-hidden="true"
      className="papyrus-console__close-icon news-desk-search-mark__icon"
      fill="none"
      focusable="false"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function MessagesSquareIcon() {
  return (
    <svg
      aria-hidden="true"
      className="papyrus-console__icon news-desk-search-mark__icon"
      fill="none"
      focusable="false"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M14 9a2 2 0 0 1-2 2H6.5L3 14V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2Z" />
      <path d="M18 9h1a2 2 0 0 1 2 2v9l-3.5-3H12a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

function toAwsJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function requireAmplifyData<T>(response: AmplifyResult<T>, operation: string, context: Record<string, unknown>): T {
  if (response.errors?.length) {
    const message = response.errors.map(formatAmplifyError).join("; ");
    console.error(`[PapyrusConsole] ${operation} returned GraphQL errors`, { errors: response.errors, context });
    throw new Error(`${operation} failed: ${message}`);
  }
  if (!response.data) {
    console.error(`[PapyrusConsole] ${operation} returned no data`, { response, context });
    throw new Error(`${operation} failed: no data returned`);
  }
  return response.data;
}

function formatAmplifyError(error: { message?: string | null; errorType?: string | null } | string | null): string {
  if (typeof error === "string") return error;
  if (!error) return "Unknown GraphQL error";
  return [error.errorType, error.message].filter(Boolean).join(": ") || "Unknown GraphQL error";
}

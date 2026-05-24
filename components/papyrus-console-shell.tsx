"use client";

import { usePathname } from "next/navigation";
import {
  createConsoleMessage,
  createConsoleThread,
  listConsoleMessagesByThread,
  listConsoleThreads,
  updateConsoleThread,
  type ConsoleChatMessage,
  type ConsoleChatThread,
} from "../lib/console-chat-client";
import { loadReaderSessionSnapshot, type ReaderSessionSnapshot } from "./reader-auth-state";
import { Shimmer } from "./ai-elements/shimmer";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

const CONSOLE_STARTER_SUGGESTIONS = [
  "Start a research assignment",
  "Start a reporting assignment",
  "Discuss a reference",
] as const;

const CONSOLE_THREAD_ANCHOR_KEY = "site#papyrus";
const CONSOLE_NEWSROOM_FEED_KEY = "consoleChat";
const CONSOLE_MESSAGE_KIND = "console_chat_turn";
const CONSOLE_MESSAGE_DOMAIN = "conversation";
const CONSOLE_SEMANTIC_LAYER = "chat_detail";
const CONSOLE_SEARCH_VISIBILITY = "explicit";
const CONSOLE_RESPONSE_TARGET = process.env.NEXT_PUBLIC_PAPYRUS_CONSOLE_RESPONSE_TARGET?.trim() || "cloud";

type PapyrusConsoleShellProps = {
  children: ReactNode;
};

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
  const [thread, setThread] = useState<ConsoleChatThread | null>(null);
  const [threads, setThreads] = useState<ConsoleChatThread[]>([]);
  const [messages, setMessages] = useState<ConsoleChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  const hasLoadedRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadRef = useRef<ConsoleChatThread | null>(null);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const sortedMessages = useMemo(() => (
    [...messages].sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt))
  ), [messages]);

  const loadMessages = useCallback(async (threadId: string) => {
    setMessages(await listConsoleMessagesByThread(threadId));
  }, []);

  const loadThreads = useCallback(async () => {
    return listConsoleThreads(25);
  }, []);

  const resolveActiveThread = useCallback((
    recentThreads: ConsoleChatThread[],
    currentThread: ConsoleChatThread | null,
  ): ConsoleChatThread | null => {
    const preferredId = activeThreadIdRef.current ?? currentThread?.id ?? null;
    if (preferredId) {
      const match = recentThreads.find((entry) => entry.id === preferredId);
      if (match) return match;
      if (currentThread?.id === preferredId) return currentThread;
    }
    const fallback = recentThreads[0] ?? null;
    if (fallback) activeThreadIdRef.current = fallback.id;
    return fallback;
  }, []);

  const loadThread = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setLoading(true);
    setError(null);
    try {
      const recentThreads = await loadThreads();
      const nextThread = resolveActiveThread(recentThreads, threadRef.current);
      setThreads(recentThreads);
      setThread(nextThread);
      if (nextThread) {
        await loadMessages(nextThread.id);
      } else {
        setMessages([]);
      }
    } catch (nextError) {
      console.error("[PapyrusConsole] Unable to load console thread", nextError);
      if (initialLoad) setError(nextError instanceof Error ? nextError.message : "Unable to load console thread.");
    } finally {
      hasLoadedRef.current = true;
      if (initialLoad) setLoading(false);
    }
  }, [loadMessages, loadThreads, resolveActiveThread]);

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
    activeThreadIdRef.current = threadId;
    const nextThread = threads.find((entry) => entry.id === threadId) ?? null;
    setThread(nextThread);
    setMessages([]);
    if (nextThread) void loadMessages(nextThread.id);
  }, [loadMessages, threads]);

  async function createNewThread(): Promise<ConsoleChatThread> {
    const now = new Date().toISOString();
    const nextThread: ConsoleChatThread = {
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
    };
    activeThreadIdRef.current = nextThread.id;
    setThread(nextThread);
    setThreads((current) => [nextThread, ...current]);
    setMessages([]);
    const created = await createConsoleThread(nextThread);
    activeThreadIdRef.current = created.id;
    setThread(created);
    setThreads((current) => [created, ...current.filter((entry) => entry.id !== created.id)]);
    return created;
  }

  async function ensureThread(): Promise<ConsoleChatThread> {
    return thread ?? createNewThread();
  }

  async function submitMessage(content: string) {
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const activeThread = await ensureThread();
      const previousMessage = sortedMessages[sortedMessages.length - 1] ?? null;
      const previousSequenceNumber = previousMessage?.sequenceNumber ?? activeThread.messageCount ?? 0;
      const sequenceNumber = previousSequenceNumber + 1;
      const now = new Date().toISOString();
      const message: ConsoleChatMessage = {
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
      await createConsoleMessage({
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
      });
      await updateConsoleThread({
        id: activeThread.id,
        messageCount: sequenceNumber,
        lastMessageId: message.id,
        lastMessageAt: now,
        updatedAt: now,
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

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await submitMessage(content);
  }

  function handleSuggestionClick(suggestion: string) {
    if (sending) return;
    void submitMessage(suggestion);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const pending = sortedMessages.some((message) => message.role === "USER" && message.responseStatus === "PENDING");

  return (
    <div className="papyrus-console__panel">
      <ConsolePanelHeader onClose={onClose} />
      <div className="papyrus-console__sessions">
        <select
          aria-label="Console chat session"
          className="papyrus-console__session-select"
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
        {sortedMessages.length > 0 ? (
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
        ) : null}
      </div>
      <div className="papyrus-console__body" role="log" aria-live="polite">
        {loading && !sortedMessages.length ? <p className="papyrus-console__empty">Loading conversation…</p> : null}
        {sortedMessages.map((message) => (
          <article className={message.role === "USER" ? "papyrus-console-message papyrus-console-message--user" : "papyrus-console-message papyrus-console-message--assistant"} key={message.id}>
            <p>{message.role === "USER" ? "You" : message.role === "TOOL" ? "Tool" : "Papyrus"}</p>
            <div>{message.content ?? message.summary}</div>
            {message.responseStatus === "FAILED" ? <span className="papyrus-console-message__error">{message.responseError ?? "Responder failed"}</span> : null}
          </article>
        ))}
        {pending ? (
          <p className="papyrus-console__thinking papyrus-console-ui" role="status" aria-live="polite">
            <Shimmer className="papyrus-console__thinking-shimmer">Thinking...</Shimmer>
          </p>
        ) : null}
      </div>
      {!loading && !sortedMessages.length ? (
        <div className="papyrus-console__suggestions papyrus-console-ui">
          <Suggestions>
            {CONSOLE_STARTER_SUGGESTIONS.map((suggestion) => (
              <Suggestion
                disabled={sending}
                key={suggestion}
                onClick={handleSuggestionClick}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        </div>
      ) : null}
      {error ? <p className="papyrus-console__error">{error}</p> : null}
      <form className="papyrus-console__composer" onSubmit={(event) => void sendMessage(event)}>
        <textarea
          aria-label="Console message"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
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

function formatConsoleThreadOption(thread: ConsoleChatThread): string {
  const stamp = thread.lastMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp) : null;
  const suffix = date && Number.isFinite(date.getTime())
    ? ` — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${thread.title || "Papyrus Console"}${suffix}`;
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
      strokeWidth="2"
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
      strokeWidth="2"
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

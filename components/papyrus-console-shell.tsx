"use client";

import { usePathname } from "next/navigation";
import {
  createConsoleMessage,
  createConsoleThread,
  listConsoleMessagesByThread,
  listConsoleThreads,
  subscribeConsoleMessages,
  updateConsoleThread,
  type ConsoleChatMessage,
  type ConsoleChatThread,
} from "../lib/console-chat-client";
import { loadReaderSessionSnapshot, type ReaderSessionSnapshot } from "./reader-auth-state";
import { ModelSelector } from "./ai-elements/model-selector";
import { PromptInput, type PromptInputMessage, PromptInputSubmit, PromptInputTextarea } from "./ai-elements/prompt-input";
import { Shimmer } from "./ai-elements/shimmer";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { CONNECTION_STATE_CHANGE, ConnectionState } from "aws-amplify/data";
import { Hub } from "aws-amplify/utils";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
const DEFAULT_CONSOLE_MODEL = process.env.NEXT_PUBLIC_PAPYRUS_CONSOLE_MODEL?.trim() || "gpt-5.4-mini";
const CONSOLE_MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "GPT 5.5" },
  { value: "gpt-5.4", label: "GPT 5.4" },
  { value: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
  { value: "gpt-5.4-nano", label: "GPT 5.4 Nano" },
] as const;

type PapyrusConsoleShellProps = {
  children: ReactNode;
};

type PapyrusConsoleContextValue = {
  open: boolean;
  shouldOfferConsole: boolean;
  toggleOpen: () => void;
};

const PapyrusConsoleContext = createContext<PapyrusConsoleContextValue | null>(null);

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

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("papyrus:console-open", String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  }, []);

  const consoleContext = useMemo<PapyrusConsoleContextValue>(() => ({
    open,
    shouldOfferConsole,
    toggleOpen,
  }), [open, shouldOfferConsole, toggleOpen]);

  return (
    <PapyrusConsoleContext.Provider value={consoleContext}>
      <div className={canUseConsole && open ? "papyrus-console-page papyrus-console-page--open" : "papyrus-console-page"}>
        {children}
      </div>
      {shouldOfferConsole ? (
        <aside className={open ? "papyrus-console papyrus-console--open" : "papyrus-console"} aria-label="Papyrus console">
          {open ? (
            canUseConsole
              ? <ConsolePanel actorLabel={session?.auth.label ?? "Papyrus editor"} onClose={toggleOpen} />
              : <ConsoleAccessPanel onClose={toggleOpen} session={session} />
          ) : null}
        </aside>
      ) : null}
    </PapyrusConsoleContext.Provider>
  );
}

export function NewsroomConsoleProgressToggle() {
  const consoleContext = useContext(PapyrusConsoleContext);
  if (!consoleContext?.shouldOfferConsole || consoleContext.open) return null;

  return (
    <button
      type="button"
      className="edition-progress__button edition-progress__button--next edition-progress__button--console"
      aria-expanded={false}
      aria-label="Open console"
      onClick={consoleContext.toggleOpen}
      title="Open console"
    >
      <MessagesSquareIcon />
    </button>
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
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CONSOLE_MODEL);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const hasLoadedRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadRef = useRef<ConsoleChatThread | null>(null);
  const messageBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const sortedMessages = useMemo(() => (
    [...messages].sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt))
  ), [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = messageBodyRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    setIsNearBottom(true);
  }, []);

  const updateNearBottomState = useCallback((element: HTMLDivElement) => {
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsNearBottom(distanceFromBottom <= 72);
  }, []);

  const mergeMessage = useCallback((message: ConsoleChatMessage) => {
    setMessages((current) => upsertConsoleMessage(current, message));
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    const nextMessages = await listConsoleMessagesByThread(threadId);
    setMessages(nextMessages);
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
      setSelectedModel(resolveThreadModel(nextThread));
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
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!thread?.id) return;
    setIsNearBottom(true);
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [scrollToBottom, thread?.id]);

  useEffect(() => {
    if (!isNearBottom) return;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [isNearBottom, scrollToBottom, sortedMessages]);

  useEffect(() => {
    const element = messageBodyRef.current;
    if (!element) return;
    const onScroll = () => updateNearBottomState(element);
    updateNearBottomState(element);
    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, [thread?.id, updateNearBottomState]);

  useEffect(() => {
    if (!thread?.id) return;
    const activeThreadId = thread.id;
    const unsubscribe = subscribeConsoleMessages(
      activeThreadId,
      (message) => {
        if (message.threadId !== activeThreadIdRef.current) return;
        mergeMessage(message);
      },
      (nextError) => {
        console.warn("[PapyrusConsole] Console message subscription failed", nextError);
      },
    );
    return unsubscribe;
  }, [mergeMessage, thread?.id]);

  useEffect(() => {
    let previousState: ConnectionState | null = null;
    const unsubscribe = Hub.listen("api", ({ payload }) => {
      if (payload.event !== CONNECTION_STATE_CHANGE) return;
      const data = payload.data as { connectionState?: ConnectionState } | undefined;
      const nextState = data?.connectionState;
      if (previousState && previousState !== ConnectionState.Connected && nextState === ConnectionState.Connected) {
        const activeThreadId = activeThreadIdRef.current;
        if (activeThreadId) void loadMessages(activeThreadId);
      }
      previousState = nextState ?? previousState;
    });
    return () => unsubscribe();
  }, [loadMessages]);

  const selectThread = useCallback((threadId: string) => {
    activeThreadIdRef.current = threadId;
    const nextThread = threads.find((entry) => entry.id === threadId) ?? null;
    setThread(nextThread);
    setSelectedModel(resolveThreadModel(nextThread));
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
          model: selectedModel,
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
    setSelectedModel(resolveThreadModel(created));
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
      mergeMessage(message);
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
          model: selectedModel,
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

  async function sendMessage(message: PromptInputMessage) {
    const content = message.text.trim();
    if (!content) return;
    setDraft("");
    await submitMessage(content);
  }

  function handleSuggestionClick(suggestion: string) {
    if (sending) return;
    void submitMessage(suggestion);
  }

  const handleModelChange = useCallback((nextModel: string) => {
    setSelectedModel(nextModel);
    const activeThread = threadRef.current;
    if (!activeThread) return;
    const metadata = readAwsJsonObject(activeThread.metadata) ?? {};
    const nextMetadata = {
      ...metadata,
      console: {
        ...(readNestedObject(metadata, "console") ?? {}),
        model: nextModel,
      },
    };
    const now = new Date().toISOString();
    void updateConsoleThread({
      id: activeThread.id,
      metadata: toAwsJson(nextMetadata),
      updatedAt: now,
    })
      .then((updated) => {
        setThread(updated);
        setThreads((current) => current.map((entry) => (
          entry.id === updated.id ? updated : entry
        )));
      })
      .catch((nextError) => {
        console.error("[PapyrusConsole] Unable to update console thread model", nextError);
        setError(nextError instanceof Error ? nextError.message : "Unable to update console model.");
      });
  }, []);

  const pendingUserResponse = sortedMessages.some(
    (message) => message.role === "USER" && message.responseStatus === "PENDING",
  );
  const pendingAssistantResponse = sortedMessages.some(
    (message) => message.role === "ASSISTANT" && message.responseStatus === "RUNNING" && !(message.content ?? "").trim(),
  );
  const pending = pendingUserResponse || pendingAssistantResponse;

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
      <div className="papyrus-console__model-row">
        <p className="papyrus-console__model-label">Model</p>
        <ModelSelector
          aria-label="Console model"
          disabled={sending}
          onValueChange={handleModelChange}
          options={CONSOLE_MODEL_OPTIONS}
          value={selectedModel}
        />
      </div>
      <div className="papyrus-console__body" ref={messageBodyRef} role="log" aria-live="polite">
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
        {!isNearBottom && sortedMessages.length ? (
          <button
            aria-label="Scroll to latest message"
            className="papyrus-console__scroll-bottom"
            onClick={() => scrollToBottom()}
            type="button"
          >
            <ChevronDownIcon />
          </button>
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
      <PromptInput className="papyrus-console__composer" onSubmit={(message) => void sendMessage(message)}>
        <PromptInputTextarea
          aria-label="Console message"
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this edition, newsroom, or knowledge graph…"
          rows={3}
          value={draft}
        />
        <PromptInputSubmit
          disabled={!draft.trim() || sending}
          status={pending ? "streaming" : "ready"}
        >
          {sending ? "Sending…" : "Send"}
        </PromptInputSubmit>
      </PromptInput>
    </div>
  );
}

function truncateConsoleSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized;
}

function upsertConsoleMessage(messages: ConsoleChatMessage[], message: ConsoleChatMessage): ConsoleChatMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  const next = index >= 0
    ? messages.map((entry, currentIndex) => currentIndex === index ? { ...entry, ...message } : entry)
    : [...messages, message];
  return next.sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt));
}

function formatConsoleThreadOption(thread: ConsoleChatThread): string {
  const stamp = thread.lastMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const date = stamp ? new Date(stamp) : null;
  const suffix = date && Number.isFinite(date.getTime())
    ? ` — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${thread.title || "Papyrus Console"}${suffix}`;
}

function resolveThreadModel(thread: ConsoleChatThread | null): string {
  const metadata = readAwsJsonObject(thread?.metadata);
  const model =
    readNestedString(metadata, ["console", "model"])
    ?? readNestedString(metadata, ["model"]);
  return isSupportedConsoleModel(model) ? model : DEFAULT_CONSOLE_MODEL;
}

function isSupportedConsoleModel(model: unknown): model is string {
  return typeof model === "string" && CONSOLE_MODEL_OPTIONS.some((option) => option.value === model);
}

function readNestedObject(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!value) return null;
  const candidate = value[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

function readNestedString(value: Record<string, unknown> | null, path: string[]): string | null {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
}

function readAwsJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
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

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function toAwsJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

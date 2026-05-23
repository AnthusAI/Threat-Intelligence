"use client";

import { usePathname } from "next/navigation";
import {
  createConsoleMessage,
  createConsoleThread,
  listConsoleMessagesByThread,
  listConsoleThreadByAnchor,
  updateConsoleThread,
  type ConsoleChatMessage,
  type ConsoleChatThread,
} from "../lib/console-chat-client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { loadReaderSessionSnapshot, type ReaderSessionSnapshot } from "./reader-auth-state";
import { MessageSquare } from "lucide-react";
import type { UIMessage } from "ai";
import { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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

type PapyrusConsoleContextValue = {
  closeConsole: () => void;
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
    try {
      window.localStorage.removeItem("papyrus:console-open");
    } catch {
      // Ignore storage failures.
    }
    let active = true;
    void loadReaderSessionSnapshot()
      .then((snapshot) => {
        if (active) setSession(snapshot);
      })
      .catch(() => {
        if (active) setSession({ auth: { status: "signedOut", label: "Signed out" }, groups: [], hasSession: false });
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const closeConsole = useCallback(() => {
    setOpen(false);
  }, []);

  const consoleContext = useMemo<PapyrusConsoleContextValue>(() => ({
    closeConsole,
    open,
    shouldOfferConsole,
    toggleOpen,
  }), [closeConsole, open, shouldOfferConsole, toggleOpen]);

  return (
    <PapyrusConsoleContext.Provider value={consoleContext}>
      <div className={canUseConsole && open ? "papyrus-console-page papyrus-console-page--open" : "papyrus-console-page"}>
        {children}
      </div>
      {shouldOfferConsole ? (
        <aside className={open ? "papyrus-console papyrus-console--open" : "papyrus-console"} aria-label="Papyrus console">
          {open ? (
            canUseConsole
              ? <ConsolePanel actorLabel={session?.auth.label ?? "Papyrus editor"} />
              : <ConsoleAccessPanel session={session} />
          ) : null}
        </aside>
      ) : null}
    </PapyrusConsoleContext.Provider>
  );
}

export function NewsroomConsoleProgressToggle() {
  const consoleContext = useContext(PapyrusConsoleContext);
  if (!consoleContext?.shouldOfferConsole || consoleContext.open) return null;

  const { toggleOpen } = consoleContext;

  return (
    <button
      type="button"
      className="edition-progress__button edition-progress__button--next edition-progress__button--console"
      aria-expanded={false}
      aria-label="Open console"
      onClick={toggleOpen}
      title="Open console"
    >
      <MessagesSquareIcon />
    </button>
  );
}

function ConsoleAccessPanel({ session }: { session: ReaderSessionSnapshot | null }) {
  const { closeConsole } = useContext(PapyrusConsoleContext)!;

  return (
    <div className="papyrus-console__panel papyrus-console__panel--access papyrus-console-ui">
      <ConsolePanelHeader
        onClose={closeConsole}
        subtitle={session?.auth.label ?? "Checking editor session"}
        title="Console Access"
      />
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

function ConsolePanel({ actorLabel }: { actorLabel: string }) {
  const { closeConsole } = useContext(PapyrusConsoleContext)!;
  const [thread, setThread] = useState<ConsoleChatThread | null>(null);
  const [messages, setMessages] = useState<ConsoleChatMessage[]>([]);
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
    setMessages(await listConsoleMessagesByThread(threadId));
  }, []);

  const loadThread = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) setLoading(true);
    setError(null);
    try {
      const existingThread = await listConsoleThreadByAnchor(CONSOLE_THREAD_ANCHOR_KEY);
      setThread(existingThread);
      if (existingThread) await loadMessages(existingThread.id);
    } catch (nextError) {
      console.error("[PapyrusConsole] Unable to load console thread", nextError);
      if (initialLoad) setError(nextError instanceof Error ? nextError.message : "Unable to load console thread.");
    } finally {
      hasLoadedRef.current = true;
      if (initialLoad) setLoading(false);
    }
  }, [loadMessages]);

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

  async function ensureThread(): Promise<ConsoleChatThread> {
    if (thread) return thread;
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
    const created = await createConsoleThread(nextThread);
    setThread(created);
    return created;
  }

  async function sendMessage(message: PromptInputMessage, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.text.trim();
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
      setDraft("");
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

  const pending = sortedMessages.some((message) => message.role === "USER" && message.responseStatus === "PENDING");
  const submitStatus = sending ? "submitted" : pending ? "streaming" : "ready";

  return (
    <div className="papyrus-console__panel papyrus-console-ui">
      <ConsolePanelHeader
        onClose={closeConsole}
        subtitle={actorLabel}
        title={thread?.title ?? "Papyrus Console"}
      />
      <Conversation className="papyrus-console__conversation min-h-0 flex-1">
        <ConversationContent className="gap-4 p-4">
          {loading && !sortedMessages.length ? (
            <ConversationEmptyState
              description="Loading the editor console thread."
              title="Loading conversation…"
            />
          ) : null}
          {!loading && !sortedMessages.length ? (
            <ConversationEmptyState
              description="Raw chat turns are marked as chat detail and excluded from default semantic search."
              icon={<MessageSquare className="size-10" strokeWidth={1.5} />}
              title="Ask Papyrus about this newsroom."
            />
          ) : null}
          {sortedMessages.map((message) => (
            <Message from={toConsoleMessageRole(message.role)} key={message.id}>
              <MessageContent>
                <MessageResponse>{message.content ?? message.summary ?? ""}</MessageResponse>
                {message.responseStatus === "FAILED" ? (
                  <p className="papyrus-console-message__error text-destructive text-xs">
                    {message.responseError ?? "Responder failed"}
                  </p>
                ) : null}
              </MessageContent>
            </Message>
          ))}
          {pending ? <p className="papyrus-console__pending text-muted-foreground text-sm">Responder is reading the thread cache…</p> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {error ? <p className="papyrus-console__error">{error}</p> : null}
      <PromptInput
        className="papyrus-console__composer relative border-t p-3"
        onSubmit={(message, event) => void sendMessage(message, event)}
      >
        <PromptInputTextarea
          aria-label="Console message"
          className="min-h-20 pr-12"
          disabled={sending}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Ask about this edition, newsroom, or knowledge graph…"
          value={draft}
        />
        <PromptInputSubmit
          className="absolute right-4 bottom-4"
          disabled={!draft.trim() || sending}
          status={submitStatus}
        />
      </PromptInput>
    </div>
  );
}

function toConsoleMessageRole(role: string | null | undefined): UIMessage["role"] {
  if (role === "USER") return "user";
  if (role === "ASSISTANT") return "assistant";
  if (role === "SYSTEM") return "system";
  return "assistant";
}

function truncateConsoleSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized;
}

function ConsolePanelHeader({
  onClose,
  subtitle,
  title,
}: {
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <header className="papyrus-console__header">
      <button
        type="button"
        className="papyrus-console__header-close edition-progress__button edition-progress__button--console"
        aria-label="Close console"
        onClick={onClose}
        title="Close console"
      >
        <LucideXIcon />
      </button>
      <p>Editor Console</p>
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </header>
  );
}

function LucideXIcon() {
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

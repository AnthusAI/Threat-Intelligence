"use client";

import { usePathname } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { gsap } from "gsap";
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
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "./ai-elements/model-selector";
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, type PromptInputMessage, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "./ai-elements/prompt-input";
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
import { useStickToBottomContext } from "use-stick-to-bottom";

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
  { value: "gpt-5.5", label: "GPT 5.5", provider: "openai" },
  { value: "gpt-5.4", label: "GPT 5.4", provider: "openai" },
  { value: "gpt-5.4-mini", label: "GPT 5.4 Mini", provider: "openai" },
  { value: "gpt-5.4-nano", label: "GPT 5.4 Nano", provider: "openai" },
] as const;

type PapyrusConsoleShellProps = {
  children: ReactNode;
};

type PapyrusConsoleContextValue = {
  open: boolean;
  shouldOfferConsole: boolean;
  toggleOpen: () => void;
};

type DisplayConsoleMessage = ConsoleChatMessage & {
  pendingPlaceholder?: boolean;
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
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(null);
  const threadRef = useRef<ConsoleChatThread | null>(null);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const sortedMessages = useMemo(() => (
    [...messages].sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt))
  ), [messages]);

  const mergeMessage = useCallback((message: ConsoleChatMessage) => {
    setMessages((current) => upsertConsoleMessage(current, message));
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    const nextMessages = await listConsoleMessagesByThread(threadId);
    setMessages(nextMessages);
  }, []);

  const loadThreads = useCallback(async () => {
    return listConsoleThreads(CONSOLE_THREAD_ANCHOR_KEY, 25);
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
      const normalizedError = formatUnknownConsoleError(nextError);
      console.error("[PapyrusConsole] Unable to load console thread", normalizedError, nextError);
      if (initialLoad) setError(normalizedError);
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
    const activeThreadId = thread.id;
    const unsubscribe = subscribeConsoleMessages(
      activeThreadId,
      (message) => {
        if (message.threadId && message.threadId !== activeThreadIdRef.current) return;
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
      const persistedMessage = await createConsoleMessage({
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
      mergeMessage({ ...message, ...persistedMessage });
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

  const latestAwaitingAssistantUserMessage = [...sortedMessages]
    .reverse()
    .find((message) => (
      message.role === "USER"
      && isAwaitingAssistantStatus(message.responseStatus)
      && !sortedMessages.some((candidate) => (
        candidate.role === "ASSISTANT"
        && isResponderMessageForPendingUser(candidate, message)
      ))
    ));
  const pendingUserResponse = Boolean(latestAwaitingAssistantUserMessage);
  const pendingAssistantResponse = sortedMessages.some(
    (message) => message.role === "ASSISTANT" && message.responseStatus === "RUNNING",
  );
  const pending = pendingUserResponse || pendingAssistantResponse;
  const displayMessages = useMemo<DisplayConsoleMessage[]>(() => {
    if (!latestAwaitingAssistantUserMessage) return sortedMessages;
    return [
      ...sortedMessages,
      {
        id: `pending-assistant-placeholder-${latestAwaitingAssistantUserMessage.id}`,
        threadId: latestAwaitingAssistantUserMessage.threadId,
        parentMessageId: latestAwaitingAssistantUserMessage.id,
        sequenceNumber: (latestAwaitingAssistantUserMessage.sequenceNumber ?? sortedMessages.length) + 1,
        role: "ASSISTANT",
        messageKind: CONSOLE_MESSAGE_KIND,
        messageType: "MESSAGE",
        content: "",
        summary: "Thinking...",
        responseStatus: "RUNNING",
        createdAt: latestAwaitingAssistantUserMessage.createdAt,
        pendingPlaceholder: true,
      },
    ];
  }, [latestAwaitingAssistantUserMessage, sortedMessages]);
  const streamingAutoStickSignal = useMemo(() => {
    const activeStreamingAssistant = [...displayMessages]
      .reverse()
      .find((message) => message.role === "ASSISTANT" && message.responseStatus === "RUNNING");
    if (!activeStreamingAssistant) return null;
    return [
      activeStreamingAssistant.id,
      activeStreamingAssistant.pendingPlaceholder ? "placeholder" : "message",
      (activeStreamingAssistant.content ?? "").length,
      activeStreamingAssistant.updatedAt ?? activeStreamingAssistant.createdAt,
    ].join(":");
  }, [displayMessages]);
  const selectedModelOption = CONSOLE_MODEL_OPTIONS.find((option) => option.value === selectedModel) ?? CONSOLE_MODEL_OPTIONS[0];

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
      <Conversation className="papyrus-console__conversation" resize={pending ? "instant" : "smooth"}>
        <ConsoleStreamingAutoStick active={pending} streamSignal={streamingAutoStickSignal} />
        <ConversationContent
          aria-live="polite"
          className="papyrus-console__body"
          scrollClassName="papyrus-console__scrollport"
          role="log"
        >
          {loading && !sortedMessages.length ? <p className="papyrus-console__empty">Loading conversation…</p> : null}
          {displayMessages.map((message) => {
            const content = (message.content ?? "").trim();
            const summary = (message.summary ?? "").trim();
            const sanitizedSummary = sanitizeConsoleSummary(summary);
            const shouldShowThinking = (
              message.pendingPlaceholder
              || (message.role === "ASSISTANT" && message.responseStatus === "RUNNING" && !content)
            );

            return (
              <ConsoleChatMessageRow key={message.id} role={message.role}>
                <div className={message.role === "ASSISTANT" ? "papyrus-console-message__markdown" : undefined}>
                  {shouldShowThinking ? (
                    <Shimmer className="papyrus-console__thinking-shimmer">Thinking...</Shimmer>
                  ) : <ConsoleChatMessageContent role={message.role} text={content || sanitizedSummary} />}
                </div>
                {message.responseStatus === "FAILED" ? <span className="papyrus-console-message__error">{message.responseError ?? "Responder failed"}</span> : null}
              </ConsoleChatMessageRow>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton
          aria-label="Scroll to latest message"
          className="papyrus-console__scroll-bottom"
        />
      </Conversation>
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
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Console message"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this edition, newsroom, or knowledge graph…"
            rows={3}
            value={draft}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <ModelSelector
              onOpenChange={setModelSelectorOpen}
              open={modelSelectorOpen}
            >
              <ModelSelectorTrigger
                render={<PromptInputButton disabled={sending} />}
              >
                <ModelSelectorLogo provider={selectedModelOption.provider} />
                <ModelSelectorName>{selectedModelOption.label}</ModelSelectorName>
              </ModelSelectorTrigger>
              <ModelSelectorContent title="Choose Model">
                <ModelSelectorInput placeholder="Search models..." />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  <ModelSelectorGroup heading="OpenAI">
                    {CONSOLE_MODEL_OPTIONS.map((option) => (
                      <ModelSelectorItem key={option.value} onSelect={() => handleModelChange(option.value)} value={option.value}>
                        <ModelSelectorLogo provider={option.provider} />
                        <ModelSelectorName>{option.label}</ModelSelectorName>
                        <ModelSelectorLogoGroup>
                          <ModelSelectorLogo provider={option.provider} />
                        </ModelSelectorLogoGroup>
                        {selectedModel === option.value ? <CheckIcon className="ml-auto size-4" /> : <span className="ml-auto size-4" />}
                      </ModelSelectorItem>
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!draft.trim() || sending}
            status={pending ? "streaming" : "ready"}
          />
        </PromptInputFooter>
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
    ? messages.map((entry, currentIndex) => (
      currentIndex === index
        ? mergeConsoleMessage(entry, message)
        : entry
    ))
    : [...messages, message];
  return next.sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0) || left.createdAt.localeCompare(right.createdAt));
}

function mergeConsoleMessage(previous: ConsoleChatMessage, incoming: ConsoleChatMessage): ConsoleChatMessage {
  const merged = { ...previous } as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged as ConsoleChatMessage;
}

function isConsoleMessageAfter(message: ConsoleChatMessage, anchor: ConsoleChatMessage): boolean {
  if (message.id === anchor.id) return false;
  if (typeof message.sequenceNumber === "number" && typeof anchor.sequenceNumber === "number") {
    return message.sequenceNumber > anchor.sequenceNumber;
  }
  return message.createdAt >= anchor.createdAt;
}

function isResponderMessageForPendingUser(message: ConsoleChatMessage, pendingUser: ConsoleChatMessage): boolean {
  if (message.id === pendingUser.id) return false;
  if (message.parentMessageId && message.parentMessageId === pendingUser.id) return true;
  if (isConsoleMessageAfter(message, pendingUser)) return true;
  if (
    typeof message.sequenceNumber === "number"
    && typeof pendingUser.sequenceNumber === "number"
    && message.sequenceNumber === pendingUser.sequenceNumber
  ) {
    return message.createdAt >= pendingUser.createdAt;
  }
  return false;
}

function isAwaitingAssistantStatus(status: string | null | undefined): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function sanitizeConsoleSummary(summary: string): string {
  const lowered = summary.trim().toLowerCase();
  if (!lowered) return "";
  if (lowered === "thinking...") return "";
  if (lowered.endsWith("responding.")) return "";
  return summary;
}

function ConsoleChatMessageContent({ role, text }: { role: string | null | undefined; text: string }) {
  if (role !== "ASSISTANT") return text;
  const blocks = useMemo(() => parseConsoleMarkdownBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, index) => renderConsoleMarkdownBlock(block, index))}
    </>
  );
}

type ConsoleMarkdownBlock =
  | { type: "code"; text: string }
  | { type: "heading"; depth: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

function parseConsoleMarkdownBlocks(text: string): ConsoleMarkdownBlock[] {
  const blocks: ConsoleMarkdownBlock[] = [];
  const lines = text.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];
  let listOrdered = false;
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", ordered: listOrdered, items: list });
    list = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", depth: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const bullet = /^([-*+])\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list.length) listOrdered = false;
      list.push(bullet[2].trim());
      continue;
    }
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (!list.length) listOrdered = true;
      list.push(ordered[1].trim());
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (code.length) blocks.push({ type: "code", text: code.join("\n") });
  return blocks;
}

function renderConsoleMarkdownBlock(block: ConsoleMarkdownBlock, index: number): ReactNode {
  const key = `${block.type}-${index}`;
  if (block.type === "code") return <pre className="papyrus-console-message__code" key={key}>{block.text}</pre>;
  if (block.type === "list") {
    if (block.ordered) {
      return (
        <ol key={key}>
          {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderConsoleInlineMarkdown(item)}</li>)}
        </ol>
      );
    }
    return (
      <ul key={key}>
        {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderConsoleInlineMarkdown(item)}</li>)}
      </ul>
    );
  }
  if (block.type === "heading") {
    if (block.depth <= 1) return <h3 key={key}>{renderConsoleInlineMarkdown(block.text)}</h3>;
    if (block.depth === 2) return <h4 key={key}>{renderConsoleInlineMarkdown(block.text)}</h4>;
    return <h5 key={key}>{renderConsoleInlineMarkdown(block.text)}</h5>;
  }
  return <p key={key}>{renderConsoleInlineMarkdown(block.text)}</p>;
}

function renderConsoleInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(
          <a href={linkMatch[2]} key={`${match.index}-link`} rel="noreferrer noopener" target="_blank">
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function ConsoleChatMessageRow({
  role,
  children,
}: {
  role: string | null | undefined;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || prefersReducedMotion()) return;
    const tween = gsap.fromTo(
      row,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.16, ease: "power2.out", overwrite: "auto" },
    );
    return () => {
      tween.kill();
      gsap.killTweensOf(row);
    };
  }, []);

  return (
    <article
      className={role === "USER" ? "papyrus-console-message papyrus-console-message--user" : "papyrus-console-message papyrus-console-message--assistant"}
      ref={rowRef}
    >
      {children}
    </article>
  );
}

function ConsoleStreamingAutoStick({ active, streamSignal }: { active: boolean; streamSignal: string | null }) {
  const { isAtBottom, scrollRef, scrollToBottom } = useStickToBottomContext();
  const wasAtBottomRef = useRef(true);
  const previousSignalRef = useRef<string | null>(null);

  useEffect(() => {
    wasAtBottomRef.current = isAtBottom;
    if (!isAtBottom && scrollRef.current) {
      gsap.killTweensOf(scrollRef.current);
    }
  }, [isAtBottom, scrollRef]);

  useEffect(() => {
    return () => {
      if (scrollRef.current) gsap.killTweensOf(scrollRef.current);
    };
  }, [scrollRef]);

  useEffect(() => {
    if (!active || !streamSignal) return;
    if (previousSignalRef.current === streamSignal) return;
    const shouldStick = wasAtBottomRef.current;
    previousSignalRef.current = streamSignal;
    if (!shouldStick) return;
    if (prefersReducedMotion()) {
      void scrollToBottom({ animation: "instant" });
      return;
    }
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      void scrollToBottom({ animation: "instant" });
      return;
    }
    gsap.killTweensOf(scrollElement);
    const targetScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    gsap.to(scrollElement, {
      scrollTop: targetScrollTop,
      duration: 0.18,
      ease: "power2.out",
      overwrite: "auto",
    });
  }, [active, scrollRef, scrollToBottom, streamSignal]);

  useEffect(() => {
    if (!active) previousSignalRef.current = null;
  }, [active]);

  return null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

function toAwsJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function formatUnknownConsoleError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    const text = JSON.stringify(error);
    if (text && text !== "{}") return text;
  } catch {
    // Ignore serialization failures.
  }
  return "Unable to load console thread.";
}

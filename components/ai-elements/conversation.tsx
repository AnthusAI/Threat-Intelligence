"use client";

import { cn } from "../../lib/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ConversationContextValue = {
  contentRef: React.RefObject<HTMLDivElement | null>;
  isNearBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(null);

export type ConversationProps = ComponentPropsWithoutRef<"div">;

export function Conversation({ className, children, ...props }: ConversationProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const updateNearBottom = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsNearBottom(distanceFromBottom <= 72);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = contentRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    setIsNearBottom(true);
  }, []);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    updateNearBottom();
    const onScroll = () => updateNearBottom();
    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, [updateNearBottom]);

  const context = useMemo<ConversationContextValue>(() => ({
    contentRef,
    isNearBottom,
    scrollToBottom,
  }), [isNearBottom, scrollToBottom]);

  return (
    <ConversationContext.Provider value={context}>
      <div className={cn(className)} {...props}>
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export type ConversationContentProps = ComponentPropsWithoutRef<"div"> & {
  watch?: unknown;
};

export function ConversationContent({ className, watch, children, ...props }: ConversationContentProps) {
  const context = useConversationContext();

  useEffect(() => {
    if (!context.isNearBottom) return;
    requestAnimationFrame(() => context.scrollToBottom("auto"));
  }, [context, watch]);

  return (
    <div
      className={cn(className)}
      ref={context.contentRef}
      {...props}
    >
      {children}
    </div>
  );
}

export type ConversationScrollButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  children?: ReactNode;
};

export function ConversationScrollButton({ className, children, ...props }: ConversationScrollButtonProps) {
  const context = useConversationContext();
  if (context.isNearBottom) return null;
  return (
    <button
      className={cn(className)}
      onClick={() => context.scrollToBottom()}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function useConversationContext(): ConversationContextValue {
  const context = useContext(ConversationContext);
  if (!context) throw new Error("Conversation components must be rendered within <Conversation>.");
  return context;
}

"use client";

import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "../ui/button";
import type { ComponentPropsWithoutRef, FormEvent, KeyboardEvent } from "react";
import { useCallback } from "react";

export type PromptInputMessage = {
  text: string;
};

export type PromptInputProps = Omit<ComponentPropsWithoutRef<"form">, "onSubmit"> & {
  onSubmit?: (message: PromptInputMessage) => void | Promise<void>;
};

export function PromptInput({ className, onSubmit, ...props }: PromptInputProps) {
  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = new FormData(form);
    const textValue = payload.get("prompt");
    const text = typeof textValue === "string" ? textValue : "";
    await onSubmit?.({ text });
  }, [onSubmit]);

  return (
    <form className={cn(className)} onSubmit={(event) => void handleSubmit(event)} {...props} />
  );
}

export type PromptInputTextareaProps = ComponentPropsWithoutRef<"textarea">;

export type PromptInputBodyProps = ComponentPropsWithoutRef<"div">;

export function PromptInputBody({ className, ...props }: PromptInputBodyProps) {
  return <div className={cn("papyrus-console-prompt-input__body", className)} {...props} />;
}

export type PromptInputFooterProps = ComponentPropsWithoutRef<"div">;

export function PromptInputFooter({ className, ...props }: PromptInputFooterProps) {
  return <div className={cn("papyrus-console-prompt-input__footer", className)} {...props} />;
}

export type PromptInputToolsProps = ComponentPropsWithoutRef<"div">;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
  return <div className={cn("papyrus-console-prompt-input__tools", className)} {...props} />;
}

export type PromptInputSelectProps = Omit<ComponentPropsWithoutRef<"select">, "onChange"> & {
  onValueChange?: (value: string) => void;
};

export function PromptInputSelect({ className, onValueChange, ...props }: PromptInputSelectProps) {
  return (
    <select
      className={cn("papyrus-console-prompt-input__select", className)}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      {...props}
    />
  );
}

export type PromptInputSelectItemProps = ComponentPropsWithoutRef<"option">;

export function PromptInputSelectItem(props: PromptInputSelectItemProps) {
  return <option {...props} />;
}

export function PromptInputTextarea({ className, name = "prompt", onKeyDown, ...props }: PromptInputTextareaProps) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }, [onKeyDown]);

  return (
    <textarea
      className={cn(className)}
      name={name}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}

export type PromptInputSubmitStatus = "ready" | "streaming";

export type PromptInputSubmitProps = Omit<ButtonProps, "type"> & {
  status?: PromptInputSubmitStatus;
};

export function PromptInputSubmit({
  className,
  disabled,
  status = "ready",
  children,
  ...props
}: PromptInputSubmitProps) {
  const label = children ?? (status === "streaming" ? "Streaming…" : "Send");
  return (
    <Button
      className={cn(className)}
      disabled={disabled}
      type="submit"
      {...props}
    >
      {label}
    </Button>
  );
}

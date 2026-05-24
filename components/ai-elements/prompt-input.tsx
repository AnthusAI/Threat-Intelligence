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

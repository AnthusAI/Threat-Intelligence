"use client";

import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const TOOL_STATE_LABEL: Record<ToolState, string> = {
  "input-streaming": "Pending",
  "input-available": "Running",
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "output-available": "Completed",
  "output-error": "Error",
  "output-denied": "Denied",
};

export type ToolProps = ComponentProps<"details">;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <details
      className={cn("papyrus-console-tool", className)}
      {...props}
    />
  );
}

export type ToolHeaderProps = ComponentProps<"summary"> & {
  title?: string;
  type?: string;
  toolName?: string;
  state: ToolState;
};

export function ToolHeader({
  className,
  title,
  type,
  toolName,
  state,
  ...props
}: ToolHeaderProps) {
  const label = title?.trim() || toolName?.trim() || normalizeToolType(type);
  return (
    <summary
      className={cn("papyrus-console-tool__header", className)}
      {...props}
    >
      <span className="papyrus-console-tool__label">{label || "Tool"}</span>
      {getStatusBadge(state)}
      <ChevronDownIcon className="papyrus-console-tool__chevron" size={14} />
    </summary>
  );
}

export type ToolContentProps = ComponentProps<"div">;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <div
      className={cn("papyrus-console-tool__content", className)}
      {...props}
    />
  );
}

export type ToolInputProps = ComponentProps<"div"> & {
  input?: unknown;
};

export function ToolInput({ className, input, ...props }: ToolInputProps) {
  if (input === undefined || input === null) return null;
  return (
    <div className={cn("papyrus-console-tool__section", className)} {...props}>
      <div className="papyrus-console-tool__section-label">Parameters</div>
      <pre className="papyrus-console-tool__pre">{formatToolValue(input)}</pre>
    </div>
  );
}

export type ToolOutputProps = ComponentProps<"div"> & {
  output?: ReactNode;
  errorText?: string;
};

export function ToolOutput({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) {
  if (!output && !errorText) return null;
  return (
    <div className={cn("papyrus-console-tool__section", className)} {...props}>
      <div className="papyrus-console-tool__section-label">
        {errorText ? "Error" : "Result"}
      </div>
      {errorText ? (
        <pre className="papyrus-console-tool__pre papyrus-console-tool__pre--error">
          {errorText}
        </pre>
      ) : typeof output === "string" ? (
        <pre className="papyrus-console-tool__pre">{output}</pre>
      ) : (
        <div className="papyrus-console-tool__output">{output}</div>
      )}
    </div>
  );
}

export function getStatusBadge(state: ToolState) {
  const label = TOOL_STATE_LABEL[state];
  return (
    <span
      className="papyrus-console-tool__badge"
      data-state={state}
    >
      {renderStateIcon(state)}
      {label}
    </span>
  );
}

function renderStateIcon(state: ToolState) {
  if (state === "output-error" || state === "output-denied") {
    return <AlertCircleIcon size={12} />;
  }
  if (state === "output-available" || state === "approval-responded") {
    return <CheckCircle2Icon size={12} />;
  }
  if (state === "input-streaming" || state === "input-available" || state === "approval-requested") {
    return <Loader2Icon className="papyrus-console-tool__badge-spinner" size={12} />;
  }
  return <WrenchIcon size={12} />;
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return trimmed;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeToolType(type: string | undefined): string {
  if (!type) return "";
  return type.replace(/^tool-/, "").replace(/_/g, " ");
}

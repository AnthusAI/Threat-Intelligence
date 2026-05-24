"use client";

import { cn } from "../../lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export type ModelSelectorOption = {
  value: string;
  label: string;
};

export type ModelSelectorProps = Omit<ComponentPropsWithoutRef<"select">, "onChange"> & {
  options: readonly ModelSelectorOption[];
  onValueChange?: (value: string) => void;
};

export function ModelSelector({ className, options, onValueChange, ...props }: ModelSelectorProps) {
  return (
    <select
      className={cn("papyrus-console-model-selector", className)}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

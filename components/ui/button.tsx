import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "papyrus-ui-button",
        variant === "outline" && "papyrus-ui-button--outline",
        variant === "ghost" && "papyrus-ui-button--ghost",
        size === "sm" && "papyrus-ui-button--sm",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

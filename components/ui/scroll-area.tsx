import { cn } from "../../lib/utils";
import type { HTMLAttributes } from "react";

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement>;

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div className={cn("papyrus-ui-scroll-area", className)} {...props}>
      {children}
    </div>
  );
}

export function ScrollBar() {
  return null;
}

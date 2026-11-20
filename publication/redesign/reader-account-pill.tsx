"use client";

import { ReaderAuthControl } from "@anthusai/papyrus/components/reader-auth-control";

export function ReaderAccountPill({ variant = "pill" }: { variant?: "pill" | "link" }) {
  return (
    <ReaderAuthControl
      className={variant === "pill" ? "ti-account-control" : "ti-account-control ti-account-control--link"}
      renderAction={({ disabled, onClick, signedIn }) => (
        <button
          className={variant === "pill" ? "ti-pill-button" : "ti-text-button"}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {signedIn ? "Log out" : "Log in"}
        </button>
      )}
    />
  );
}

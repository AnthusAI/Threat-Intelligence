"use client";

import { signInWithRedirect, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useCallback, useEffect, useState } from "react";
import { configureAmplifyClient } from "./amplify-client-provider";
import { loadReaderSessionSnapshot, type ReaderAuthSnapshot } from "./reader-auth-state";

type ReaderAuthControlProps = {
  className?: string;
  dataFooterUtility?: string;
  postAuthPath?: string;
  showIdentity?: boolean;
  authState?: ReaderAuthSnapshot;
};

export function ReaderAuthControl({
  className,
  dataFooterUtility,
  postAuthPath,
  showIdentity = false,
  authState: externalAuthState,
}: ReaderAuthControlProps) {
  const [authState, setAuthState] = useState<ReaderAuthSnapshot>(externalAuthState ?? { status: "loading", label: "Checking sign-in" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExternallyManaged = Boolean(externalAuthState);

  const replaceWithPostAuthPath = useCallback(() => {
    if (!postAuthPath) return;
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) return;
    window.history.replaceState(window.history.state, "", postAuthPath);
  }, [postAuthPath]);

  const refreshAuthState = useCallback(async () => {
    const snapshot = await loadReaderSessionSnapshot();
    setAuthState(snapshot.auth);
    setError(null);
    if (snapshot.auth.status === "signedIn") replaceWithPostAuthPath();
  }, [replaceWithPostAuthPath]);

  useEffect(() => {
    if (externalAuthState) {
      setAuthState(externalAuthState);
      setBusy(false);
      return;
    }

    let active = true;

    const refreshIfActive = async () => {
      await refreshAuthState();
      if (!active) return;
      setBusy(false);
    };

    void refreshIfActive();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signedIn" ||
        payload.event === "signedOut" ||
        payload.event === "signInWithRedirect" ||
        payload.event === "signInWithRedirect_failure"
      ) {
        void refreshIfActive();
      }
      if (payload.event === "signInWithRedirect_failure") setError("Sign-in failed");
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [externalAuthState, refreshAuthState]);

  const signIn = async () => {
    configureAmplifyClient();
    setBusy(true);
    setError(null);
    try {
      await signInWithRedirect({ provider: "Google" });
    } catch {
      setBusy(false);
      setError("Sign-in failed");
    }
  };

  const signOutCurrentUser = async () => {
    configureAmplifyClient();
    setBusy(true);
    setError(null);
    try {
      await signOut();
      await refreshAuthState();
    } catch {
      setError("Sign-out failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!externalAuthState) return;
    setAuthState(externalAuthState);
  }, [externalAuthState]);

  const signedIn = authState.status === "signedIn";
  const actionLabel = signedIn ? "LOGOUT" : "LOGIN";
  return (
    <span className={className ? `reader-auth ${className}` : "reader-auth"} aria-live="polite" data-footer-utility={dataFooterUtility}>
      {signedIn && showIdentity ? <span className="reader-auth__identity">{authState.label}</span> : null}
      {error ? <span className="reader-auth__error">{error}</span> : null}
      <button
        className="reader-auth__button"
        disabled={authState.status === "loading" || busy}
        onClick={signedIn ? signOutCurrentUser : signIn}
        type="button"
      >
        {actionLabel}
      </button>
    </span>
  );
}

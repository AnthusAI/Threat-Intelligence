"use client";

import { fetchUserAttributes, getCurrentUser, signInWithRedirect, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useCallback, useEffect, useState } from "react";
import { configureAmplifyClient } from "./amplify-client-provider";

type AuthState =
  | { status: "loading"; label: string }
  | { status: "signedOut"; label: string }
  | { status: "signedIn"; label: string };

export function ReaderAuthControl() {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading", label: "Checking sign-in" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuthState = useCallback(async () => {
    configureAmplifyClient();
    try {
      await getCurrentUser();
      const attributes = await fetchUserAttributes();
      setAuthState({ status: "signedIn", label: attributes.email ?? "Signed in" });
      setError(null);
    } catch {
      setAuthState({ status: "signedOut", label: "Signed out" });
    }
  }, []);

  useEffect(() => {
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
  }, [refreshAuthState]);

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

  const signedIn = authState.status === "signedIn";
  return (
    <div className="reader-auth" aria-live="polite">
      {signedIn ? <span className="reader-auth__identity">{authState.label}</span> : null}
      {error ? <span className="reader-auth__error">{error}</span> : null}
      <button
        className="reader-auth__button"
        disabled={authState.status === "loading" || busy}
        onClick={signedIn ? signOutCurrentUser : signIn}
        type="button"
      >
        {signedIn ? "Sign out" : "Sign in"}
      </button>
    </div>
  );
}

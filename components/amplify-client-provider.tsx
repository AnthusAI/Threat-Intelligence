"use client";

import "aws-amplify/auth/enable-oauth-listener";
import { Amplify, type ResourcesConfig } from "aws-amplify";
import amplifyOutputs from "../amplify_outputs.json";

let configured = false;

export function configureAmplifyClient() {
  if (configured) return;
  if (redirectLoopbackToLocalhost()) return;
  Amplify.configure(prioritizeCurrentOrigin(amplifyOutputs as ResourcesConfig), { ssr: true });
  configured = true;
}

export function AmplifyClientProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  configureAmplifyClient();
  return children;
}

function prioritizeCurrentOrigin(config: ResourcesConfig): ResourcesConfig {
  if (typeof window === "undefined") return config;
  const auth = (config as { auth?: { oauth?: Record<string, unknown> } }).auth;
  const oauth = auth?.oauth;
  if (!auth || !oauth) return config;
  const origin = normalizeUrlOrigin(window.location.origin);
  const reorder = (urls: unknown) => {
    if (!Array.isArray(urls)) return urls;
    const normalized = urls.filter((value): value is string => typeof value === "string");
    const head = normalized.filter((value) => normalizeUrlOrigin(value) === origin);
    if (!head.length) return normalized;
    const tail = normalized.filter((value) => normalizeUrlOrigin(value) !== origin);
    return [...head, ...tail];
  };
  return {
    ...config,
    auth: {
      ...auth,
      oauth: {
        ...oauth,
        redirect_sign_in_uri: reorder(oauth.redirect_sign_in_uri),
        redirect_sign_out_uri: reorder(oauth.redirect_sign_out_uri),
      },
    },
  } as ResourcesConfig;
}

function redirectLoopbackToLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname, port, pathname, search, hash } = window.location;
  if (hostname !== "127.0.0.1" && hostname !== "::1") return false;
  const target = `${protocol}//localhost${port ? `:${port}` : ""}${pathname}${search}${hash}`;
  window.location.replace(target);
  return true;
}

function normalizeUrlOrigin(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    const hostname = normalizeLoopbackHostname(parsed.hostname);
    return `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return trimmed;
  }
}

function normalizeLoopbackHostname(hostname: string): string {
  if (hostname === "127.0.0.1" || hostname === "::1") return "localhost";
  return hostname;
}

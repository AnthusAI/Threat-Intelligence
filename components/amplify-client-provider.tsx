"use client";

import "aws-amplify/auth/enable-oauth-listener";
import { Amplify, type ResourcesConfig } from "aws-amplify";
import amplifyOutputs from "../amplify_outputs.json";

let configured = false;

export function configureAmplifyClient() {
  if (configured) return;
  Amplify.configure(amplifyOutputs as ResourcesConfig, { ssr: true });
  configured = true;
}

export function AmplifyClientProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  configureAmplifyClient();
  return children;
}

import fs from "node:fs";
import path from "node:path";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { Amplify, type ResourcesConfig } from "aws-amplify";

type AmplifyServerRuntime = ReturnType<typeof createServerRunner> & {
  config: ResourcesConfig;
};

let cachedRuntime: AmplifyServerRuntime | null = null;

export function getAmplifyServerRuntime(): AmplifyServerRuntime {
  if (cachedRuntime) return cachedRuntime;

  const config = loadAmplifyOutputs();
  Amplify.configure(config, { ssr: true });
  cachedRuntime = {
    ...createServerRunner({ config }),
    config,
  };
  return cachedRuntime;
}

export function hasAmplifyOutputs(): boolean {
  return fs.existsSync(getAmplifyOutputsPath());
}

function loadAmplifyOutputs(): ResourcesConfig {
  const outputsPath = getAmplifyOutputsPath();
  if (!fs.existsSync(outputsPath)) {
    throw new Error(
      "Papyrus requires amplify_outputs.json for GraphQL content. Run `npx ampx sandbox` or deploy the Amplify backend first.",
    );
  }

  return JSON.parse(fs.readFileSync(outputsPath, "utf8")) as ResourcesConfig;
}

function getAmplifyOutputsPath(): string {
  return path.join(process.cwd(), "amplify_outputs.json");
}

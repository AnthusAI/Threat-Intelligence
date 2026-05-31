import fs from "node:fs";
import path from "node:path";

export function getAmplifyOutputsPath(): string {
  const explicit = process.env.PAPYRUS_AMPLIFY_OUTPUTS?.trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(process.cwd(), explicit);
  }
  return path.join(process.cwd(), "amplify_outputs.json");
}

export function readAmplifyOutputsFile(): Record<string, unknown> | null {
  const outputsPath = getAmplifyOutputsPath();
  if (!fs.existsSync(outputsPath)) return null;
  return JSON.parse(fs.readFileSync(outputsPath, "utf8")) as Record<string, unknown>;
}

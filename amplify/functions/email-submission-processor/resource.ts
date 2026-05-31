import { defineFunction } from "@aws-amplify/backend";
import { Duration } from "aws-cdk-lib";
import { Architecture, Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../../..");

function bundleEmailSubmissionProcessor(outputDir: string): void {
  const packageDir = path.join(outputDir, "papyrus_newsroom");
  const contentDir = path.join(outputDir, "papyrus_content");
  const knowledgeDir = path.join(outputDir, "papyrus_knowledge_query");
  const corporaDir = path.join(outputDir, "corpora");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.mkdirSync(corporaDir, { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "amplify/functions/email-submission-processor/handler.py"),
    path.join(outputDir, "handler.py"),
  );
  fs.cpSync(path.join(projectRoot, "src/papyrus_newsroom"), packageDir, { recursive: true });
  fs.cpSync(path.join(projectRoot, "src/papyrus_content"), contentDir, { recursive: true });
  fs.cpSync(path.join(projectRoot, "src/papyrus_knowledge_query"), knowledgeDir, { recursive: true });
  for (const entry of fs.readdirSync(path.join(projectRoot, "corpora"))) {
    if (!entry.endsWith(".yml")) continue;
    fs.copyFileSync(path.join(projectRoot, "corpora", entry), path.join(corporaDir, entry));
  }
  installPythonRequirements(outputDir);
}

function installPythonRequirements(outputDir: string): void {
  const requirementsPath = path.join(
    projectRoot,
    "amplify/functions/email-submission-processor/requirements.txt",
  );
  execSync(`python3 -m pip install -r "${requirementsPath}" -t "${outputDir}" --no-cache-dir`, {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

export const emailSubmissionProcessor = defineFunction(
  (scope: Construct) => {
    return new Function(scope, "papyrus-email-submission-processor", {
      runtime: Runtime.PYTHON_3_12,
      architecture: Architecture.ARM_64,
      handler: "handler.handler",
      timeout: Duration.minutes(5),
      memorySize: 1024,
      code: Code.fromAsset(projectRoot, {
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              bundleEmailSubmissionProcessor(outputDir);
              return true;
            },
          },
          command: [
            "bash",
            "-c",
            [
              "set -euo pipefail",
              "mkdir -p /asset-output/papyrus_newsroom /asset-output/papyrus_content /asset-output/papyrus_knowledge_query /asset-output/corpora",
              "cp amplify/functions/email-submission-processor/handler.py /asset-output/handler.py",
              "cp -R src/papyrus_newsroom/. /asset-output/papyrus_newsroom/",
              "cp -R src/papyrus_content/. /asset-output/papyrus_content/",
              "cp -R src/papyrus_knowledge_query/. /asset-output/papyrus_knowledge_query/",
              "cp corpora/papyrus-steering.yml /asset-output/corpora/papyrus-steering.yml",
              "python3 -m pip install -r amplify/functions/email-submission-processor/requirements.txt -t /asset-output --no-cache-dir",
            ].join(" && "),
          ],
        },
      }),
    });
  },
  { resourceGroupName: "data" },
);

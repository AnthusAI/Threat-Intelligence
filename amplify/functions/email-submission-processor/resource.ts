import { defineFunction } from "@aws-amplify/backend";
import { Duration } from "aws-cdk-lib";
import { Architecture, Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../../..");

function bundleEmailSubmissionProcessor(outputDir: string): void {
  const packageDir = path.join(outputDir, "papyrus_newsroom");
  const contentDir = path.join(outputDir, "papyrus_content");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "amplify/functions/email-submission-processor/handler.py"),
    path.join(outputDir, "handler.py"),
  );
  fs.cpSync(path.join(projectRoot, "src/papyrus_newsroom"), packageDir, { recursive: true });
  fs.cpSync(path.join(projectRoot, "src/papyrus_content"), contentDir, { recursive: true });
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
              "mkdir -p /asset-output/papyrus_newsroom /asset-output/papyrus_content",
              "cp amplify/functions/email-submission-processor/handler.py /asset-output/handler.py",
              "cp -R src/papyrus_newsroom/. /asset-output/papyrus_newsroom/",
              "cp -R src/papyrus_content/. /asset-output/papyrus_content/",
            ].join(" && "),
          ],
        },
      }),
    });
  },
  { resourceGroupName: "storage" },
);

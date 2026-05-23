import { defineFunction } from "@aws-amplify/backend";
import { Duration } from "aws-cdk-lib";
import { Architecture, Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../../..");

function storageBucketName(): string {
  if (process.env.PAPYRUS_STORAGE_BUCKET_NAME) return process.env.PAPYRUS_STORAGE_BUCKET_NAME;

  const outputsPath = path.join(projectRoot, "amplify_outputs.json");
  if (!fs.existsSync(outputsPath)) return "";

  try {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf8")) as {
      storage?: { bucket_name?: string };
    };
    return outputs.storage?.bucket_name ?? "";
  } catch {
    return "";
  }
}

function bundleKnowledgeQuery(outputDir: string): void {
  const packageDir = path.join(outputDir, "papyrus_knowledge_query");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "amplify/functions/knowledge-query/handler.py"),
    path.join(outputDir, "handler.py"),
  );
  fs.cpSync(path.join(projectRoot, "src/papyrus_knowledge_query"), packageDir, {
    recursive: true,
  });
}

export const knowledgeQuery = defineFunction(
  (scope: Construct) => {
    return new Function(scope, "papyrus-knowledge-query", {
      runtime: Runtime.PYTHON_3_12,
      architecture: Architecture.ARM_64,
      handler: "handler.handler",
      timeout: Duration.seconds(300),
      memorySize: 512,
      environment: {
        PAPYRUS_STORAGE_BUCKET_NAME: storageBucketName(),
      },
      code: Code.fromAsset(projectRoot, {
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              bundleKnowledgeQuery(outputDir);
              return true;
            },
          },
          command: [
            "bash",
            "-c",
            [
              "set -euo pipefail",
              "mkdir -p /asset-output/papyrus_knowledge_query",
              "cp amplify/functions/knowledge-query/handler.py /asset-output/handler.py",
              "cp -R src/papyrus_knowledge_query/. /asset-output/papyrus_knowledge_query/",
            ].join(" && "),
          ],
        },
      }),
    });
  },
  { resourceGroupName: "data" },
);

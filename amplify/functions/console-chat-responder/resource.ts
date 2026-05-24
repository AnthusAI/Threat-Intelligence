import { Duration, NestedStack, type NestedStackProps } from "aws-cdk-lib";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, CfnEventSourceMapping, DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export type ConsoleChatResponderStackProps = NestedStackProps & {
  messageTable: ITable;
  messageStreamArn: string;
  threadTable: ITable;
  projectRoot: string;
  graphqlEndpoint: string;
  responseTarget?: string;
  model?: string;
  prebuiltImageUri?: string;
};

export class ConsoleChatResponderStack extends NestedStack {
  public readonly responderFunction: DockerImageFunction;

  constructor(scope: Construct, id: string, props: ConsoleChatResponderStackProps) {
    super(scope, id, props);

    const responseTarget = props.responseTarget?.trim() || "cloud";
    const environment: Record<string, string> = {
      PAPYRUS_MESSAGE_TABLE_NAME: props.messageTable.tableName,
      PAPYRUS_MESSAGE_THREAD_TABLE_NAME: props.threadTable.tableName,
      PAPYRUS_MESSAGE_THREAD_SEQUENCE_INDEX_NAME: "messagesByThreadSequence",
      PAPYRUS_GRAPHQL_ENDPOINT: props.graphqlEndpoint,
      PAPYRUS_CONSOLE_RESPONSE_TARGET: responseTarget,
      PAPYRUS_CONSOLE_MODEL: props.model?.trim() || process.env.PAPYRUS_CONSOLE_MODEL || "gpt-4o-mini",
      PAPYRUS_CONSOLE_CONTEXT_CACHE_ROOT: "/tmp/papyrus-console/thread-context",
    };

    const imageUri = props.prebuiltImageUri?.trim() || process.env.PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI?.trim() || "";
    let code: DockerImageCode;
    if (imageUri) {
      const { repositoryName, tagOrDigest } = parseEcrImageUri(imageUri);
      const repository = Repository.fromRepositoryName(this, "ConsoleChatResponderRepository", repositoryName);
      code = DockerImageCode.fromEcr(repository, { tagOrDigest });
    } else {
      code = DockerImageCode.fromImageAsset(props.projectRoot, {
        file: "amplify/functions/console-chat-responder/Dockerfile",
        platform: Platform.LINUX_ARM64,
        exclude: [
          ".git",
          ".env",
          ".env.*",
          ".next",
          ".amplify",
          "node_modules",
          "coverage",
          "dist",
          "out",
          "corpora",
          ".papyrus-runs",
          "amplify_outputs.json",
          "amplify_outputs.json.*",
          "amplify/functions/console-chat-responder/target",
        ],
      });
    }

    this.responderFunction = new DockerImageFunction(this, "ConsoleChatResponderFunction", {
      code,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(2),
      memorySize: 1024,
      environment,
      description: "Rust responder for Papyrus editor console chat Message stream",
    });

    new CfnEventSourceMapping(this, "ConsoleResponderMessageStreamMapping", {
      batchSize: 1,
      eventSourceArn: props.messageStreamArn,
      functionName: this.responderFunction.functionArn,
      functionResponseTypes: ["ReportBatchItemFailures"],
      maximumRetryAttempts: 2,
      startingPosition: "LATEST",
    });

    props.messageTable.grantReadWriteData(this.responderFunction);
    props.threadTable.grantReadWriteData(this.responderFunction);
    this.responderFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["dynamodb:Query"],
      resources: [
        `${props.messageTable.tableArn}/index/*`,
        `${props.threadTable.tableArn}/index/*`,
      ],
    }));
    this.responderFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: ["*"],
    }));
    this.responderFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["appsync:GraphQL"],
      resources: ["*"],
    }));
    this.responderFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams",
      ],
      resources: [props.messageStreamArn],
    }));
  }
}

function parseEcrImageUri(imageUri: string): { repositoryName: string; tagOrDigest: string } {
  const trimmed = imageUri.trim();
  const hostAndPath = trimmed.split("/");
  if (hostAndPath.length < 2) {
    throw new Error(`Invalid PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI: ${trimmed}`);
  }
  const imagePath = hostAndPath.slice(1).join("/");
  if (imagePath.includes("@sha256:")) {
    const [repositoryName, digest] = imagePath.split("@", 2);
    if (!repositoryName || !digest) {
      throw new Error(`Invalid PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI digest form: ${trimmed}`);
    }
    return { repositoryName, tagOrDigest: digest };
  }
  const colonIndex = imagePath.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex === imagePath.length - 1) {
    throw new Error(`PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI must include a tag (repo:tag) or digest: ${trimmed}`);
  }
  return {
    repositoryName: imagePath.slice(0, colonIndex),
    tagOrDigest: imagePath.slice(colonIndex + 1),
  };
}

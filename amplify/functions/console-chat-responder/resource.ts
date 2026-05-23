import { Duration, NestedStack, type NestedStackProps } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export type ConsoleChatResponderStackProps = NestedStackProps & {
  messageTable: ITable;
  threadTable: ITable;
  projectRoot: string;
  responseTarget?: string;
  openaiApiKeySsmParam?: string;
  model?: string;
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
      PAPYRUS_CONSOLE_RESPONSE_TARGET: responseTarget,
      PAPYRUS_CONSOLE_MODEL: props.model?.trim() || process.env.PAPYRUS_CONSOLE_MODEL || "gpt-4o-mini",
      PAPYRUS_CONSOLE_CONTEXT_CACHE_ROOT: "/tmp/papyrus-console/thread-context",
    };
    const openaiParam = props.openaiApiKeySsmParam?.trim() || process.env.PAPYRUS_CONSOLE_OPENAI_API_KEY_SSM_PARAM || "";
    if (openaiParam) environment.PAPYRUS_CONSOLE_OPENAI_API_KEY_SSM_PARAM = openaiParam;

    this.responderFunction = new DockerImageFunction(this, "ConsoleChatResponderFunction", {
      code: DockerImageCode.fromImageAsset(props.projectRoot, {
        file: "amplify/functions/console-chat-responder/Dockerfile",
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
      }),
      timeout: Duration.minutes(2),
      memorySize: 1024,
      environment,
      description: "Rust responder for Papyrus editor console chat Message stream",
    });

    this.responderFunction.addEventSource(new DynamoEventSource(props.messageTable, {
      startingPosition: StartingPosition.LATEST,
      batchSize: 1,
      reportBatchItemFailures: true,
      retryAttempts: 2,
    }));

    props.messageTable.grantReadWriteData(this.responderFunction);
    props.threadTable.grantReadWriteData(this.responderFunction);
    this.responderFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: ["*"],
    }));
  }
}

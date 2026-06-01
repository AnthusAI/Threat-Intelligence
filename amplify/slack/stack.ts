import { NestedStack, type NestedStackProps } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CfnEventSourceMapping, FunctionUrlAuthType, type IFunction } from "aws-cdk-lib/aws-lambda";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export type SlackAgentStackProps = NestedStackProps & {
  slackEventsFunction: IFunction;
  slackDeliveryFunction: IFunction;
  messageTable: ITable;
  messageStreamArn: string;
  graphqlEndpoint: string;
};

/** Public Slack Events endpoint and assistant reply delivery on the Message stream. */
export class SlackAgentStack extends NestedStack {
  public readonly eventsFunctionUrl: string;

  constructor(scope: Construct, id: string, props: SlackAgentStackProps) {
    super(scope, id, props);

    props.slackDeliveryFunction.addEnvironment("PAPYRUS_GRAPHQL_ENDPOINT", props.graphqlEndpoint);

    const functionUrl = props.slackEventsFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });
    this.eventsFunctionUrl = functionUrl.url;

    new CfnEventSourceMapping(this, "SlackDeliveryMessageStreamMapping", {
      batchSize: 1,
      eventSourceArn: props.messageStreamArn,
      functionName: props.slackDeliveryFunction.functionArn,
      functionResponseTypes: ["ReportBatchItemFailures"],
      maximumRetryAttempts: 2,
      startingPosition: "LATEST",
    });

    props.messageTable.grantStreamRead(props.slackDeliveryFunction);
    props.messageTable.grantReadData(props.slackDeliveryFunction);
    props.slackDeliveryFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["appsync:GraphQL"],
        resources: ["*"],
      }),
    );
  }
}

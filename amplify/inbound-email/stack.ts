import { Duration, type StackProps } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export type InboundEmailStackProps = StackProps & {
  storageBucket: s3.IBucket;
  receiveFunctionArn: string;
};

/** EventBridge triggers live in the data stack with the receive Lambda. */
export class InboundEmailStack extends Construct {
  constructor(scope: Construct, id: string, props: InboundEmailStackProps) {
    super(scope, id);

    const receiveFunction = lambda.Function.fromFunctionArn(
      this,
      "InboundReceiveFunction",
      props.receiveFunctionArn,
    );

    const objectCreatedRule = new events.Rule(this, "PapyrusInboundEmailObjectCreated", {
      description: "Process inbound SES MIME objects stored under inbound-email/",
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [props.storageBucket.bucketName] },
          object: { key: [{ prefix: "inbound-email/" }] },
        },
      },
      targets: [new eventTargets.LambdaFunction(receiveFunction)],
    });

    // fromFunctionArn does not create invoke permissions; EventBridge needs an explicit grant.
    receiveFunction.addPermission("AllowInboundEmailEventBridgeInvoke", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: objectCreatedRule.ruleArn,
    });

    const retrySweepRule = new events.Rule(this, "PapyrusInboundEmailRetrySweep", {
      description: "Re-process inbound MIME objects left in inbound-email/ after failures",
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [
        new eventTargets.LambdaFunction(receiveFunction, {
          event: events.RuleTargetInput.fromObject({
            source: "papyrus.inbound-email",
            action: "retry-pending",
          }),
        }),
      ],
    });
    receiveFunction.addPermission("AllowInboundEmailRetrySweepInvoke", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceArn: retrySweepRule.ruleArn,
    });
  }
}

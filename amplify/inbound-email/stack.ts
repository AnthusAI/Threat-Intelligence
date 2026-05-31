import { type StackProps } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export type InboundEmailStackProps = StackProps & {
  storageBucket: s3.IBucket;
  receiveFunctionArn: string;
};

/** EventBridge trigger in its own nested stack to avoid storage/data circular dependencies. */
export class InboundEmailStack extends Construct {
  constructor(scope: Construct, id: string, props: InboundEmailStackProps) {
    super(scope, id);

    const receiveFunction = lambda.Function.fromFunctionArn(
      this,
      "InboundReceiveFunction",
      props.receiveFunctionArn,
    );

    new events.Rule(this, "PapyrusInboundEmailObjectCreated", {
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
  }
}

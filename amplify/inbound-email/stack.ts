import { Duration, NestedStack, type NestedStackProps } from "aws-cdk-lib";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import { Construct } from "constructs";

export type InboundEmailStackProps = NestedStackProps & {
  storageBucket: s3.IBucket;
  receiveFunction: IFunction;
  domain: string;
  localParts: string[];
};

export class InboundEmailStack extends NestedStack {
  public readonly ruleSet: ses.ReceiptRuleSet;

  constructor(scope: Construct, id: string, props: InboundEmailStackProps) {
    super(scope, id, props);

    const recipients = props.localParts.map((localPart) => `${localPart}@${props.domain}`);
    this.ruleSet = new ses.ReceiptRuleSet(this, "PapyrusInboundEmailRuleSet", {
      receiptRuleSetName: `papyrus-inbound-${props.domain.replace(/\./g, "-")}`,
    });

    this.ruleSet.addRule("PapyrusInboundSubmissions", {
      recipients,
      enabled: true,
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.REQUIRE,
      actions: [
        new sesActions.S3({
          bucket: props.storageBucket,
          objectKeyPrefix: "inbound-email/",
        }),
        new sesActions.Lambda({
          function: props.receiveFunction,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
    });

    new AwsCustomResource(this, "ActivateInboundRuleSet", {
      onCreate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {
          RuleSetName: this.ruleSet.receiptRuleSetName,
        },
        physicalResourceId: PhysicalResourceId.of(`activate-${this.ruleSet.receiptRuleSetName}`),
      },
      onUpdate: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {
          RuleSetName: this.ruleSet.receiptRuleSetName,
        },
        physicalResourceId: PhysicalResourceId.of(`activate-${this.ruleSet.receiptRuleSetName}`),
      },
      onDelete: {
        service: "SES",
        action: "setActiveReceiptRuleSet",
        parameters: {
          RuleSetName: null,
        },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      timeout: Duration.minutes(2),
    });
  }
}

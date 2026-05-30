import { Duration, NestedStack, type NestedStackProps } from "aws-cdk-lib";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import { Construct } from "constructs";

export type InboundEmailStackProps = NestedStackProps & {
  storageBucket: s3.IBucket;
  receiveFunction: LambdaFunction;
  processorFunction: LambdaFunction;
  domain: string;
  localParts: string[];
  corpusKey: string;
  graphqlEndpoint: string;
};

export class InboundEmailStack extends NestedStack {
  public readonly ruleSet: ses.ReceiptRuleSet;

  constructor(scope: Construct, id: string, props: InboundEmailStackProps) {
    super(scope, id, props);

    const recipients = props.localParts.map((localPart) => `${localPart}@${props.domain}`);
    this.ruleSet = new ses.ReceiptRuleSet(this, "PapyrusInboundEmailRuleSet", {
      receiptRuleSetName: `papyrus-inbound-${props.domain.replace(/\./g, "-")}`,
    });

    props.receiveFunction.addEnvironment("PAPYRUS_EMAIL_SUBMISSION_PROCESSOR_FUNCTION_NAME", props.processorFunction.functionName);
    props.receiveFunction.addEnvironment("PAPYRUS_INBOUND_EMAIL_DOMAIN", props.domain);
    props.receiveFunction.addEnvironment("PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS", props.localParts.join(","));
    props.receiveFunction.addEnvironment("PAPYRUS_INBOUND_EMAIL_CORPUS_KEY", props.corpusKey);
    props.receiveFunction.addEnvironment("PAPYRUS_GRAPHQL_ENDPOINT", props.graphqlEndpoint);

    props.processorFunction.addEnvironment("PAPYRUS_INBOUND_EMAIL_CORPUS_KEY", props.corpusKey);
    props.processorFunction.addEnvironment("PAPYRUS_GRAPHQL_ENDPOINT", props.graphqlEndpoint);

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

    props.storageBucket.grantRead(props.receiveFunction, "inbound-email/*");
    props.receiveFunction.addPermission("AllowSesInvoke", {
      principal: new iam.ServicePrincipal("ses.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceAccount: this.account,
    });
    props.processorFunction.grantInvoke(props.receiveFunction);

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

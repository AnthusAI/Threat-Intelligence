import { defineBackend, secret } from "@aws-amplify/backend";
import { Duration, Stack } from "aws-cdk-lib";
import * as backup from "aws-cdk-lib/aws-backup";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { CfnIndex, CfnVectorBucket, CfnVectorBucketPolicy } from "aws-cdk-lib/aws-s3vectors";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { assignmentAction } from "./functions/assignment-action/resource";
import { categoryAction } from "./functions/category-action/resource";
import { ConsoleChatResponderStack } from "./functions/console-chat-responder/resource";
import { graphqlJwtAuthorizer } from "./functions/graphql-jwt-authorizer/resource";
import { knowledgeQuery } from "./functions/knowledge-query/resource";
import { manageUserRole } from "./functions/manage-user-role/resource";
import { modelAttachmentUpload } from "./functions/model-attachment-upload/resource";
import { newsroomSummary } from "./functions/newsroom-summary/resource";
import { procedureAction } from "./functions/procedure-action/resource";
import { readerSettings } from "./functions/reader-settings/resource";
import { emailSubmissionProcessor } from "./functions/email-submission-processor/resource";
import { sesInboundReceive } from "./functions/ses-inbound-receive/resource";
import { InboundEmailStack } from "./inbound-email/stack";
import { storage } from "./storage/resource";

const knowledgeVectorIndexName = "papyrus-knowledge";
const knowledgeVectorDimension = 1536;
const knowledgeEmbeddingModel = "text-embedding-3-small";

const enableInboundEmail = !["0", "false", "no", "off"].includes(
  (process.env.PAPYRUS_ENABLE_INBOUND_EMAIL ?? "true").trim().toLowerCase(),
);

const backend = defineBackend({
  assignmentAction,
  auth,
  categoryAction,
  data,
  graphqlJwtAuthorizer,
  knowledgeQuery,
  manageUserRole,
  modelAttachmentUpload,
  newsroomSummary,
  procedureAction,
  readerSettings,
  emailSubmissionProcessor,
  sesInboundReceive,
  storage,
});

const amplifyBackendDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(amplifyBackendDir, "..");
const enableConsoleResponder = !["0", "false", "no", "off"].includes(
  (process.env.PAPYRUS_ENABLE_CONSOLE_RESPONDER ?? "true").trim().toLowerCase(),
);
const inboundEmailDomain = (process.env.PAPYRUS_INBOUND_EMAIL_DOMAIN ?? "p.apyr.us").trim().toLowerCase();
const inboundEmailLocalParts = (process.env.PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS ?? "submissions,suggestions")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
const inboundEmailCorpusKey = (process.env.PAPYRUS_INBOUND_EMAIL_CORPUS_KEY ?? "AI-ML-research").trim();
const inboundDnsZoneId = (process.env.PAPYRUS_ROUTE53_HOSTED_ZONE_ID ?? "Z10285921B1G7MVRV06W9").trim();
const inboundDnsZoneName = (process.env.PAPYRUS_ROUTE53_HOSTED_ZONE_NAME ?? "apyr.us").trim().replace(/\.$/, "");
const inboundDnsRecordName = inboundEmailDomain.endsWith(`.${inboundDnsZoneName}`)
  ? inboundEmailDomain.slice(0, -(inboundDnsZoneName.length + 1))
  : inboundEmailDomain;

if (enableConsoleResponder) {
  const messageTable = backend.data.resources.tables.Message;
  const cfnTables = backend.data.resources.cfnResources.cfnTables;
  const messageCfnTable =
    cfnTables.Message
    ?? cfnTables.MessageTable
    ?? Object.entries(cfnTables).find(([key]) => {
      const normalized = key.toLowerCase();
      return normalized.includes("message") && !normalized.includes("thread");
    })?.[1];

  if (messageCfnTable) {
    messageCfnTable.streamSpecification = {
      streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
    };
  }

  const messageStreamArn = messageTable.tableStreamArn ?? messageCfnTable?.attrStreamArn;
  if (!messageStreamArn) {
    throw new Error(`ConsoleChatResponder requires Message table stream ARN. cfnTables=${Object.keys(cfnTables).join(",")}`);
  }

  const messageThreadTable = backend.data.resources.tables.MessageThread;

  const dataStack = Stack.of(messageTable);
  new ConsoleChatResponderStack(dataStack, "ConsoleChatResponder", {
    messageTable,
    messageStreamArn,
    threadTable: messageThreadTable,
    projectRoot,
    graphqlEndpoint: backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl,
    responseTarget: process.env.PAPYRUS_CONSOLE_RESPONSE_TARGET,
    model: process.env.PAPYRUS_CONSOLE_MODEL,
    prebuiltImageUri: process.env.PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI,
  });
}

const storageBucket = backend.storage.resources.bucket;
const storageStack = Stack.of(storageBucket);

const storageBucketCfn = storageBucket.node.defaultChild as s3.CfnBucket | undefined;
if (storageBucketCfn) {
  // S3 PITR in AWS Backup requires S3 event delivery through EventBridge.
  storageBucketCfn.addPropertyOverride(
    "NotificationConfiguration.EventBridgeConfiguration.EventBridgeEnabled",
    true,
  );
}

const storageBackupVault = new backup.BackupVault(storageStack, "PapyrusStorageBackupVault");
const storageBackupPlan = new backup.BackupPlan(storageStack, "PapyrusStorageBackupPlan", {
  backupVault: storageBackupVault,
});

storageBackupPlan.addRule(
  new backup.BackupPlanRule({
    ruleName: "papyrus-storage-pitr-35d",
    enableContinuousBackup: true,
    deleteAfter: Duration.days(35),
  }),
);

storageBackupPlan.addRule(
  new backup.BackupPlanRule({
    ruleName: "papyrus-storage-daily-365d",
    scheduleExpression: events.Schedule.cron({ minute: "0", hour: "5" }),
    deleteAfter: Duration.days(365),
  }),
);

storageBackupPlan.addSelection("PapyrusStorageBackupSelection", {
  allowRestores: true,
  resources: [backup.BackupResource.fromArn(storageBucket.bucketArn)],
});

if (enableInboundEmail) {
  if (!backend.sesInboundReceive || !backend.emailSubmissionProcessor) {
    throw new Error("Inbound email is enabled but sesInboundReceive/emailSubmissionProcessor were not registered.");
  }
  const receiveLambda = backend.sesInboundReceive.resources.lambda as LambdaFunction;
  const processorLambda = backend.emailSubmissionProcessor.resources.lambda as LambdaFunction;
  const graphqlEndpoint = backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl;

  backend.sesInboundReceive.addEnvironment(
    "PAPYRUS_EMAIL_SUBMISSION_PROCESSOR_FUNCTION_NAME",
    processorLambda.functionName,
  );
  backend.sesInboundReceive.addEnvironment("PAPYRUS_INBOUND_EMAIL_DOMAIN", inboundEmailDomain);
  backend.sesInboundReceive.addEnvironment("PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS", inboundEmailLocalParts.join(","));
  backend.sesInboundReceive.addEnvironment("PAPYRUS_INBOUND_EMAIL_CORPUS_KEY", inboundEmailCorpusKey);
  backend.sesInboundReceive.addEnvironment("PAPYRUS_JWT_SECRET", secret("PAPYRUS_JWT_SECRET"));
  backend.sesInboundReceive.addEnvironment("PAPYRUS_GRAPHQL_ENDPOINT", graphqlEndpoint);

  backend.emailSubmissionProcessor.addEnvironment("PAPYRUS_JWT_SECRET", secret("PAPYRUS_JWT_SECRET"));
  backend.emailSubmissionProcessor.addEnvironment("PAPYRUS_INBOUND_EMAIL_CORPUS_KEY", inboundEmailCorpusKey);
  backend.emailSubmissionProcessor.addEnvironment("PAPYRUS_GRAPHQL_ENDPOINT", graphqlEndpoint);

  receiveLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [processorLambda.functionArn],
    }),
  );
  receiveLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [`${storageBucket.bucketArn}/inbound-email/*`],
    }),
  );
  receiveLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:${backend.stack.region}:${backend.stack.account}:parameter/amplify/*`,
        `arn:aws:ssm:${backend.stack.region}:${backend.stack.account}:parameter/amplify/shared/*`,
      ],
    }),
  );
  processorLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["appsync:GraphQL"],
      resources: ["*"],
    }),
  );
  processorLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:${backend.stack.region}:${backend.stack.account}:parameter/amplify/*`,
        `arn:aws:ssm:${backend.stack.region}:${backend.stack.account}:parameter/amplify/shared/*`,
      ],
    }),
  );

  storageBucket.grantRead(receiveLambda, "inbound-email/*");

  new InboundEmailStack(backend.createStack("inbound-email"), "InboundEmail", {
    storageBucket,
    receiveFunctionArn: receiveLambda.functionArn,
    domain: inboundEmailDomain,
    localParts: inboundEmailLocalParts,
    dnsZoneId: inboundDnsZoneId,
    dnsZoneName: inboundDnsZoneName,
    dnsRecordName: inboundDnsRecordName,
  });
}

const knowledgeVectorsStack = backend.createStack("knowledge-vectors");
const knowledgeVectorBucket = new CfnVectorBucket(knowledgeVectorsStack, "PapyrusKnowledgeVectorBucket", {
  encryptionConfiguration: {
    sseType: "AES256",
  },
});
const knowledgeVectorIndex = new CfnIndex(knowledgeVectorsStack, "PapyrusKnowledgeVectorIndex", {
  dataType: "float32",
  dimension: knowledgeVectorDimension,
  distanceMetric: "cosine",
  indexName: knowledgeVectorIndexName,
  metadataConfiguration: {
    nonFilterableMetadataKeys: ["text", "summary", "sourceUri", "title"],
  },
  vectorBucketArn: knowledgeVectorBucket.attrVectorBucketArn,
});
knowledgeVectorIndex.node.addDependency(knowledgeVectorBucket);
const knowledgeVectorBucketPolicy = new CfnVectorBucketPolicy(knowledgeVectorsStack, "PapyrusKnowledgeVectorBucketPolicy", {
  vectorBucketArn: knowledgeVectorBucket.attrVectorBucketArn,
  policy: {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowSameAccountPapyrusKnowledgeVectorAccess",
        Effect: "Allow",
        Principal: {
          AWS: `arn:aws:iam::${knowledgeVectorsStack.account}:root`,
        },
        Action: [
          "s3vectors:GetIndex",
          "s3vectors:GetVectors",
          "s3vectors:ListVectors",
          "s3vectors:PutVectors",
          "s3vectors:QueryVectors",
          "s3vectors:DeleteVectors",
        ],
        Resource: [
          knowledgeVectorBucket.attrVectorBucketArn,
          knowledgeVectorIndex.attrIndexArn,
        ],
      },
    ],
  },
});
knowledgeVectorBucketPolicy.node.addDependency(knowledgeVectorIndex);

const knowledgeQueryLambda = backend.knowledgeQuery.resources.lambda as LambdaFunction;
backend.knowledgeQuery.addEnvironment("OPENAI_API_KEY", secret("OPENAI_API_KEY"));
knowledgeQueryLambda.addEnvironment(
  "PAPYRUS_GRAPHQL_ENDPOINT",
  backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl,
);
knowledgeQueryLambda.addEnvironment("PAPYRUS_S3_VECTOR_INDEX_ARN", knowledgeVectorIndex.attrIndexArn);
knowledgeQueryLambda.addEnvironment("PAPYRUS_S3_VECTOR_INDEX_NAME", knowledgeVectorIndexName);
knowledgeQueryLambda.addEnvironment("PAPYRUS_EMBEDDING_MODEL", knowledgeEmbeddingModel);
knowledgeQueryLambda.addEnvironment("PAPYRUS_EMBEDDING_DIMENSIONS", String(knowledgeVectorDimension));
knowledgeQueryLambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "s3vectors:GetIndex",
      "s3vectors:GetVectors",
      "s3vectors:ListVectors",
      "s3vectors:QueryVectors",
    ],
    resources: [knowledgeVectorIndex.attrIndexArn],
  }),
);
knowledgeQueryLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${knowledgeVectorsStack.region}:${knowledgeVectorsStack.account}:parameter/amplify/papyrus/*/OPENAI_API_KEY`,
      `arn:aws:ssm:${knowledgeVectorsStack.region}:${knowledgeVectorsStack.account}:parameter/amplify/shared/papyrus/OPENAI_API_KEY`,
    ],
  }),
);

backend.addOutput({
  custom: {
    inboundEmail: enableInboundEmail
      ? {
          domain: inboundEmailDomain,
          localParts: inboundEmailLocalParts,
          addresses: inboundEmailLocalParts.map((localPart) => `${localPart}@${inboundEmailDomain}`),
          corpusKey: inboundEmailCorpusKey,
        }
      : null,
    knowledgeQuery: {
      s3VectorBucketArn: knowledgeVectorBucket.attrVectorBucketArn,
      s3VectorIndexArn: knowledgeVectorIndex.attrIndexArn,
      s3VectorIndexName: knowledgeVectorIndexName,
      embeddingModel: knowledgeEmbeddingModel,
      embeddingDimensions: knowledgeVectorDimension,
    },
    storageBackups: {
      backupPlanId: storageBackupPlan.backupPlanId,
      backupVaultArn: storageBackupVault.backupVaultArn,
      backupVaultName: storageBackupVault.backupVaultName,
      protectedBucketArn: storageBucket.bucketArn,
      protectedBucketName: storageBucket.bucketName,
    },
  },
});

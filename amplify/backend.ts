import { defineBackend, secret } from "@aws-amplify/backend";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
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
import { storage } from "./storage/resource";

const knowledgeVectorIndexName = "papyrus-knowledge";
const knowledgeVectorDimension = 1536;
const knowledgeEmbeddingModel = "text-embedding-3-small";

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
  storage,
});

const amplifyBackendDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(amplifyBackendDir, "..");

const messageTable = backend.data.resources.tables.Message;
const messageCfnTable =
  (messageTable.node.defaultChild as dynamodb.CfnTable | undefined) ??
  (messageTable.node.tryFindChild("Resource") as dynamodb.CfnTable | undefined) ??
  backend.data.resources.cfnResources.cfnTables.Message;
if (!messageCfnTable) {
  throw new Error("ConsoleChatResponder requires a Message DynamoDB table resource.");
}
messageCfnTable.streamSpecification = {
  streamViewType: dynamodb.StreamViewType.NEW_IMAGE,
};
if (!messageTable.tableStreamArn) {
  throw new Error("ConsoleChatResponder requires the Message table stream ARN.");
}

const messageThreadTable = backend.data.resources.tables.MessageThread;

new ConsoleChatResponderStack(backend.createStack("console-chat-responder"), "ConsoleChatResponder", {
  messageTable,
  threadTable: messageThreadTable,
  projectRoot,
  responseTarget: process.env.PAPYRUS_CONSOLE_RESPONSE_TARGET,
  openaiApiKeySsmParam: process.env.PAPYRUS_CONSOLE_OPENAI_API_KEY_SSM_PARAM,
  model: process.env.PAPYRUS_CONSOLE_MODEL,
});

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

backend.addOutput({
  custom: {
    knowledgeQuery: {
      s3VectorBucketArn: knowledgeVectorBucket.attrVectorBucketArn,
      s3VectorIndexArn: knowledgeVectorIndex.attrIndexArn,
      s3VectorIndexName: knowledgeVectorIndexName,
      embeddingModel: knowledgeEmbeddingModel,
      embeddingDimensions: knowledgeVectorDimension,
    },
  },
});

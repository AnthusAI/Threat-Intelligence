import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

export const LAMBDA_DATA_AUTH_MODE = "iam" as const;

export type LambdaDataClient = ReturnType<typeof generateClient<Schema>>;

let clientPromise: Promise<LambdaDataClient> | null = null;

export async function getLambdaDataClient(): Promise<LambdaDataClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as never);
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>();
    })();
  }
  return clientPromise;
}

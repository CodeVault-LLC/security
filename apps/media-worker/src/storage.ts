import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface MediaStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface MediaStorage {
  getObject(objectKey: string): Promise<Uint8Array>;
  putObject(
    objectKey: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}

type MediaStorageOperation = "read" | "write" | "delete";

const QUARANTINE_PREFIX = "quarantine/avatars/";
const DERIVATIVE_PREFIX = "derivatives/avatars/";

export function assertMediaStorageAccess(
  operation: MediaStorageOperation,
  objectKey: string,
): void {
  const isSimpleKey =
    objectKey.length > 0 &&
    !objectKey.startsWith("/") &&
    !objectKey.includes("\\") &&
    objectKey
      .split("/")
      .every((segment) => segment !== ".." && segment !== ".");
  const inQuarantine =
    objectKey.startsWith(QUARANTINE_PREFIX) &&
    objectKey.length > QUARANTINE_PREFIX.length;
  const inDerivatives =
    objectKey.startsWith(DERIVATIVE_PREFIX) &&
    objectKey.length > DERIVATIVE_PREFIX.length;
  const allowed =
    isSimpleKey &&
    ((operation === "read" && inQuarantine) ||
      (operation === "write" && inDerivatives) ||
      (operation === "delete" && (inQuarantine || inDerivatives)));

  if (!allowed) throw new Error("Media storage access was denied.");
}

/**
 * Prefix-limited media storage client. Production IAM is expected to deny
 * listing and every key outside quarantine/avatars and derivatives/avatars.
 */
export function createMediaStorage(config: MediaStorageConfig): MediaStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async getObject(objectKey) {
      assertMediaStorageAccess("read", objectKey);
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );
      if (!result.Body) throw new Error("Media input body was unavailable.");
      return new Uint8Array(await result.Body.transformToByteArray());
    },
    async putObject(objectKey, body, contentType) {
      assertMediaStorageAccess("write", objectKey);
      if (contentType !== "image/webp") {
        throw new Error("Media output must be an image/webp derivative.");
      }
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async deleteObject(objectKey) {
      assertMediaStorageAccess("delete", objectKey);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );
    },
  };
}

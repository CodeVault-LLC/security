import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ServerConfig } from "../config.js";

/**
 * Object storage.
 *
 * The API never handles file bytes. It issues short-lived presigned URLs, and
 * the desktop client streams directly to and from storage. Buckets are private;
 * there is no code path that makes an artifact publicly readable.
 */

export interface PresignedUpload {
  strategy: "SINGLE" | "MULTIPART";
  url: string | null;
  multipartUploadId: string | null;
  partUrls: string[];
  partSizeBytes: number;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  etag: string | null;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectStorage {
  createUpload(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    sha256Hex: string,
  ): Promise<PresignedUpload>;
  /**
   * Creates a single-part target when trusted local code has not produced the
   * final bytes yet. The caller must verify the stored size and digest before
   * promoting the artifact out of PENDING.
   */
  createDeferredIntegrityUpload(
    objectKey: string,
    contentType: string,
  ): Promise<PresignedUpload>;
  completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: readonly CompletedPart[],
  ): Promise<void>;
  abortMultipartUpload(objectKey: string, uploadId: string): Promise<void>;
  head(objectKey: string): Promise<StoredObjectInfo | null>;
  createDownloadUrl(
    objectKey: string,
    filename: string,
  ): Promise<{ url: string; expiresAt: string }>;
  putObject(
    objectKey: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void>;
  getObject(objectKey: string): Promise<Uint8Array>;
  getObjectStream(objectKey: string): Promise<AsyncIterable<Uint8Array>>;
  deleteObject(objectKey: string): Promise<void>;
}

export function createObjectStorage(config: ServerConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });

  const bucket = config.storage.bucket;
  const ttlSeconds = config.storage.presignedUrlTtlSeconds;
  const expiryFrom = (): string =>
    new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return {
    async createUpload(objectKey, contentType, sizeBytes, sha256Hex) {
      const useMultipart = sizeBytes > config.storage.multipartThresholdBytes;

      if (!useMultipart) {
        const url = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            ContentType: contentType,
            ContentLength: sizeBytes,
            ChecksumSHA256: Buffer.from(sha256Hex, "hex").toString("base64"),
          }),
          { expiresIn: ttlSeconds },
        );

        return {
          strategy: "SINGLE",
          url,
          multipartUploadId: null,
          partUrls: [],
          partSizeBytes: sizeBytes,
          requiredHeaders: {
            "content-type": contentType,
            "content-length": String(sizeBytes),
            "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString(
              "base64",
            ),
          },
          expiresAt: expiryFrom(),
        };
      }

      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          ContentType: contentType,
        }),
      );

      if (created.UploadId === undefined) {
        throw new Error("Object storage did not return a multipart upload ID.");
      }

      const partSize = config.storage.multipartPartSizeBytes;
      const partCount = Math.ceil(sizeBytes / partSize);
      const partUrls: string[] = [];

      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const contentLength = Math.min(
          partSize,
          sizeBytes - (partNumber - 1) * partSize,
        );
        const url = await getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket: bucket,
            Key: objectKey,
            UploadId: created.UploadId,
            PartNumber: partNumber,
            ContentLength: contentLength,
          }),
          { expiresIn: ttlSeconds },
        );

        partUrls.push(url);
      }

      return {
        strategy: "MULTIPART",
        url: null,
        multipartUploadId: created.UploadId,
        partUrls,
        partSizeBytes: partSize,
        requiredHeaders: {},
        expiresAt: expiryFrom(),
      };
    },

    async createDeferredIntegrityUpload(objectKey, contentType) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ContentType: contentType,
        }),
        { expiresIn: ttlSeconds },
      );

      return {
        strategy: "SINGLE",
        url,
        multipartUploadId: null,
        partUrls: [],
        partSizeBytes: 0,
        requiredHeaders: { "content-type": contentType },
        expiresAt: expiryFrom(),
      };
    },

    async completeMultipartUpload(objectKey, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
    },

    async abortMultipartUpload(objectKey, uploadId) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
        }),
      );
    },

    async head(objectKey) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
        );

        return {
          sizeBytes: result.ContentLength ?? 0,
          etag: result.ETag ?? null,
        };
      } catch {
        return null;
      }
    },

    async createDownloadUrl(objectKey, filename) {
      // The filename is attacker-controlled, so it is quoted and stripped of
      // characters that could break out of the header value.
      const safeName = filename.replace(/["\\\r\n]/g, "_");
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
          // Downloads are never rendered inline by a browser or a preview pane.
          ResponseContentType: "application/octet-stream",
        }),
        { expiresIn: ttlSeconds },
      );

      return { url, expiresAt: expiryFrom() };
    },

    async putObject(objectKey, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async getObject(objectKey) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );

      if (result.Body === undefined) {
        throw new Error(`Object "${objectKey}" has no body.`);
      }

      return new Uint8Array(await result.Body.transformToByteArray());
    },

    async getObjectStream(objectKey) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      const body = result.Body as unknown;
      if (
        body === undefined ||
        typeof (body as { [Symbol.asyncIterator]?: unknown })[
          Symbol.asyncIterator
        ] !== "function"
      ) {
        throw new Error(`Object "${objectKey}" has no readable stream.`);
      }
      return body as AsyncIterable<Uint8Array>;
    },

    async deleteObject(objectKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
    },
  };
}

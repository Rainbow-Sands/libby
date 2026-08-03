import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { SessionArtifactKind } from "@rainbot/db";
import { pipeline } from "node:stream/promises";

export interface AudioStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  forcePathStyle: boolean;
}

export interface UploadedArtifactObject {
  bucket: string;
  objectKey: string;
  byteSize: number;
  contentType: string;
  formatVersion: number;
  sha256: string;
}

let audioStorage: AudioStorage | null = null;
let artifactStorage: AudioStorage | null = null;

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadStorageConfig(source: NodeJS.ProcessEnv, bucketVariable: string): AudioStorageConfig {
  const endpoint = source.S3_ENDPOINT?.trim();
  const accessKeyId = source.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = source.S3_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must either both be set or both be omitted",
    );
  }
  return {
    ...(endpoint ? { endpoint } : {}),
    region: required(source, "S3_REGION"),
    bucket: required(source, bucketVariable),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    forcePathStyle: source.S3_FORCE_PATH_STYLE === "true",
  };
}

export function loadAudioStorageConfig(source: NodeJS.ProcessEnv): AudioStorageConfig {
  return loadStorageConfig(source, "S3_BUCKET_AUDIO");
}

export function loadArtifactStorageConfig(source: NodeJS.ProcessEnv): AudioStorageConfig {
  return loadStorageConfig(source, "S3_BUCKET_ARTIFACT");
}

export function getAudioStorage(): AudioStorage {
  audioStorage ??= new AudioStorage(loadAudioStorageConfig(process.env));
  return audioStorage;
}

export function getArtifactStorage(): AudioStorage {
  artifactStorage ??= new AudioStorage(loadArtifactStorageConfig(process.env));
  return artifactStorage;
}

export function audioObjectKey(sessionId: string, segmentId: string, filename: string): string {
  const extension = path.extname(filename).toLowerCase() || ".ogg";
  return `sessions/${encodeURIComponent(sessionId)}/activations/${encodeURIComponent(segmentId)}${extension}`;
}

export function artifactObjectKey(
  campaignId: string,
  sessionId: string,
  runId: string,
  kind: SessionArtifactKind,
  contentHash: string,
): string {
  const directory = kind === "transcript" ? "transcript" : "detailed-record";
  const extension = kind === "transcript" ? "json" : "md";
  return [
    "campaigns",
    encodeURIComponent(campaignId),
    "sessions",
    encodeURIComponent(sessionId),
    "runs",
    encodeURIComponent(runId),
    directory,
    `${contentHash}.${extension}`,
  ].join("/");
}

export function artifactContentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export class AudioStorage {
  readonly #bucket: string;
  readonly #client: S3Client;

  constructor(config: AudioStorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.credentials,
    });
  }

  get bucket(): string {
    return this.#bucket;
  }

  async uploadFile(objectKey: string, filePath: string, contentType: string): Promise<void> {
    const file = await stat(filePath);
    const upload = new Upload({
      client: this.#client,
      params: {
        Bucket: this.#bucket,
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentLength: file.size,
        ContentType: contentType,
      },
    });
    await upload.done();
  }

  async downloadFile(objectKey: string, destination: string): Promise<void> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error(`Audio object has no body: ${objectKey}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination));
  }

  async uploadArtifact(
    objectKey: string,
    body: string,
    contentType: string,
    formatVersion = 1,
  ): Promise<UploadedArtifactObject> {
    const bytes = Buffer.from(body, "utf8");
    const upload = new Upload({
      client: this.#client,
      params: {
        Bucket: this.#bucket,
        Key: objectKey,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: contentType,
      },
    });
    await upload.done();
    return {
      bucket: this.#bucket,
      objectKey,
      byteSize: bytes.byteLength,
      contentType,
      formatVersion,
      sha256: artifactContentHash(body),
    };
  }

  async downloadText(objectKey: string, bucket = this.#bucket): Promise<string> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error(`Artifact object has no body: ${objectKey}`);
    return response.Body.transformToString("utf-8");
  }

  async delete(objectKey: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: objectKey }));
  }
}

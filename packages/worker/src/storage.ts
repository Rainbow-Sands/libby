import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
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

export interface UploadedAudioObject {
  objectKey: string;
  byteSize: number;
}

let storage: AudioStorage | null = null;

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadAudioStorageConfig(source: NodeJS.ProcessEnv): AudioStorageConfig {
  const endpoint = source.AUDIO_S3_ENDPOINT?.trim();
  const accessKeyId = source.AUDIO_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = source.AUDIO_S3_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "AUDIO_S3_ACCESS_KEY_ID and AUDIO_S3_SECRET_ACCESS_KEY must either both be set or both be omitted",
    );
  }
  return {
    ...(endpoint ? { endpoint } : {}),
    region: required(source, "AUDIO_S3_REGION"),
    bucket: required(source, "AUDIO_S3_BUCKET"),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    forcePathStyle: source.AUDIO_S3_FORCE_PATH_STYLE === "true",
  };
}

export function getAudioStorage(): AudioStorage {
  storage ??= new AudioStorage(loadAudioStorageConfig(process.env));
  return storage;
}

export function audioObjectKey(sessionId: string, segmentId: string, filename: string): string {
  const extension = path.extname(filename).toLowerCase() || ".ogg";
  return `sessions/${encodeURIComponent(sessionId)}/activations/${encodeURIComponent(segmentId)}${extension}`;
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

  async uploadFile(
    objectKey: string,
    filePath: string,
    contentType: string,
  ): Promise<UploadedAudioObject> {
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
    return { objectKey, byteSize: file.size };
  }

  async downloadFile(objectKey: string, destination: string): Promise<void> {
    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error(`Audio object has no body: ${objectKey}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destination));
  }

  async delete(objectKey: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: objectKey }));
  }
}

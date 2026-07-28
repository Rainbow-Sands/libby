import { describe, expect, it } from "vitest";
import { audioObjectKey, loadAudioStorageConfig } from "./storage.ts";

describe("audio object storage", () => {
  it("builds opaque, session-scoped activation keys", () => {
    expect(audioObjectKey("session/one", "segment two", "clips/input.OGG")).toBe(
      "sessions/session%2Fone/activations/segment%20two.ogg",
    );
  });

  it("loads an AWS-compatible configuration without a custom endpoint", () => {
    expect(
      loadAudioStorageConfig({
        AUDIO_S3_REGION: "ca-central-1",
        AUDIO_S3_BUCKET: "private-audio",
        AUDIO_S3_ACCESS_KEY_ID: "access",
        AUDIO_S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toEqual({
      region: "ca-central-1",
      bucket: "private-audio",
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      forcePathStyle: false,
    });
  });

  it("uses the AWS credential provider chain when static credentials are omitted", () => {
    expect(
      loadAudioStorageConfig({
        AUDIO_S3_REGION: "ca-central-1",
        AUDIO_S3_BUCKET: "private-audio",
      }),
    ).toEqual({
      region: "ca-central-1",
      bucket: "private-audio",
      forcePathStyle: false,
    });
  });

  it("rejects incomplete static credentials", () => {
    expect(() =>
      loadAudioStorageConfig({
        AUDIO_S3_REGION: "ca-central-1",
        AUDIO_S3_BUCKET: "private-audio",
        AUDIO_S3_ACCESS_KEY_ID: "access",
      }),
    ).toThrow(/must either both be set or both be omitted/);
  });

  it("supports path-style S3-compatible endpoints", () => {
    expect(
      loadAudioStorageConfig({
        AUDIO_S3_ENDPOINT: "http://localhost:9000",
        AUDIO_S3_REGION: "us-east-1",
        AUDIO_S3_BUCKET: "audio",
        AUDIO_S3_ACCESS_KEY_ID: "minio",
        AUDIO_S3_SECRET_ACCESS_KEY: "password",
        AUDIO_S3_FORCE_PATH_STYLE: "true",
      }),
    ).toMatchObject({
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
  });
});

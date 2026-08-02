import { describe, expect, it } from "vitest";
import {
  artifactContentHash,
  artifactObjectKey,
  audioObjectKey,
  loadArtifactStorageConfig,
  loadAudioStorageConfig,
} from "./storage.ts";

describe("audio object storage", () => {
  it("builds opaque, session-scoped activation keys", () => {
    expect(audioObjectKey("session/one", "segment two", "clips/input.OGG")).toBe(
      "sessions/session%2Fone/activations/segment%20two.ogg",
    );
  });

  it("builds immutable, run-scoped artifact keys", () => {
    expect(artifactObjectKey("campaign/one", "session two", "run three", "transcript", "abc")).toBe(
      "campaigns/campaign%2Fone/sessions/session%20two/runs/run%20three/transcript/abc.json",
    );
    expect(artifactObjectKey("campaign", "session", "run", "detailed_record", "abc")).toMatch(
      /\/detailed-record\/abc\.md$/,
    );
  });

  it("uses stable content hashes for immutable artifact versions", () => {
    expect(artifactContentHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("loads an AWS-compatible configuration without a custom endpoint", () => {
    expect(
      loadAudioStorageConfig({
        S3_REGION: "ca-central-1",
        S3_BUCKET_AUDIO: "private-audio",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
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
        S3_REGION: "ca-central-1",
        S3_BUCKET_AUDIO: "private-audio",
      }),
    ).toEqual({
      region: "ca-central-1",
      bucket: "private-audio",
      forcePathStyle: false,
    });
  });

  it("uses a separate bucket for durable session artifacts", () => {
    expect(
      loadArtifactStorageConfig({
        S3_REGION: "ca-central-1",
        S3_BUCKET_ARTIFACT: "session-artifacts",
      }),
    ).toMatchObject({
      region: "ca-central-1",
      bucket: "session-artifacts",
    });
  });

  it("rejects incomplete static credentials", () => {
    expect(() =>
      loadAudioStorageConfig({
        S3_REGION: "ca-central-1",
        S3_BUCKET_AUDIO: "private-audio",
        S3_ACCESS_KEY_ID: "access",
      }),
    ).toThrow(/must either both be set or both be omitted/);
  });

  it("supports path-style S3-compatible endpoints", () => {
    expect(
      loadAudioStorageConfig({
        S3_ENDPOINT: "http://localhost:9000",
        S3_REGION: "us-east-1",
        S3_BUCKET_AUDIO: "audio",
        S3_ACCESS_KEY_ID: "minio",
        S3_SECRET_ACCESS_KEY: "password",
        S3_FORCE_PATH_STYLE: "true",
      }),
    ).toMatchObject({
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
  });
});

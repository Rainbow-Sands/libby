export const SESSION_ARTIFACT_KINDS = ["transcript", "detailed_record"] as const;

export type SessionArtifactKind = (typeof SESSION_ARTIFACT_KINDS)[number];

export interface SessionArtifactRef {
  id: string;
  kind: SessionArtifactKind;
  bucket: string;
  objectKey: string;
  contentType: string;
  formatVersion: number;
  byteSize: number;
  sha256: string;
}

export interface SessionArtifactWrite {
  bucket: string;
  objectKey: string;
  contentType: string;
  formatVersion: number;
  byteSize: number;
  sha256: string;
}

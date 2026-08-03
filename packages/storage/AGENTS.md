# @rainbot/storage — AGENTS.md

Shared S3-compatible object storage and durable artifact loading. See the root
`AGENTS.md` for workspace-wide conventions.

- `object-storage.ts` owns the generic S3 client, configuration, and object-key
  helpers.
- `artifacts.ts` owns checksum verification and typed transcript/detailed-record
  loading.
- Keep storage independent of worker and web internals. Artifact types and
  transcript validation come from `@rainbot/db`.

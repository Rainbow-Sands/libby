# @rainbot/knowledge — AGENTS.md

Provider-neutral campaign knowledge retrieval and indexing triggers. See the
root `AGENTS.md` for workspace-wide conventions.

- Keep canonical documents in S3; this package only owns stable RAG object-key
  conventions and managed knowledge-provider HTTP calls.
- `RAG_PROVIDER` is optional. `digitalocean` requires an API key and Knowledge
  Base ID; `none` keeps local development and deployments without RAG working.
- Retrieval must always be scoped to a campaign object-key prefix after the web
  layer has authorized campaign access.

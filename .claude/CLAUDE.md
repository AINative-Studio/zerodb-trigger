# zerodb-trigger

Drop-in Trigger.dev replacement backed by ZeroDB event hooks.

## Rules

- This package has ZERO runtime dependencies (uses native fetch)
- ES module (index.js) and CommonJS (index.cjs) entry points
- API mirrors Trigger.dev's defineJob() pattern
- Supported triggers: zerodb.vector.stored, zerodb.memory.stored, zerodb.file.uploaded, zerodb.table.row_inserted, zerodb.event.published, custom.*
- Auto-provisioning uses POST /api/v1/public/instant-db
- ZeroDB hooks API: POST/GET/DELETE /v1/zerodb/{project_id}/database/hooks
- ZeroDB events API: POST/GET /v1/zerodb/{project_id}/database/events
- Never store credentials in code or tests
- Tests use mocked fetch — no real API calls in CI

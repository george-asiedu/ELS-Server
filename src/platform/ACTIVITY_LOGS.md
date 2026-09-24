# Platform API activity logs

Operational API request telemetry is stored separately from `AuditLog`.

- `AuditLog` records selected business and super-admin actions with domain context.
- `PlatformActivityLog` records completed API requests across all studios, including reads, writes, failed responses, and actor/studio context where available.
- Records are append-only through the application and are visible in the super-admin console at **Platform → API logs**. The endpoint is `GET /api/platform/activity-logs` and is behind the existing `authenticate` and `requireSuperAdmin` guards.
- The feed uses cursor pagination (`limit`, `cursor`; maximum limit 100) and supports `studioId`, `method`, and response class filters (`statusCode=200`, `300`, `400`, or `500`).
- Every request receives an `X-Request-Id` response header. Logs retain that ID, route template, method, HTTP status, elapsed milliseconds, studio ID, actor ID/role, a bounded user-agent string, and creation time.
- Query strings, request/response bodies, authorization/cookie headers, email addresses, and client IPs are not stored. `OPTIONS` preflight requests are skipped. Telemetry writes are best-effort and do not delay or fail the API response.

## Deploying the schema

After deploying this change, apply the new collection/indexes using the repository's normal Prisma MongoDB schema workflow (`yarn prisma db push`, or `yarn push`). No external logging provider or additional service credentials are required.

## Operations and retention

The feed is paginated to avoid returning long histories to the UI. Records currently have no automatic expiry; apply a retention/archival policy appropriate to the platform's operational and privacy requirements before sustained high-volume use. Database storage and write volume scale with API request volume because all non-preflight API calls are recorded.

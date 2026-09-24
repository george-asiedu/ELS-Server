# Security review and remediation report

Reviewed the Express API and React client for authentication/session handling,
authorization, CORS, request limits, uploads, payment routes, and browser token
storage.

## Findings

### SEC-01 — High — Stateless tokens did not support device revocation

**Location:** `src/utils/helper.ts`, `src/auth/sessionService.ts`,
`src/middleware/auth.ts`, and `prisma/schema.prisma` (`AuthSession`).

**Evidence:** `src/utils/helper.ts` previously minted JWT access tokens without
a server-side session record, so logout or a device cap could not revoke them.

**Remediation:** Login and signup now persist session IDs, access tokens carry
that ID as `jti`, and authenticated requests check the active session. The
fourth concurrent login removes the oldest session. Logout and password changes
revoke sessions. The database schema now includes `AuthSession`.

**Deployment:** Apply the schema before deploying. Existing JWTs lack `jti` and
will be rejected after release, so users need to sign in again.
**False-positive note:** The cap represents login sessions because the browser
does not provide a reliable physical-device identity.

### SEC-02 — High — Profile write and account management routes lacked guards

**Location:** `src/profile/routes.ts` and `src/profile/profileController.ts`.

**Evidence:** Several routes under `src/profile/routes.ts` accepted profile,
email, password, or delete operations without authentication/role checks.

**Remediation:** Mutations require authentication; direct account deletion and
administrative email/password changes require an admin. Profile reads/updates
by ID require the owner or an admin.
**Impact:** An unauthenticated caller could change account data or credentials
and delete users. Public profile exposure is therefore limited to authenticated
owners and admins.

### SEC-03 — Medium — Authentication and payment flows had only a broad IP limit

**Location:** `src/app.ts` and `src/middleware/rateLimitStore.ts`.

**Evidence:** `src/app.ts` previously applied one permissive 200-request limit
to the entire API.

**Remediation:** Added distinct limits for sign-in by IP and normalized account,
plus signup/recovery throttles and tighter per-minute limits for payments,
orders, onboarding, and billing.
When `REDIS_URL` is present, counters use atomic Redis increments and work
across instances. Without Redis, counters are process-local.
**Mitigation:** Configure `REDIS_URL` for multi-instance production; in-memory
counters are suitable only for local or single-process deployment.

### SEC-04 — Medium — CORS and API hardening could be narrowed

**Location:** `src/app.ts`, `src/config/env.config.ts`, and
`src/middleware/globalErrorHandler.ts`.

**Evidence:** CORS allowed localhost origins in production and accepted any
scheme for root-domain subdomains. The health response exposed the environment;
request parsers accepted large bodies.

**Remediation:** Production origins must be HTTPS, localhost is development-
only, allowed methods/headers are explicit, body limits are smaller, and health
no longer returns environment details. Helmet applies a restrictive API CSP,
referrer policy, and default security headers; Express fingerprinting is off.
**False-positive note:** The API uses Authorization bearer tokens, not
authentication cookies, so classic cookie-based CSRF defenses do not apply.

### SEC-05 — Medium — Some image upload routes were unbounded

**Location:** `src/profile/routes.ts`, `src/appointment/routes.ts`,
`src/bucket/imageProcessor.ts`, and `src/bucket/s3BucketService.ts`.

**Evidence:** Profile and appointment uploads used Multer memory storage without
file-size limits.

**Remediation:** Both now cap image size, file count, and multipart fields.
Other existing upload routes already had explicit size limits. SVG and invalid
image bytes are rejected, and uploaded objects now use generated S3 names.
**Impact:** The new limits bound memory use and block active SVG/malformed image
content before it is stored.

### SEC-06 — Medium — Browser bearer tokens are stored in localStorage

**Evidence:** `src/lib/apiClient.ts` and `src/lib/platformApi.ts` store tokens in
browser localStorage. A successful same-origin script injection could read
those tokens.

**Status:** Not migrated in this change. The API continues to use explicit
Authorization bearer headers, so cookie-based CSRF controls are not applicable.
The API CSP does not protect the separately hosted SPA; configure a restrictive
CSP at the frontend host and consider moving to HttpOnly-cookie sessions with
an explicit CSRF/origin design as a separately coordinated auth migration.

### SEC-07 — Medium — Proxy and deployment controls are not represented here

**Evidence:** No trusted proxy topology, frontend hosting headers, WAF, TLS
termination, or production Redis configuration is defined in these app repos.

**Remediation:** Added `TRUST_PROXY_HOPS` (default 0) so production can trust
only the configured proxy chain. Enforce HTTPS and frontend CSP at the edge,
and set `REDIS_URL` for multi-instance rate-limit enforcement. See `SECURITY.md`.

## Verification

Attempted `npm run build`; Node could not start under the workspace filesystem
permissions (`EPERM` while resolving `C:\Users\gasie`). Prisma schema/client
generation and TypeScript compilation therefore could not be completed here.
No live database migration or payment integration was run.

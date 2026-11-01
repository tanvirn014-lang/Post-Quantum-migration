# Supabase add-on identity + dual-step OTP sign-up — design

**Date:** 2026-11-01
**Status:** approved in chat (add-on identity layer, hosted Supabase project, password + email OTP at sign-up)

## Goal

Let a customer self-register through a two-step, OTP-confirmed sign-up backed by a hosted
Supabase project, and have the existing banking core (`ledger-service`) accept that Supabase
identity — **without** replacing the core's own authentication, RBAC, hash-chained audit, or the
seeded staff/demo accounts the research demo and e2e depend on.

## Decisions (from the user)

1. **Supabase = add-on identity layer.** Supabase owns sign-up, login, sessions and the email OTP.
   It does *not* own banking data, roles, or the audit chain. `ledger-service` remains the
   authorization + audit authority.
2. **Hosted Supabase project.** Project ref `kmhjptvwxgligslhwvxa`. User access tokens are signed
   with **asymmetric ECC keys (ES256)** and verified against the project's public JWKS — no shared
   secret, no service-role key on our backend.
3. **Dual-step OTP at sign-up.** Step 1: email + password (+ full name) → Supabase emails a 6-digit
   code. Step 2: user enters the code → `verifyOtp({ type: 'signup' })` confirms and returns a
   session.

## Non-goals

- Not replacing the local EdDSA/JWKS auth, scrypt passwords, refresh rotation, RBAC, or audit.
- Not moving any database to Supabase (banking data stays in the core's Postgres).
- Not routing staff (operator / security_admin / auditor) or the e2e harness through Supabase.
- No PQ change: Supabase tokens are classical (ES256), like the core's EdDSA tokens. The claim
  ledger's boundary language is unchanged.

## Architecture

```
Browser (moneypurse-web)
  ├─ /signup  → Supabase JS: signUp → (email OTP) → verifyOtp  → Supabase session (ES256 JWT)
  ├─ /login   → local POST /auth/login first; on invalid, Supabase signInWithPassword
  └─ attaches the active access token (local EdDSA *or* Supabase ES256) to ledger-service calls

ledger-service
  └─ authenticate(token): try local EdDSA verify; if that fails and Supabase is configured,
     verify the token against Supabase's JWKS, then resolve/provision a LOCAL customer user.
     Role, ownership, lockout and audit stay local and authoritative.

security-service: unchanged. Only staff reach it, and staff keep local tokens.
```

### Backend (`ledger-service`)

- **New port** `SupabaseVerifier.verify(token) → { supabaseUserId, email, fullName }`.
- **New adapter** `JoseSupabaseVerifier` using `jose.createRemoteJWKSet(jwksUrl)` +
  `jwtVerify(token, jwks, { issuer })`. The JWKS resolver is injectable so tests verify
  locally-minted ES256 tokens against a `createLocalJWKSet` with no network.
- **Config** (all optional; unset = Supabase path disabled, preserving current behavior and tests):
  `SUPABASE_URL` → derives `issuer = <url>/auth/v1` and `jwksUrl = <url>/auth/v1/.well-known/jwks.json`.
- **`User`** gains `supabaseUserId: string | null`. Migration `0003_supabase_identity.sql` adds a
  nullable, unique `supabase_user_id` column.
- **Store** gains `findUserBySupabaseId(id)` and `provisionExternalCustomer({ supabaseUserId, email,
  fullName, passwordHash })` (atomic customer + user, role `customer`, `mustChangePassword=false`).
- **`IdentityService.authenticate`**: local verify first; on failure, Supabase verify →
  `resolveSupabaseUser`:
  1. by `supabaseUserId` → return;
  2. else by email: link **only if** the existing user's role is `customer` (staff emails are
     rejected — staff use local login); set `supabase_user_id`;
  3. else provision a new customer. First provision is audited (`auth.external_provision`).
  Supabase-provisioned users get a random, unusable local `passwordHash` (local login can never
  succeed for them; they authenticate only via Supabase).

### Frontend (`moneypurse-web`, Next 16 / React 19)

- Add `@supabase/supabase-js`. `lib/auth/supabase-client.ts` builds a browser client from
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`; returns `null` if unset so the app
  still builds and runs without Supabase.
- **`lib/auth/signup-flow.ts`** — a pure, framework-agnostic state machine driving
  `collecting → sending-code → awaiting-code → verifying → done | error`, over an injected
  `SignupGateway` (`requestSignup`, `verifyOtp`, `resendCode`). This is the TDD centerpiece;
  validation (email/password/code shape) and error mapping live here.
- **`SessionManager`** gains `adoptExternalSession(accessToken, refreshStrategy)` and an injectable
  refresh strategy (default = current `POST /auth/refresh`). Supabase sign-up-verify and login
  both funnel through `adoptExternalSession`, with a strategy backed by the Supabase client's
  token refresh. Existing local `login`/`restore`/`refresh` behavior is unchanged.
- **Routing** (`lib/auth/routing.ts`): `/signup` is a public area; anonymous users may stay on it,
  signed-in users are bounced to their landing.
- UI: `app/signup/page.tsx` + `components/auth/SignupForm.tsx` (two-step form, component-tested
  with a fake gateway); a link from the login page to sign up.

## Testing & honesty boundary

- Offline (CI): the Supabase JWT verifier (locally-minted ES256 + local JWKS), user provisioning
  and linking, the sign-up state machine, the session `adoptExternalSession`/refresh strategy, and
  the sign-up form — all with fakes/mocks, no network.
- **Not automated:** the real hosted round-trip (an actual OTP email delivered to an inbox). This
  depends on an external service and a human inbox, so it is a manual/demo step. It will be
  labelled as such in `docs/CLAIM_LEDGER.md` (a new row, label IMPLEMENTED for our code paths,
  with the explicit limit that end-to-end delivery is verified manually, not in CI).

## Limitations to record

- Post-quantum scope is unchanged: Supabase tokens are classical ES256.
- Supabase is now an external hosted dependency; the "single-host" reproducibility claim applies to
  the core stack, not to Supabase email delivery. Documented in the runbook.
- Email OTP delivery uses Supabase's built-in email (rate-limited), adequate for a demo, not a
  production mailer.

# Authentication

Local API: `http://127.0.0.1:3001`. All routes are under `/api/v1`.

Sign-in is passwordless. The client requests a 6-digit code, then verifies it. An existing email receives a session. A new email receives a short-lived registration token and stays signed out until `complete-registration` creates the account.

## Development OTP

When `NODE_ENV` is exactly `development`, the code is always `123456` and no email is sent. Production and test generate a random code and never fall back to `123456`. The comparison stays on the server. The code is stored as an HMAC-SHA256 of `email:code`, keyed with `JWT_SECRET`, not as plaintext.

`OtpDeliveryService.send` is the only place a mail provider should be added. It currently does not send mail and does not log the code. Until a provider is connected, production can create challenges but nobody receives the code.

Codes expire after 10 minutes, allow 5 attempts, and a resend waits `OTP_RESEND_SECONDS` (default 60). Requesting a new code consumes older unused challenges. `request-otp` always returns `{ "status": "code_sent" }` for a valid email.

Refresh tokens are 32 random bytes stored as SHA-256 hashes. Access tokens are JWTs (`HS256`) with `token_use: "access"`, `sub` (user id), and `sid` (session id). Registration tokens use `token_use: "registration"` and are not accepted as access tokens. Issuer and audience are checked. A revoked or replaced session makes its access token invalid.

`JWT_SECRET` is required and must be at least 32 characters. There is no production fallback.

## Clients

Web requests omit `X-Token-Delivery`. The API sets HttpOnly cookies when a session is issued. The JSON body for an existing user is `{ "status": "authenticated", "user": { "id", "email", "name" } }`. Cookie mutations also require `X-Personal-AI: 1`. CORS allows only `WEB_ORIGIN` and credentials.

- `pai_access` — access token, path `/`, `SameSite=Lax`, `Secure` in production
- `pai_refresh` — refresh token, path `/api/v1/auth`, same flags

A new email does not receive cookies. The body is:

```json
{
  "status": "registration_required",
  "email": "person@example.com",
  "registrationToken": "jwt"
}
```

Mobile sends `X-Token-Delivery: bearer`. The API does not set cookies. Verifying an existing user, completing registration, and refresh return:

```json
{
  "user": { "id": "uuid", "email": "person@example.com", "name": "Ada Lovelace" },
  "accessToken": "jwt",
  "refreshToken": "opaque",
  "accessTokenExpiresIn": 900,
  "refreshTokenExpiresIn": 2592000
}
```

Verify adds `"status": "authenticated"` around that object. Send the access token as `Authorization: Bearer`. Keep it in memory. Store only the refresh token in the platform keychain or keystore.

## Routes

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/request-otp` | No | 200 `{ "status": "code_sent" }` |
| POST | `/api/v1/auth/verify-otp` | No | 200 session, or registration token and no session |
| POST | `/api/v1/auth/complete-registration` | Registration token | 201 and a session |
| POST | `/api/v1/auth/refresh` | Refresh cookie or `{ "refreshToken" }` | 200 and a rotated session |
| POST | `/api/v1/auth/logout` | Refresh cookie or `{ "refreshToken" }` | 204, session revoked, cookies cleared |
| GET | `/api/v1/auth/me` | Access cookie or Bearer access token | 200 `{ "id", "email", "name" }` |

Request body:

```json
{ "email": "person@example.com" }
```

Verify body:

```json
{ "email": "person@example.com", "code": "123456" }
```

Registration body:

```json
{ "registrationToken": "jwt", "name": "Ada Lovelace" }
```

Email is trimmed and lowercased. The code must be 6 digits. The name is 1–80 characters.

Failures use Nest's `{ "statusCode", "message", "error" }` shape. A wrong, expired, or reused code returns 401 `That code is incorrect or has expired.` Completing registration twice returns 409. Each IP and email can call these routes 10 times per 15 minutes (429). A resend inside the cooldown is also 429. If Redis is unavailable, those routes return 503.

Refreshing a revoked token revokes that user's remaining sessions. Responses never include `codeHash` or `tokenHash`.

## Environment

```
NODE_ENV=development
JWT_SECRET=
JWT_ISSUER=personal-ai-api
JWT_AUDIENCE=personal-ai
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
OTP_RESEND_SECONDS=60
WEB_ORIGIN=http://127.0.0.1:3000
```

`OTP_RESEND_SECONDS` defaults to 60. Set it only to change the resend wait. Do not add a switch that enables `123456` outside development.

The web app and API must stay on the same site so `SameSite=Lax` cookies are sent. `http://localhost:3000` and `http://127.0.0.1:3001` are different sites. Use `http://127.0.0.1:3001` from a page on `http://127.0.0.1:3000`, or `localhost` for both.

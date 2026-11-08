# Logging Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document defines the Pino structured logging conventions, derived from `CONVENTIONS.md` §8 and established by Prompt 004. It covers the logging format, levels, redaction, and correlation requirements.

---

## 1. Log Format

- Pino structured JSON, one line per event.
- Required fields per line: `time`, `level`, `msg`, `requestId`, `module`, and either `event` or `action`.
- Useful optional fields: `userId` (opaque ID only), `route`, `method`, `status`, `durationMs`, `outcome`, `entityId`, `errorCode`.

### 1.1 Example Log Line

```json
{
  "time": "2026-11-08T12:34:56.789Z",
  "level": "info",
  "msg": "request completed",
  "requestId": "01JGZZZ3G9",
  "module": "content",
  "action": "list",
  "durationMs": 45,
  "outcome": "success"
}
```

---

## 2. Log Levels

| Level   | Use                                                                              |
| ------- | -------------------------------------------------------------------------------- |
| `fatal` | Process cannot continue                                                          |
| `error` | Unexpected failure requiring attention                                           |
| `warn`  | Expected but noteworthy failure (rate limit, validation spike, delivery failure) |
| `info`  | Request completion, state changes, maintenance results                           |
| `debug` | Development diagnostics                                                          |
| `trace` | Rare deep diagnostics; not enabled in production by default                      |

- Production default: `info`. Development default: `debug`. Override with `LOG_LEVEL`.
- Log one request-completion line per request, not one per database query.
- Do not log per playback second. Playback analytics are bounded database writes, not log spam.

---

## 3. Redaction

Pino redaction must cover these fields (and their variants):

- `req.headers.authorization`
- `req.headers.cookie`
- `password`
- `token`
- `secret`
- `apiKey`
- `clientSecret`
- `set-cookie`

Never log request bodies by default. Validation logs record field names, not sensitive values.

---

## 4. Correlation

- `requestId` is generated at the edge/middleware, returned as `X-Request-Id` in the response header, and passed explicitly to services.
- Services accept a logging context; they do not create ad-hoc loggers.
- Logs are suitable for journald. No external log service is introduced.

---

## 5. Error Monitoring Records

- Written by `app`-level error boundaries to `maintenance.recordError`.
- Store safe metadata only, with a bounded default retention (30 days) and redaction.
- Capture actor, action, target, result, and time without capturing secrets.

---

## 6. What Must Not Be Logged

- Request bodies by default.
- Full media or subtitle URLs with query strings.
- OAuth tokens, session secrets, or credentials.
- Passwords, authorization headers, API keys, or client secrets.
- Any data that identifies individuals or compromises security.

---

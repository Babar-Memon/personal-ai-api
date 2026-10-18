# Tasks, reminders, and the assistant

All routes are under `/api/v1` and require the same session as `GET /api/v1/auth/me`. The user id comes from that session. A missing or foreign id returns 404.

Times are stored as UTC. Send ISO-8601 values that include `Z` or an offset, such as `2026-10-17T09:00:00.000Z`. The account timezone defaults to `UTC`. Relative phrases such as “tomorrow” are resolved in that timezone by the assistant. There is no settings screen yet; the `User.timezone` column is the place to change it.

Reminders are records in the app. Nothing sends a push or an email when a reminder is due. Recurrence is not implemented.

## Tasks

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/tasks` | `status` `open\|done`, `priority` `low\|normal\|high`, `view` `today\|overdue\|upcoming\|nodue\|all`, `sort` `dueAt\|priority\|createdAt`, `order` `asc\|desc`, `limit` up to 100, `offset` |
| POST | `/api/v1/tasks` | `{ "title", "description?", "dueAt?", "priority?", "status?" }` |
| GET | `/api/v1/tasks/:id` | |
| PATCH | `/api/v1/tasks/:id` | Any of those fields. `status: "done"` completes. `status: "open"` reopens. |
| DELETE | `/api/v1/tasks/:id` | 204 |

## Reminders

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/reminders` | `status` `scheduled\|done\|dismissed`, `view` `upcoming\|past\|today\|all`, `order`, `limit`, `offset` |
| POST | `/api/v1/reminders` | `{ "title", "description?", "remindAt" }` |
| PATCH | `/api/v1/reminders/:id` | Title, description, `remindAt`, or status |
| DELETE | `/api/v1/reminders/:id` | 204 |

## Assistant

`GROQ_API_KEY` and `GROQ_MODEL` stay on the API. The default model is `openai/gpt-oss-120b`, a current Groq production model that supports tool calls. `llama-3.3-70b-versatile` was retired for self-serve accounts on 16 August 2026. Chat returns 503 when the key is missing or the model is not listed by Groq. Responses are not invented locally.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/v1/assistant/conversation` | Latest messages for this user |
| POST | `/api/v1/assistant/chat` | `{ "message", "conversationId?" }` |

The chat response is `{ "conversationId", "reply", "actions": [{ "name", "ok", "summary" }] }`. `actions` records what the server actually did. A delete is refused until `confirmed` is true.

Allowed tools: `create_task`, `list_tasks`, `complete_task`, `update_task`, `delete_task`, `create_reminder`, `list_reminders`, `update_reminder`, `delete_reminder`.

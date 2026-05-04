# Google MCP Server — Architecture & Reference

**Дата актуалізації:** 2026-05-04
**Поточна версія:** master HEAD (26 commits since init)
**Production URL:** https://google-mcp-server-sigma.vercel.app/api/mcp

Custom MCP server який ходить у Google Workspace від імені користувача (Gmail, Drive, Docs, Sheets, Calendar, Contacts) з підтримкою двох акаунтів (`personal` / `business`). Реалізовано як Vercel serverless functions (TypeScript). Stateless — кожен виклик незалежний.

---

## Tools (27 total)

### Gmail (8)
- `get_profile`, `search_emails`, `read_email`, `list_threads`
- `send_email`, `delete_email`, `archive_email`, `label_email`

### Drive (6)
- `search_files`, `read_file`, `list_folder`, `create_folder`, `share_file`, `delete_file`

### Docs (3)
- `create_doc`, `update_doc`, `replace_in_doc`

### Sheets (3)
- `create_spreadsheet`, `read_spreadsheet`, `write_spreadsheet`

### Calendar (5)
- `list_events`, `create_event`, `update_event`, `delete_event`, `get_event`

### Contacts (1)
- `get_contacts`

### Auth (1)
- `get_auth_url` — OAuth flow для додавання нового акаунта

---

## Multi-account support (з 2026-05-02)

Кожен tool приймає optional `account: "personal" | "business"` параметр.

- `account="personal"` → токен `GOOGLE_REFRESH_TOKEN_PERSONAL` (`a.semelinsky@gmail.com`)
- `account="business"` → токен `GOOGLE_REFRESH_TOKEN_BUSINESS` (`o.semelinksy@j127group.com`)
- omitted → fallback `GOOGLE_REFRESH_TOKEN` (legacy = business)

**Важливо:** з 2026-05-04 `account` додається у схему **кожного** tool на module-init time (`api/mcp.ts:359`). Це defensive fix для MCP-клієнтів, що кешують схеми з tools/list і не оновлюють динамічний merge у відповіді.

```typescript
// Module-init injection (api/mcp.ts:359)
for (const t of TOOLS) {
  if (!('account' in t.inputSchema.properties)) {
    Object.assign(t.inputSchema.properties, ACCOUNT_PROP);
  }
}
```

---

## Calendar — feature parity з stock Google Calendar MCP (з 2026-05-04)

`create_event` і `update_event` тепер мають той самий набір полів що й вбудований MCP Anthropic-у:

| Поле | Тип | Опис |
|---|---|---|
| `summary` | string | Title (required) |
| `start`, `end` | string | ISO 8601 datetime або YYYY-MM-DD якщо `allDay` |
| `description` | string | HTML allowed |
| `attendees` | string[] | email addresses |
| `location` | string | Geographic free-form text |
| `calendarId` | string | Default: `primary` |
| `timeZone` | string | IANA TZ name (e.g. `Europe/Kyiv`) |
| `overrideReminders` | array | `[{method: "email"\|"popup", minutes: int}]` |
| `addGoogleMeetUrl` | boolean | Auto-create Meet link |
| `allDay` | boolean | start/end як YYYY-MM-DD |
| `colorId` | string | "1"-"11" (palette) |
| `recurrenceData` | string[] | RRULE/RDATE/EXDATE per RFC 5545 |
| `visibility` | string | `default` \| `public` \| `private` |
| `notificationLevel` | string | `NONE` \| `EXTERNAL_ONLY` \| `ALL` (→ sendUpdates) |
| `account` | string | personal/business |

Runtime коректно мапить:
- `overrideReminders` → `reminders.{useDefault: false, overrides: [...]}`
- `addGoogleMeetUrl` → `conferenceData` + `conferenceDataVersion: 1` query param
- `recurrenceData` → `recurrence: [...]`
- `notificationLevel` → `sendUpdates: 'all'|'externalOnly'|'none'`
- `allDay` + `timeZone` → `{date}` vs `{dateTime, timeZone}` shape

`update_event` додатково має `eventId` (required). Усі інші поля optional — non-provided беруться з existing event (read-modify-write).

---

## Pagination (з 2026-05-04)

`list_folder` — раніше `pageSize: 50` без loop'у. Тепер:

```typescript
do {
  const res = await drive.files.list({
    q: `'${parent}' in parents and trashed=false`,
    fields: 'nextPageToken, files(id,name,mimeType)',
    pageSize: 1000,
    pageToken,
  });
  all.push(...(res.data.files ?? []));
  pageToken = res.data.nextPageToken ?? undefined;
} while (pageToken);
```

Повертає header `Total: N item(s)` + список усіх файлів.

`search_files` залишається з user-controlled `maxResults` (default 10) — search має іншу логіку (top-N матчів).

---

## Safety timeouts (з 2026-05-04) — ⚠️ запобігання client hangs

Дві layer-и захисту так щоб client отримував response завжди у обмежений час, замість infinite wait при stalls Google API.

### Layer 1: per-tool timeout

`api/mcp.ts:813` — `Promise.race([callTool, timeout(25s)])`:

```typescript
const TOOL_TIMEOUT_MS = parseInt(process.env.MCP_TOOL_TIMEOUT_MS ?? '25000', 10);

const text = await Promise.race([
  callTool(toolName, toolArgs),
  new Promise<string>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Tool '${toolName}' exceeded ${TOOL_TIMEOUT_MS}ms timeout — call aborted to avoid client hang.`)),
      TOOL_TIMEOUT_MS
    )
  ),
]);
```

При перевищенні — JSON-RPC error `-32000` з зрозумілим message.

### Layer 2: HTTP timeout у googleapis-клієнті

`lib/google-client.ts` — `google.options({ timeout: 20000 })` на module-init. Усі axios-запити мають hard-stop за 20с.

### Layer 3: Vercel function maxDuration

`vercel.json` — `maxDuration: 60` на `/api/mcp`. Last-resort safety net.

### Slow-tool logging

```typescript
if (duration > 10000) {
  console.warn(`SLOW-TOOL: '${toolName}' took ${duration}ms`);
}
```

Видно у Vercel function logs.

### Налаштування через env vars (Vercel project)

| Env var | Default | Опис |
|---|---|---|
| `MCP_TOOL_TIMEOUT_MS` | 25000 | Per-tool maximum (Layer 1) |
| `MCP_GOOGLE_HTTP_TIMEOUT_MS` | 20000 | Per-HTTP-request maximum (Layer 2) |

Збільшувати якщо легально-довгі tool calls (e.g. `read_spreadsheet` на величезному Sheet) починають таймаутити часто.

---

## OAuth flow (для додавання акаунта)

```
GET /api/auth/google?account=personal
  ↓ redirect → Google consent screen
  ↓ user authorizes
  ↓ callback → /api/auth/callback
  ↓ exchange code → refresh_token
  ↓ display token → user copies → Vercel env var
GOOGLE_REFRESH_TOKEN_PERSONAL = ya29...

Потім — server use'ає token при кожному API call.
```

Tools `get_auth_url` доступний у MCP — повертає URL для OAuth flow.

---

## Auth для MCP endpoint

Header `Authorization: Bearer <MCP_SECRET_TOKEN>` ↔ env `MCP_SECRET_TOKEN`.

URL для Claude.ai connector:
```
https://google-mcp-server-sigma.vercel.app/api/mcp?token=<MCP_SECRET_TOKEN>
```

---

## Як запит проходить через server

```
[Claude Code / Claude.ai] → POST /api/mcp
  Body: { jsonrpc, id, method: "tools/call", params: {name, arguments} }
                              ↓
  Auth check (Bearer or ?token=)
                              ↓
  isAuth(req) → if false → 401
                              ↓
  Method dispatch:
    initialize → server info
    tools/list → all 27 tools з ACCOUNT_PROP
    tools/call → callTool with timeout race
                              ↓
  callTool(name, args):
    1. account = args.account
    2. makeClients(account) → OAuth2 + apis
    3. switch(name) → handler (gmail/drive/.../calendar)
    4. handler robит google.X.someMethod() with HTTP timeout 20s
    5. returns string (text) или throws
                              ↓
  if throws → catch → JSON-RPC error -32000
  if returns → JSON-RPC result with content[0].text
                              ↓
  res.json(...) → Claude Code receives → renders to user
```

---

## Файлова структура repo

```
google-mcp-server/
├── api/
│   ├── mcp.ts              ← 27 tools schema + handlers (~830 lines)
│   ├── auth/
│   │   ├── google.ts       ← OAuth start
│   │   └── callback.ts     ← OAuth callback (returns refresh_token)
├── lib/
│   ├── google-client.ts    ← OAuth2 + multi-account resolver + HTTP timeout
│   └── mcp-server.ts       ← (legacy SDK helpers, не використовується у statless mode)
├── docs/
│   ├── architecture.md     ← цей файл
│   └── progress.md         ← initial setup notes (2026-04-07)
├── README.md               ← short setup guide
├── package.json
├── tsconfig.json
└── vercel.json             ← Vercel function config (maxDuration, CORS)
```

---

## Reference: schema validation у MCP клієнтах

Деякі MCP-клієнти (зокрема Claude Code) кешують tool schemas при першому з'єднанні і **не перечитують tools/list response при кожному виклику**. Тому фічі додані пізніше через **dynamic merge у tools/list response** не доходять до клієнта.

**Workaround — explicit injection at module-init time** (вже застосовано для `account`):

```typescript
// Defensive: inject ACCOUNT_PROP at module-init so it's part of TOOLS literal
for (const t of TOOLS) {
  if (!('account' in t.inputSchema.properties)) {
    Object.assign(t.inputSchema.properties, ACCOUNT_PROP);
  }
}
```

Це гарантує що **усі responses tools/list** містять однакову (повну) схему, незалежно від того коли клієнт її прочитав.

---

## Документи у notes-hub

- Главний індекс: https://bajka.pp.ua/notes/infra/
- Architecture (цей файл): не в notes-hub (внутрішній проектний doc)

## Зв'язок з іншими проєктами

- `voice-driver/docs/mom-bot-mvp.md` — використовує `list_folder(account="personal")` для імпорту маминих віршів з Drive
- `Andrew/CLAUDE.md` — посилається на multi-account setup для бізнес-Drive/Gmail/Calendar
- `/root/projects/CLAUDE.md` секція "MCP-connectors → Google Workspace" — top-level reference

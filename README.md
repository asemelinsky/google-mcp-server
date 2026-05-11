# Productivity MCP Server

Custom MCP server connecting Claude to **Google Workspace** (Gmail, Drive, Docs, Sheets, Calendar, Contacts) and **Notion** via Vercel serverless functions. ClickUp planned next.

Multi-account: each tool accepts optional `account: "personal" | "business"`. HTTP-based (not stdio) — avoids CC 2.1.126 hangs on write operations that plague stock MCP connectors.

## Tools

**Google (27)** — see `docs/architecture.md` for full list
**Notion (14)** — `notion_search`, `notion_fetch_page`, `notion_create_page`, `notion_update_page`, `notion_get_block_children`, `notion_append_blocks`, `notion_update_block`, `notion_delete_block`, `notion_query_database`, `notion_create_database`, `notion_update_database`, `notion_get_comments`, `notion_create_comment`, `notion_get_users`

---

## Setup

### Part 1 — Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) → New project
2. Enable APIs: Gmail, Drive, Docs, Sheets, Calendar, People
3. Credentials → OAuth Client ID → Desktop app → copy Client ID + Secret

### Part 2 — Notion Integration

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**
2. Type: Internal, Workspace: your personal (and/or business later)
3. Capabilities: enable everything (Read/Update/Insert content, Read/Insert comments, Read user info)
4. Copy **Internal Integration Token** (`secret_...` or `ntn_...`)
5. In each Notion page you want the integration to see → `···` → **Connections** → add your integration

### Part 3 — Deploy to Vercel

```bash
git clone https://github.com/asemelinsky/google-mcp-server.git
cd productivity-mcp-server
npm install
vercel deploy --prod
```

Vercel env vars:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `GOOGLE_REFRESH_TOKEN_PERSONAL` | from `/api/auth/google?account=personal` flow |
| `GOOGLE_REFRESH_TOKEN_BUSINESS` | from `/api/auth/google?account=business` flow |
| `NOTION_TOKEN_PERSONAL` | from Notion integration (personal workspace) |
| `NOTION_TOKEN_BUSINESS` | (optional) from Notion integration (business workspace) |
| `MCP_SECRET_TOKEN` | random `openssl rand -hex 32` |

### Part 4 — Connect to Claude

1. [claude.ai](https://claude.ai) → Settings → Connectors → Add custom connector
2. URL: `https://google-mcp-server-sigma.vercel.app/api/mcp?token=<MCP_SECRET_TOKEN>`
3. All tools auto-appear

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) — full tool reference, multi-account flow, safety timeouts, OAuth flow, request pipeline.

## Why this exists

Stock MCP connectors (`mcp__claude_ai_Gmail__*`, `mcp__claude_ai_Notion__*`) hang on write operations in CC 2.1.126 due to stdio-based protocol regression. HTTP-based serverless function avoids the issue — same Notion/Google APIs, no hangs.

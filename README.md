# Google MCP Server

Custom MCP server connecting Claude to Gmail, Google Drive, and Google Calendar via Vercel serverless functions.

## Tools

**Gmail:** `search_emails`, `read_email`, `send_email`, `list_threads`  
**Drive:** `search_files`, `read_file`, `create_doc`, `update_doc`, `list_folder`  
**Calendar:** `list_events`, `create_event`, `get_event`

---

## Setup

### Part 1 — Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → New project
2. Enable APIs: **Gmail API**, **Google Drive API**, **Google Docs API**, **Google Calendar API**
3. Credentials → Create OAuth Client ID → Application type: **Desktop app**
4. Copy **Client ID** and **Client Secret**

### Part 2 — Deploy to Vercel

```bash
git clone https://github.com/asemelinsky/google-mcp-server.git
cd google-mcp-server
npm install
vercel deploy
```

In Vercel dashboard → Settings → Environment Variables, add:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | *(fill after Step 3)* |
| `MCP_SECRET_TOKEN` | any random string (e.g. `openssl rand -hex 32`) |

Then redeploy: `vercel --prod`

### Part 3 — One-time Google OAuth

1. Open in browser: `https://your-vercel-url/api/auth/google`
2. Complete OAuth with your corporate Google account
3. Copy the displayed `refresh_token`
4. Add it to Vercel env as `GOOGLE_REFRESH_TOKEN` → redeploy

### Part 4 — Connect to Claude

1. Go to [claude.ai](https://claude.ai) → Settings → Connectors → Add custom connector
2. URL: `https://your-vercel-url/api/mcp`
3. Auth header: `Authorization: Bearer {MCP_SECRET_TOKEN}`
4. Done — Gmail, Drive, and Calendar tools appear in Claude

---

## Environment Variables

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
MCP_SECRET_TOKEN=
VERCEL_URL=        # set automatically by Vercel
```

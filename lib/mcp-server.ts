import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { createOAuth2Client, SCOPES } from './google-client.js';
import { z } from 'zod';

export function createMcpServer(): McpServer {
  function getClients() {
    const auth = createOAuth2Client();
    return {
      gmail: google.gmail({ version: 'v1', auth }),
      drive: google.drive({ version: 'v3', auth }),
      docs: google.docs({ version: 'v1', auth }),
      calendar: google.calendar({ version: 'v3', auth }),
    };
  }

  const server = new McpServer({
    name: 'google-mcp-server',
    version: '1.0.0',
  });

  // ─── AUTH TOOLS ──────────────────────────────────────────────────────────

  server.tool(
    'get_auth_url',
    'Get Google OAuth URL to authorize a Google account for this session',
    {},
    async () => {
      const auth = createOAuth2Client();
      const url = auth.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      });
      return {
        content: [{
          type: 'text',
          text: `Open this URL in your browser to authorize a Google account:\n\n${url}\n\nAfter authorization, you will see a refresh token on the page. Copy it and call the \`authorize\` tool with that token.`,
        }],
      };
    }
  );

  server.tool(
    'authorize',
    'Verify a Google refresh token and show which account it belongs to',
    {
      refresh_token: z.string().describe('Refresh token from the OAuth callback page'),
    },
    async ({ refresh_token }) => {
      try {
        const auth = createOAuth2Client(refresh_token);
        const gmail = google.gmail({ version: 'v1', auth });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        return {
          content: [{
            type: 'text',
            text: `✅ Token is valid for: ${profile.data.emailAddress}\n\nTo use this account by default, the server admin needs to update GOOGLE_REFRESH_TOKEN in Vercel.`,
          }],
        };
      } catch {
        return { content: [{ type: 'text', text: '❌ Invalid refresh token.' }] };
      }
    }
  );

  // ─── GMAIL ───────────────────────────────────────────────────────────────

  server.tool(
    'search_emails',
    'Search Gmail inbox/sent messages',
    {
      query: z.string().describe('Gmail search query (e.g. "from:boss@corp.com subject:invoice")'),
      maxResults: z.number().optional().default(10).describe('Max number of results'),
    },
    async ({ query, maxResults }) => {
      const { gmail } = getClients();
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });
      const messages = res.data.messages ?? [];
      if (messages.length === 0) {
        return { content: [{ type: 'text', text: 'No messages found.' }] };
      }
      // fetch snippet + subject for each
      const details = await Promise.all(
        messages.map((m) =>
          gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })
        )
      );
      const lines = details.map((d) => {
        const headers = d.data.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value ?? '';
        return `ID: ${d.data.id}\nFrom: ${get('From')}\nDate: ${get('Date')}\nSubject: ${get('Subject')}\nSnippet: ${d.data.snippet}\n`;
      });
      return { content: [{ type: 'text', text: lines.join('\n---\n') }] };
    }
  );

  server.tool(
    'read_email',
    'Read full content of an email by message ID',
    {
      messageId: z.string().describe('Gmail message ID'),
    },
    async ({ messageId }) => {
      const { gmail } = getClients();
      const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
      const headers = res.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? '';

      // extract body
      let body = '';
      const parts = res.data.payload?.parts ?? [];
      const textPart = parts.find((p) => p.mimeType === 'text/plain') ?? parts[0];
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      } else if (res.data.payload?.body?.data) {
        body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf-8');
      }

      const text = [
        `From: ${get('From')}`,
        `To: ${get('To')}`,
        `Date: ${get('Date')}`,
        `Subject: ${get('Subject')}`,
        `\n${body}`,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'send_email',
    'Send or reply to an email',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Plain text body'),
      replyToMessageId: z.string().optional().describe('Message ID to reply to (optional)'),
    },
    async ({ to, subject, body, replyToMessageId }) => {
      const { gmail } = getClients();
      const raw = Buffer.from(
        `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
      )
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const requestBody: { raw: string; threadId?: string } = { raw };
      if (replyToMessageId) requestBody.threadId = replyToMessageId;
      const res = await gmail.users.messages.send({ userId: 'me', requestBody });
      return { content: [{ type: 'text', text: `Email sent. Message ID: ${res.data.id}` }] };
    }
  );

  server.tool(
    'list_threads',
    'List email threads',
    {
      labelIds: z.array(z.string()).optional().describe('Filter by label IDs (e.g. ["INBOX"])'),
      maxResults: z.number().optional().default(10).describe('Max number of threads'),
    },
    async ({ labelIds, maxResults }) => {
      const { gmail } = getClients();
      const res = await gmail.users.threads.list({ userId: 'me', labelIds, maxResults });
      const threads = res.data.threads ?? [];
      if (threads.length === 0) return { content: [{ type: 'text', text: 'No threads found.' }] };
      const lines = threads.map((t) => `Thread ID: ${t.id}  Snippet: ${t.snippet}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  // ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────

  server.tool(
    'search_files',
    'Search files in Google Drive',
    {
      query: z.string().describe("Drive query string (e.g. \"name contains 'invoice'\")"),
      mimeType: z.string().optional().describe('Filter by MIME type (e.g. "application/vnd.google-apps.document")'),
      maxResults: z.number().optional().default(10).describe('Max number of results'),
    },
    async ({ query, mimeType, maxResults }) => {
      const { drive } = getClients();
      let q = query;
      if (mimeType) q += ` and mimeType='${mimeType}'`;
      const res = await drive.files.list({ q, pageSize: maxResults, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
      const files = res.data.files ?? [];
      if (files.length === 0) return { content: [{ type: 'text', text: 'No files found.' }] };
      const lines = files.map((f) => `ID: ${f.id}\nName: ${f.name}\nType: ${f.mimeType}\nModified: ${f.modifiedTime}\nLink: ${f.webViewLink}`);
      return { content: [{ type: 'text', text: lines.join('\n---\n') }] };
    }
  );

  server.tool(
    'read_file',
    'Read content of a Google Drive file (Docs → plain text, others → download)',
    {
      fileId: z.string().describe('Google Drive file ID'),
    },
    async ({ fileId }) => {
      const { drive, docs } = getClients();
      // check mime type
      const meta = await drive.files.get({ fileId, fields: 'mimeType,name' });
      const mime = meta.data.mimeType ?? '';

      if (mime === 'application/vnd.google-apps.document') {
        const doc = await docs.documents.get({ documentId: fileId });
        const content = doc.data.body?.content ?? [];
        const text = content
          .flatMap((el) => el.paragraph?.elements ?? [])
          .map((el) => el.textRun?.content ?? '')
          .join('');
        return { content: [{ type: 'text', text: `# ${meta.data.name}\n\n${text}` }] };
      }

      // export as plain text for other Google formats
      if (mime.startsWith('application/vnd.google-apps.')) {
        const res = await drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
        return { content: [{ type: 'text', text: String(res.data) }] };
      }

      // binary download
      const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
      return { content: [{ type: 'text', text: String(res.data) }] };
    }
  );

  server.tool(
    'create_doc',
    'Create a new Google Doc',
    {
      title: z.string().describe('Document title'),
      content: z.string().optional().describe('Initial text content'),
    },
    async ({ title, content }) => {
      const { docs } = getClients();
      const doc = await docs.documents.create({ requestBody: { title } });
      const docId = doc.data.documentId!;

      if (content) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          },
        });
      }

      return { content: [{ type: 'text', text: `Created: https://docs.google.com/document/d/${docId}` }] };
    }
  );

  server.tool(
    'update_doc',
    'Append or replace content in a Google Doc',
    {
      fileId: z.string().describe('Google Doc file ID'),
      content: z.string().describe('Text to append'),
    },
    async ({ fileId, content }) => {
      const { docs } = getClients();
      const doc = await docs.documents.get({ documentId: fileId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex ?? 1;

      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: {
          requests: [{ insertText: { location: { index: endIndex - 1 }, text: '\n' + content } }],
        },
      });

      return { content: [{ type: 'text', text: `Updated document ${fileId}` }] };
    }
  );

  server.tool(
    'list_folder',
    'List files in a Google Drive folder',
    {
      folderId: z.string().optional().describe('Folder ID (omit for root)'),
    },
    async ({ folderId }) => {
      const { drive } = getClients();
      const parent = folderId ?? 'root';
      const res = await drive.files.list({
        q: `'${parent}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,modifiedTime)',
        pageSize: 50,
      });
      const files = res.data.files ?? [];
      if (files.length === 0) return { content: [{ type: 'text', text: 'Folder is empty.' }] };
      const lines = files.map((f) => `${f.mimeType?.includes('folder') ? '📁' : '📄'} ${f.name}  (${f.id})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  // ─── GOOGLE CALENDAR ──────────────────────────────────────────────────────

  server.tool(
    'list_events',
    'List upcoming Google Calendar events',
    {
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      timeMin: z.string().optional().describe('Start time ISO 8601 (default: now)'),
      timeMax: z.string().optional().describe('End time ISO 8601'),
      maxResults: z.number().optional().default(10).describe('Max number of events'),
    },
    async ({ calendarId, timeMin, timeMax, maxResults }) => {
      const { calendar } = getClients();
      const res = await calendar.events.list({
        calendarId,
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });
      const events = res.data.items ?? [];
      if (events.length === 0) return { content: [{ type: 'text', text: 'No events found.' }] };
      const lines = events.map((e) => {
        const start = e.start?.dateTime ?? e.start?.date ?? '';
        return `ID: ${e.id}\n${start} — ${e.summary}\n${e.description ?? ''}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n---\n') }] };
    }
  );

  server.tool(
    'create_event',
    'Create a Google Calendar event',
    {
      summary: z.string().describe('Event title'),
      start: z.string().describe('Start time ISO 8601'),
      end: z.string().describe('End time ISO 8601'),
      description: z.string().optional().describe('Event description'),
      attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
    },
    async ({ summary, start, end, description, attendees }) => {
      const { calendar } = getClients();
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
          attendees: attendees?.map((email) => ({ email })),
        },
      });
      return { content: [{ type: 'text', text: `Event created: ${res.data.htmlLink}` }] };
    }
  );

  server.tool(
    'get_event',
    'Get details of a specific calendar event',
    {
      eventId: z.string().describe('Calendar event ID'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
    },
    async ({ eventId, calendarId }) => {
      const { calendar } = getClients();
      const res = await calendar.events.get({ calendarId, eventId });
      const e = res.data;
      const text = [
        `Title: ${e.summary}`,
        `Start: ${e.start?.dateTime ?? e.start?.date}`,
        `End: ${e.end?.dateTime ?? e.end?.date}`,
        `Description: ${e.description ?? '—'}`,
        `Attendees: ${e.attendees?.map((a) => a.email).join(', ') ?? '—'}`,
        `Link: ${e.htmlLink}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  return server;
}

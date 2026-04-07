import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { createOAuth2Client, SCOPES } from '../lib/google-client.js';

function validateBearer(req: VercelRequest): boolean {
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${process.env.MCP_SECRET_TOKEN}`) return true;
  return (req.query['token'] as string | undefined) === process.env.MCP_SECRET_TOKEN;
}

function getClients() {
  const auth = createOAuth2Client();
  return {
    gmail: google.gmail({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
    calendar: google.calendar({ version: 'v3', auth }),
  };
}

const TOOLS = [
  {
    name: 'get_auth_url',
    description: 'Get Google OAuth URL to authorize a Google account',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_emails',
    description: 'Search Gmail inbox/sent messages',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Read full content of an email by message ID',
    inputSchema: {
      type: 'object',
      required: ['messageId'],
      properties: { messageId: { type: 'string' } },
    },
  },
  {
    name: 'send_email',
    description: 'Send or reply to an email',
    inputSchema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        replyToMessageId: { type: 'string' },
      },
    },
  },
  {
    name: 'list_threads',
    description: 'List email threads',
    inputSchema: {
      type: 'object',
      properties: {
        labelIds: { type: 'array', items: { type: 'string' } },
        maxResults: { type: 'number' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search files in Google Drive',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        mimeType: { type: 'string' },
        maxResults: { type: 'number' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read content of a Google Drive file',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } },
    },
  },
  {
    name: 'create_doc',
    description: 'Create a new Google Doc',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
    },
  },
  {
    name: 'update_doc',
    description: 'Append content to a Google Doc',
    inputSchema: {
      type: 'object',
      required: ['fileId', 'content'],
      properties: {
        fileId: { type: 'string' },
        content: { type: 'string' },
      },
    },
  },
  {
    name: 'list_folder',
    description: 'List files in a Google Drive folder',
    inputSchema: {
      type: 'object',
      properties: { folderId: { type: 'string' } },
    },
  },
  {
    name: 'list_events',
    description: 'List upcoming Google Calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        timeMin: { type: 'string' },
        timeMax: { type: 'string' },
        maxResults: { type: 'number' },
      },
    },
  },
  {
    name: 'create_event',
    description: 'Create a Google Calendar event',
    inputSchema: {
      type: 'object',
      required: ['summary', 'start', 'end'],
      properties: {
        summary: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_event',
    description: 'Get details of a specific calendar event',
    inputSchema: {
      type: 'object',
      required: ['eventId'],
      properties: {
        eventId: { type: 'string' },
        calendarId: { type: 'string' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const { gmail, drive, docs, calendar } = getClients();

  switch (name) {
    case 'get_auth_url': {
      const auth = createOAuth2Client();
      const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
      return `Open this URL to authorize a Google account:\n\n${url}`;
    }

    case 'search_emails': {
      const res = await gmail.users.messages.list({ userId: 'me', q: args.query as string, maxResults: (args.maxResults as number) ?? 10 });
      const msgs = res.data.messages ?? [];
      if (!msgs.length) return 'No messages found.';
      const details = await Promise.all(msgs.map(m => gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })));
      return details.map(d => {
        const h = d.data.payload?.headers ?? [];
        const g = (n: string) => h.find(x => x.name === n)?.value ?? '';
        return `ID: ${d.data.id}\nFrom: ${g('From')}\nDate: ${g('Date')}\nSubject: ${g('Subject')}\nSnippet: ${d.data.snippet}`;
      }).join('\n---\n');
    }

    case 'read_email': {
      const res = await gmail.users.messages.get({ userId: 'me', id: args.messageId as string, format: 'full' });
      const h = res.data.payload?.headers ?? [];
      const g = (n: string) => h.find((x: {name?: string|null}) => x.name === n)?.value ?? '';
      const parts = res.data.payload?.parts ?? [];
      const textPart = parts.find((p: {mimeType?: string|null}) => p.mimeType === 'text/plain') ?? parts[0];
      let body = '';
      if ((textPart as {body?: {data?: string|null}})?.body?.data) body = Buffer.from((textPart as {body: {data: string}}).body.data, 'base64').toString('utf-8');
      else if (res.data.payload?.body?.data) body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf-8');
      return `From: ${g('From')}\nTo: ${g('To')}\nDate: ${g('Date')}\nSubject: ${g('Subject')}\n\n${body}`;
    }

    case 'send_email': {
      const encodeHeader = (s: string) => /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=` : s;
      const subject = encodeHeader(args.subject as string);
      const raw = Buffer.from(`To: ${args.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.body}`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const requestBody: { raw: string; threadId?: string } = { raw };
      if (args.replyToMessageId) requestBody.threadId = args.replyToMessageId as string;
      const res = await gmail.users.messages.send({ userId: 'me', requestBody });
      return `Email sent. Message ID: ${res.data.id}`;
    }

    case 'list_threads': {
      const res = await gmail.users.threads.list({ userId: 'me', labelIds: args.labelIds as string[], maxResults: (args.maxResults as number) ?? 10 });
      const threads = res.data.threads ?? [];
      if (!threads.length) return 'No threads found.';
      return threads.map(t => `Thread ID: ${t.id}  Snippet: ${t.snippet}`).join('\n');
    }

    case 'search_files': {
      let q = args.query as string;
      if (args.mimeType) q += ` and mimeType='${args.mimeType}'`;
      const res = await drive.files.list({ q, pageSize: (args.maxResults as number) ?? 10, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
      const files = res.data.files ?? [];
      if (!files.length) return 'No files found.';
      return files.map(f => `ID: ${f.id}\nName: ${f.name}\nType: ${f.mimeType}\nModified: ${f.modifiedTime}\nLink: ${f.webViewLink}`).join('\n---\n');
    }

    case 'read_file': {
      const meta = await drive.files.get({ fileId: args.fileId as string, fields: 'mimeType,name' });
      const mime = meta.data.mimeType ?? '';
      if (mime === 'application/vnd.google-apps.document') {
        const doc = await docs.documents.get({ documentId: args.fileId as string });
        const text = (doc.data.body?.content ?? []).flatMap(el => el.paragraph?.elements ?? []).map(el => el.textRun?.content ?? '').join('');
        return `# ${meta.data.name}\n\n${text}`;
      }
      if (mime.startsWith('application/vnd.google-apps.')) {
        const res = await drive.files.export({ fileId: args.fileId as string, mimeType: 'text/plain' }, { responseType: 'text' });
        return String(res.data);
      }
      const res = await drive.files.get({ fileId: args.fileId as string, alt: 'media' }, { responseType: 'text' });
      return String(res.data);
    }

    case 'create_doc': {
      const doc = await docs.documents.create({ requestBody: { title: args.title as string } });
      const docId = doc.data.documentId!;
      if (args.content) {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { location: { index: 1 }, text: args.content as string } }] } });
      }
      return `Created: https://docs.google.com/document/d/${docId}`;
    }

    case 'update_doc': {
      const doc = await docs.documents.get({ documentId: args.fileId as string });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex ?? 1;
      await docs.documents.batchUpdate({ documentId: args.fileId as string, requestBody: { requests: [{ insertText: { location: { index: endIndex - 1 }, text: '\n' + args.content } }] } });
      return `Updated document ${args.fileId}`;
    }

    case 'list_folder': {
      const parent = (args.folderId as string) ?? 'root';
      const res = await drive.files.list({ q: `'${parent}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: 50 });
      const files = res.data.files ?? [];
      if (!files.length) return 'Folder is empty.';
      return files.map(f => `${f.mimeType?.includes('folder') ? '📁' : '📄'} ${f.name}  (${f.id})`).join('\n');
    }

    case 'list_events': {
      const res = await calendar.events.list({
        calendarId: (args.calendarId as string) ?? 'primary',
        timeMin: (args.timeMin as string) ?? new Date().toISOString(),
        timeMax: args.timeMax as string,
        maxResults: (args.maxResults as number) ?? 10,
        singleEvents: true,
        orderBy: 'startTime',
      });
      const events = res.data.items ?? [];
      if (!events.length) return 'No events found.';
      return events.map(e => `ID: ${e.id}\n${e.start?.dateTime ?? e.start?.date} — ${e.summary}\n${e.description ?? ''}`).join('\n---\n');
    }

    case 'create_event': {
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: args.summary as string,
          description: args.description as string,
          start: { dateTime: args.start as string },
          end: { dateTime: args.end as string },
          attendees: (args.attendees as string[] | undefined)?.map(email => ({ email })),
        },
      });
      return `Event created: ${res.data.htmlLink}`;
    }

    case 'get_event': {
      const res = await calendar.events.get({ calendarId: (args.calendarId as string) ?? 'primary', eventId: args.eventId as string });
      const e = res.data;
      return [`Title: ${e.summary}`, `Start: ${e.start?.dateTime ?? e.start?.date}`, `End: ${e.end?.dateTime ?? e.end?.date}`, `Description: ${e.description ?? '—'}`, `Attendees: ${e.attendees?.map(a => a.email).join(', ') ?? '—'}`, `Link: ${e.htmlLink}`].join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function jsonrpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!validateBearer(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body;
  const id = body?.id ?? null;
  const method = body?.method;

  try {
    if (method === 'initialize') {
      return res.json(jsonrpc(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'google-mcp-server', version: '1.0.0' },
      }));
    }

    if (method === 'notifications/initialized') {
      return res.status(204).end();
    }

    if (method === 'tools/list') {
      return res.json(jsonrpc(id, { tools: TOOLS }));
    }

    if (method === 'tools/call') {
      const toolName = body.params?.name as string;
      const toolArgs = (body.params?.arguments ?? {}) as Record<string, unknown>;
      const text = await callTool(toolName, toolArgs);
      return res.json(jsonrpc(id, { content: [{ type: 'text', text }] }));
    }

    return res.json(jsonrpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('MCP error:', message);
    return res.json(jsonrpcError(id, -32000, message));
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { createOAuth2Client, SCOPES, type GoogleAccount } from '../lib/google-client.js';

function validateBearer(req: VercelRequest): boolean {
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${process.env.MCP_SECRET_TOKEN}`) return true;
  return (req.query['token'] as string | undefined) === process.env.MCP_SECRET_TOKEN;
}

function makeClients(account?: GoogleAccount) {
  const auth = createOAuth2Client(account);
  return {
    gmail: google.gmail({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
    calendar: google.calendar({ version: 'v3', auth }),
    people: google.people({ version: 'v1', auth }),
  };
}

// Optional `account` parameter merged into every tool schema by tools/list response
const ACCOUNT_PROP = {
  account: {
    type: 'string',
    enum: ['personal', 'business'],
    description: 'Google account: "personal"=a.semelinsky@gmail.com, "business"=o.semelinksy@j127group.com. If omitted, uses default (currently business).',
  },
} as const;

const TOOLS = [
  // Auth
  {
    name: 'get_auth_url',
    description: 'Get Google OAuth URL to authorize a Google account',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_profile',
    description: 'Get Gmail profile info (email, total messages, threads)',
    inputSchema: { type: 'object', properties: {} },
  },

  // Gmail
  {
    name: 'search_emails',
    description: 'Search Gmail messages',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g. "in:inbox", "from:user@example.com")' },
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
        replyToMessageId: { type: 'string', description: 'Message ID to reply to (sets threadId)' },
      },
    },
  },
  {
    name: 'delete_email',
    description: 'Move an email to trash',
    inputSchema: {
      type: 'object',
      required: ['messageId'],
      properties: { messageId: { type: 'string' } },
    },
  },
  {
    name: 'archive_email',
    description: 'Archive an email (remove from inbox without deleting)',
    inputSchema: {
      type: 'object',
      required: ['messageId'],
      properties: { messageId: { type: 'string' } },
    },
  },
  {
    name: 'label_email',
    description: 'Add or remove labels on an email (e.g. STARRED, IMPORTANT, UNREAD)',
    inputSchema: {
      type: 'object',
      required: ['messageId'],
      properties: {
        messageId: { type: 'string' },
        addLabels: { type: 'array', items: { type: 'string' }, description: 'Label IDs to add' },
        removeLabels: { type: 'array', items: { type: 'string' }, description: 'Label IDs to remove' },
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

  // Drive
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
    description: 'Read content of a Google Drive file (Docs, Sheets, plain files)',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } },
    },
  },
  {
    name: 'list_folder',
    description: 'List files in a Google Drive folder',
    inputSchema: {
      type: 'object',
      properties: { folderId: { type: 'string', description: 'Folder ID (default: root)' } },
    },
  },
  {
    name: 'create_folder',
    description: 'Create a folder in Google Drive',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        parentFolderId: { type: 'string', description: 'Parent folder ID (default: root)' },
      },
    },
  },
  {
    name: 'share_file',
    description: 'Share a Google Drive file or folder with a user',
    inputSchema: {
      type: 'object',
      required: ['fileId', 'email'],
      properties: {
        fileId: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string', description: 'reader | commenter | writer (default: reader)' },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Move a Google Drive file to trash',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } },
    },
  },

  // Docs
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
    name: 'replace_in_doc',
    description: 'Find and replace text in a Google Doc',
    inputSchema: {
      type: 'object',
      required: ['fileId', 'find', 'replace'],
      properties: {
        fileId: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        matchCase: { type: 'boolean', description: 'Case sensitive (default false)' },
      },
    },
  },

  // Sheets
  {
    name: 'create_spreadsheet',
    description: 'Create a new Google Spreadsheet',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' } },
    },
  },
  {
    name: 'read_spreadsheet',
    description: 'Read rows from a Google Spreadsheet range',
    inputSchema: {
      type: 'object',
      required: ['spreadsheetId'],
      properties: {
        spreadsheetId: { type: 'string' },
        range: { type: 'string', description: 'A1 notation, e.g. "Sheet1!A1:D10" (default: Sheet1)' },
      },
    },
  },
  {
    name: 'write_spreadsheet',
    description: 'Write rows to a Google Spreadsheet',
    inputSchema: {
      type: 'object',
      required: ['spreadsheetId', 'range', 'values'],
      properties: {
        spreadsheetId: { type: 'string' },
        range: { type: 'string', description: 'A1 notation, e.g. "Sheet1!A1"' },
        values: { type: 'array', items: { type: 'array' }, description: '2D array of values' },
      },
    },
  },

  // Calendar
  {
    name: 'list_events',
    description: 'List upcoming Google Calendar events',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        timeMin: { type: 'string', description: 'ISO 8601 start time (default: now)' },
        timeMax: { type: 'string', description: 'ISO 8601 end time' },
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
        start: { type: 'string', description: 'ISO 8601 datetime' },
        end: { type: 'string', description: 'ISO 8601 datetime' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'List of email addresses' },
      },
    },
  },
  {
    name: 'update_event',
    description: 'Update a Google Calendar event',
    inputSchema: {
      type: 'object',
      required: ['eventId'],
      properties: {
        eventId: { type: 'string' },
        calendarId: { type: 'string' },
        summary: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a Google Calendar event',
    inputSchema: {
      type: 'object',
      required: ['eventId'],
      properties: {
        eventId: { type: 'string' },
        calendarId: { type: 'string' },
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

  // Contacts
  {
    name: 'get_contacts',
    description: 'List Google Contacts',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max contacts to return (default 20)' },
        query: { type: 'string', description: 'Search query to filter contacts' },
      },
    },
  },
];

const encodeHeader = (s: string) =>
  /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=` : s;

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const account = (args.account as GoogleAccount | undefined);
  const { gmail, drive, docs, sheets, calendar, people } = makeClients(account);

  switch (name) {
    case 'get_auth_url': {
      const auth = createOAuth2Client();
      const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
      return `Open this URL to authorize a Google account:\n\n${url}`;
    }

    case 'get_profile': {
      const res = await gmail.users.getProfile({ userId: 'me' });
      const d = res.data;
      return `Email: ${d.emailAddress}\nTotal messages: ${d.messagesTotal}\nTotal threads: ${d.threadsTotal}`;
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
      const g = (n: string) => h.find((x: { name?: string | null }) => x.name === n)?.value ?? '';
      const parts = res.data.payload?.parts ?? [];
      const textPart = parts.find((p: { mimeType?: string | null }) => p.mimeType === 'text/plain') ?? parts[0];
      let body = '';
      if ((textPart as { body?: { data?: string | null } })?.body?.data)
        body = Buffer.from((textPart as { body: { data: string } }).body.data, 'base64').toString('utf-8');
      else if (res.data.payload?.body?.data)
        body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf-8');
      return `From: ${g('From')}\nTo: ${g('To')}\nDate: ${g('Date')}\nSubject: ${g('Subject')}\n\n${body}`;
    }

    case 'send_email': {
      const subject = encodeHeader(args.subject as string);
      const raw = Buffer.from(`To: ${args.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.body}`)
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const requestBody: { raw: string; threadId?: string } = { raw };
      if (args.replyToMessageId) requestBody.threadId = args.replyToMessageId as string;
      const res = await gmail.users.messages.send({ userId: 'me', requestBody });
      return `Email sent. Message ID: ${res.data.id}`;
    }

    case 'delete_email': {
      await gmail.users.messages.trash({ userId: 'me', id: args.messageId as string });
      return `Message ${args.messageId} moved to trash.`;
    }

    case 'archive_email': {
      await gmail.users.messages.modify({ userId: 'me', id: args.messageId as string, requestBody: { removeLabelIds: ['INBOX'] } });
      return `Message ${args.messageId} archived.`;
    }

    case 'label_email': {
      await gmail.users.messages.modify({
        userId: 'me',
        id: args.messageId as string,
        requestBody: {
          addLabelIds: (args.addLabels as string[]) ?? [],
          removeLabelIds: (args.removeLabels as string[]) ?? [],
        },
      });
      return `Labels updated on message ${args.messageId}.`;
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
        const res = await drive.files.export({ fileId: args.fileId as string, mimeType: 'text/markdown' }, { responseType: 'text' });
        return `# ${meta.data.name}\n\n${String(res.data)}`;
      }
      if (mime.startsWith('application/vnd.google-apps.')) {
        const res = await drive.files.export({ fileId: args.fileId as string, mimeType: 'text/plain' }, { responseType: 'text' });
        return String(res.data);
      }
      const res = await drive.files.get({ fileId: args.fileId as string, alt: 'media' }, { responseType: 'text' });
      return String(res.data);
    }

    case 'list_folder': {
      const parent = (args.folderId as string) ?? 'root';
      const res = await drive.files.list({ q: `'${parent}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: 50 });
      const files = res.data.files ?? [];
      if (!files.length) return 'Folder is empty.';
      return files.map(f => `${f.mimeType?.includes('folder') ? '📁' : '📄'} ${f.name}  (${f.id})`).join('\n');
    }

    case 'create_folder': {
      const res = await drive.files.create({
        requestBody: {
          name: args.name as string,
          mimeType: 'application/vnd.google-apps.folder',
          parents: args.parentFolderId ? [args.parentFolderId as string] : undefined,
        },
        fields: 'id,name',
      });
      return `Folder created: ${res.data.name} (ID: ${res.data.id})`;
    }

    case 'share_file': {
      await drive.permissions.create({
        fileId: args.fileId as string,
        requestBody: {
          type: 'user',
          role: (args.role as string) ?? 'reader',
          emailAddress: args.email as string,
        },
      });
      return `Shared ${args.fileId} with ${args.email} as ${(args.role as string) ?? 'reader'}.`;
    }

    case 'delete_file': {
      await drive.files.update({ fileId: args.fileId as string, requestBody: { trashed: true } });
      return `File ${args.fileId} moved to trash.`;
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

    case 'replace_in_doc': {
      const res = await docs.documents.batchUpdate({
        documentId: args.fileId as string,
        requestBody: {
          requests: [{
            replaceAllText: {
              containsText: { text: args.find as string, matchCase: (args.matchCase as boolean) ?? false },
              replaceText: args.replace as string,
            },
          }],
        },
      });
      const count = (res.data.replies?.[0] as { replaceAllText?: { occurrencesChanged?: number } })?.replaceAllText?.occurrencesChanged ?? 0;
      return `Replaced ${count} occurrence(s) of "${args.find}" → "${args.replace}"`;
    }

    case 'create_spreadsheet': {
      const res = await sheets.spreadsheets.create({ requestBody: { properties: { title: args.title as string } } });
      return `Created: https://docs.google.com/spreadsheets/d/${res.data.spreadsheetId}`;
    }

    case 'read_spreadsheet': {
      const range = (args.range as string) ?? 'Sheet1';
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: args.spreadsheetId as string, range });
      const rows = res.data.values ?? [];
      if (!rows.length) return 'No data found.';
      return rows.map(r => r.join('\t')).join('\n');
    }

    case 'write_spreadsheet': {
      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: args.spreadsheetId as string,
        range: args.range as string,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: args.values as string[][] },
      });
      return `Updated ${res.data.updatedCells} cells in ${res.data.updatedRange}.`;
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

    case 'update_event': {
      const existing = await calendar.events.get({ calendarId: (args.calendarId as string) ?? 'primary', eventId: args.eventId as string });
      const e = existing.data;
      const res = await calendar.events.update({
        calendarId: (args.calendarId as string) ?? 'primary',
        eventId: args.eventId as string,
        requestBody: {
          summary: (args.summary as string) ?? e.summary,
          description: (args.description as string) ?? e.description,
          start: args.start ? { dateTime: args.start as string } : e.start,
          end: args.end ? { dateTime: args.end as string } : e.end,
          attendees: args.attendees ? (args.attendees as string[]).map(email => ({ email })) : e.attendees,
        },
      });
      return `Event updated: ${res.data.htmlLink}`;
    }

    case 'delete_event': {
      await calendar.events.delete({ calendarId: (args.calendarId as string) ?? 'primary', eventId: args.eventId as string });
      return `Event ${args.eventId} deleted.`;
    }

    case 'get_event': {
      const res = await calendar.events.get({ calendarId: (args.calendarId as string) ?? 'primary', eventId: args.eventId as string });
      const e = res.data;
      return [`Title: ${e.summary}`, `Start: ${e.start?.dateTime ?? e.start?.date}`, `End: ${e.end?.dateTime ?? e.end?.date}`, `Description: ${e.description ?? '—'}`, `Attendees: ${e.attendees?.map(a => a.email).join(', ') ?? '—'}`, `Link: ${e.htmlLink}`].join('\n');
    }

    case 'get_contacts': {
      if (args.query) {
        const res = await people.people.searchContacts({
          query: args.query as string,
          pageSize: (args.maxResults as number) ?? 20,
          readMask: 'names,emailAddresses,phoneNumbers',
        });
        const results = res.data.results ?? [];
        if (!results.length) return 'No contacts found.';
        return results.map(r => {
          const p = r.person;
          const name = p?.names?.[0]?.displayName ?? '—';
          const email = p?.emailAddresses?.[0]?.value ?? '—';
          const phone = p?.phoneNumbers?.[0]?.value ?? '—';
          return `Name: ${name}\nEmail: ${email}\nPhone: ${phone}`;
        }).join('\n---\n');
      }
      const res = await people.people.connections.list({
        resourceName: 'people/me',
        pageSize: (args.maxResults as number) ?? 20,
        personFields: 'names,emailAddresses,phoneNumbers',
      });
      const contacts = res.data.connections ?? [];
      if (!contacts.length) return 'No contacts found.';
      return contacts.map(p => {
        const name = p.names?.[0]?.displayName ?? '—';
        const email = p.emailAddresses?.[0]?.value ?? '—';
        const phone = p.phoneNumbers?.[0]?.value ?? '—';
        return `Name: ${name}\nEmail: ${email}\nPhone: ${phone}`;
      }).join('\n---\n');
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
      // Merge ACCOUNT_PROP into every tool's inputSchema.properties (so Claude can pass `account`)
      const toolsWithAccount = TOOLS.map((t: any) => ({
        ...t,
        inputSchema: {
          ...t.inputSchema,
          properties: {
            ...(t.inputSchema?.properties ?? {}),
            ...ACCOUNT_PROP,
          },
        },
      }));
      return res.json(jsonrpc(id, { tools: toolsWithAccount }));
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

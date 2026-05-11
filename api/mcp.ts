import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { createOAuth2Client, SCOPES, type GoogleAccount } from '../lib/google-client.js';
import { notionFetch, notionPaginate, type NotionAccount } from '../lib/notion-client.js';

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

// Optional `account` parameter merged into every tool schema (both at definition time and tools/list response)
const ACCOUNT_PROP = {
  account: {
    type: 'string',
    enum: ['personal', 'business'],
    description: 'Account/workspace selector. "personal" = a.semelinsky@gmail.com (Google) or personal Notion workspace. "business" = o.semelinksy@j127group.com (Google) or J127 Notion workspace. Defaults: business for Google tools, personal for Notion tools.',
  },
} as const;

// Reusable Reminder definition for Calendar event tools (mirrors stock Google Calendar MCP shape)
const REMINDER_DEF = {
  type: 'object',
  required: ['method', 'minutes'],
  properties: {
    method: { type: 'string', enum: ['email', 'popup'], description: 'Reminder delivery method' },
    minutes: { type: 'integer', description: 'Minutes before event to fire reminder' },
  },
} as const;

// Common props shared by create_event/update_event — feature parity with stock Google Calendar create_event
const EVENT_COMMON_PROPS = {
  location: { type: 'string', description: 'Geographic location free-form text' },
  calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
  timeZone: { type: 'string', description: 'IANA TZ name (e.g. Europe/Kyiv). Used to resolve timezone-less dates.' },
  overrideReminders: {
    type: 'array',
    items: REMINDER_DEF,
    description: 'Reminders {method, minutes} overriding calendar default. If set — useDefault becomes false.',
  },
  addGoogleMeetUrl: { type: 'boolean', description: 'Generate a Google Meet URL for this event' },
  allDay: { type: 'boolean', description: 'All-day event. start/end must be YYYY-MM-DD if true.' },
  colorId: { type: 'string', description: '1-11 — Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato' },
  recurrenceData: {
    type: 'array',
    items: { type: 'string' },
    description: 'RRULE/RDATE/EXDATE per RFC 5545. e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]',
  },
  visibility: { type: 'string', enum: ['default', 'public', 'private'] },
  notificationLevel: {
    type: 'string',
    enum: ['NONE', 'EXTERNAL_ONLY', 'ALL'],
    description: 'Email notifications to attendees on create/update',
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
        ...ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read content of a Google Drive file (Docs, Sheets, plain files)',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' }, ...ACCOUNT_PROP },
    },
  },
  {
    name: 'list_folder',
    description: 'List files in a Google Drive folder',
    inputSchema: {
      type: 'object',
      properties: { folderId: { type: 'string', description: 'Folder ID (default: root)' }, ...ACCOUNT_PROP },
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
        ...ACCOUNT_PROP,
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
        ...ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Move a Google Drive file to trash',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' }, ...ACCOUNT_PROP },
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
    description: 'Create a Google Calendar event with full feature parity to stock Google Calendar MCP — supports location, timeZone, overrideReminders, recurrence, all-day, Google Meet URL, etc.',
    inputSchema: {
      type: 'object',
      required: ['summary', 'start', 'end'],
      properties: {
        summary: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'ISO 8601 datetime, OR YYYY-MM-DD if allDay=true' },
        end: { type: 'string', description: 'ISO 8601 datetime, OR YYYY-MM-DD if allDay=true' },
        description: { type: 'string', description: 'Event description (HTML allowed)' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
        ...EVENT_COMMON_PROPS,
      },
    },
  },
  {
    name: 'update_event',
    description: 'Update a Google Calendar event. All fields optional except eventId — only provided fields are changed.',
    inputSchema: {
      type: 'object',
      required: ['eventId'],
      properties: {
        eventId: { type: 'string', description: 'Event ID to update' },
        summary: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 datetime or YYYY-MM-DD' },
        end: { type: 'string', description: 'ISO 8601 datetime or YYYY-MM-DD' },
        description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        ...EVENT_COMMON_PROPS,
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

  // Notion (14)
  {
    name: 'notion_search',
    description: 'Search Notion pages and databases by title (full-text). Returns items the integration has access to.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match in titles. Empty string returns all accessible items.' },
        filterType: { type: 'string', enum: ['page', 'database'], description: 'Optionally restrict to one type.' },
        sortLastEditedDesc: { type: 'boolean', description: 'Sort by last edited desc. Default true.' },
        maxResults: { type: 'number', description: 'Max items to return (default 50)' },
      },
    },
  },
  {
    name: 'notion_fetch_page',
    description: 'Fetch full content of a Notion page including all child blocks (recursively expanded).',
    inputSchema: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', description: 'Notion page ID (with or without dashes)' },
        includeBlocks: { type: 'boolean', description: 'Include child blocks content. Default true.' },
        maxDepth: { type: 'number', description: 'Max recursion depth for child blocks. Default 3.' },
      },
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page under a parent (page_id, database_id, or workspace root).',
    inputSchema: {
      type: 'object',
      required: ['parent'],
      properties: {
        parent: { type: 'object', description: 'Parent: {type:"page_id", page_id:"..."} or {type:"database_id", database_id:"..."} or {type:"workspace", workspace:true}' },
        properties: { type: 'object', description: 'For DB children — must match DB schema. For page children — at minimum {title:[{text:{content:"..."}}]}.' },
        children: { type: 'array', description: 'Block objects as initial content. e.g. [{type:"paragraph", paragraph:{rich_text:[{text:{content:"hello"}}]}}]' },
        icon: { type: 'object', description: 'e.g. {type:"emoji", emoji:"📝"}' },
        cover: { type: 'object', description: 'e.g. {type:"external", external:{url:"https://..."}}' },
      },
    },
  },
  {
    name: 'notion_update_page',
    description: 'Update Notion page properties, icon, cover, or archive status.',
    inputSchema: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string' },
        properties: { type: 'object', description: 'Properties to update (must match DB schema if page is a DB row)' },
        icon: { type: 'object' },
        cover: { type: 'object' },
        archived: { type: 'boolean', description: 'Set true to archive (soft delete)' },
      },
    },
  },
  {
    name: 'notion_get_block_children',
    description: 'List immediate child blocks of a page or block.',
    inputSchema: {
      type: 'object',
      required: ['blockId'],
      properties: {
        blockId: { type: 'string', description: 'Page ID or block ID' },
        maxResults: { type: 'number', description: 'Max blocks (default 100)' },
      },
    },
  },
  {
    name: 'notion_append_blocks',
    description: 'Append blocks to the end of a page or block. Max 100 blocks per call.',
    inputSchema: {
      type: 'object',
      required: ['blockId', 'children'],
      properties: {
        blockId: { type: 'string', description: 'Target page ID or block ID' },
        children: { type: 'array', description: 'Array of block objects to append' },
        after: { type: 'string', description: 'Optional: append after specific existing block ID' },
      },
    },
  },
  {
    name: 'notion_update_block',
    description: 'Update content of an existing block.',
    inputSchema: {
      type: 'object',
      required: ['blockId', 'block'],
      properties: {
        blockId: { type: 'string' },
        block: { type: 'object', description: 'Block payload, e.g. {paragraph:{rich_text:[{text:{content:"new"}}]}}' },
      },
    },
  },
  {
    name: 'notion_delete_block',
    description: 'Delete (move to trash) a block. For whole pages, use notion_update_page with archived=true.',
    inputSchema: {
      type: 'object',
      required: ['blockId'],
      properties: {
        blockId: { type: 'string' },
      },
    },
  },
  {
    name: 'notion_query_database',
    description: 'Query a Notion database with filter/sort. Returns matching pages (DB rows).',
    inputSchema: {
      type: 'object',
      required: ['databaseId'],
      properties: {
        databaseId: { type: 'string' },
        filter: { type: 'object', description: 'Notion filter object, e.g. {property:"Status", select:{equals:"Done"}}' },
        sorts: { type: 'array', description: 'Sort spec, e.g. [{property:"Created", direction:"descending"}]' },
        maxResults: { type: 'number', description: 'Max rows (default 100)' },
      },
    },
  },
  {
    name: 'notion_create_database',
    description: 'Create a new database under a parent page.',
    inputSchema: {
      type: 'object',
      required: ['parent', 'title', 'properties'],
      properties: {
        parent: { type: 'object', description: '{type:"page_id", page_id:"..."}' },
        title: { type: 'array', description: 'Title rich_text array, e.g. [{type:"text", text:{content:"Tasks"}}]' },
        properties: { type: 'object', description: 'Schema, e.g. {Name:{title:{}}, Status:{select:{options:[{name:"Todo"},{name:"Done"}]}}}' },
        icon: { type: 'object' },
        isInline: { type: 'boolean', description: 'Default false (full-page DB). True for inline DB.' },
      },
    },
  },
  {
    name: 'notion_update_database',
    description: 'Update database title, description, or property schema.',
    inputSchema: {
      type: 'object',
      required: ['databaseId'],
      properties: {
        databaseId: { type: 'string' },
        title: { type: 'array' },
        description: { type: 'array' },
        properties: { type: 'object', description: 'Property schema patch — add/rename/remove fields' },
      },
    },
  },
  {
    name: 'notion_get_comments',
    description: 'List comments attached to a page or block.',
    inputSchema: {
      type: 'object',
      required: ['blockId'],
      properties: {
        blockId: { type: 'string', description: 'Page ID or block ID' },
        maxResults: { type: 'number', description: 'Default 100' },
      },
    },
  },
  {
    name: 'notion_create_comment',
    description: 'Create a comment on a page or reply in an existing discussion thread.',
    inputSchema: {
      type: 'object',
      required: ['richText'],
      properties: {
        parent: { type: 'object', description: '{page_id:"..."} for top-level comment on page. Use either parent OR discussionId.' },
        discussionId: { type: 'string', description: 'Use to reply in existing thread (instead of parent)' },
        richText: { type: 'array', description: 'Rich text array, e.g. [{type:"text", text:{content:"hello"}}]' },
      },
    },
  },
  {
    name: 'notion_get_users',
    description: 'List users in the Notion workspace (bots + members).',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Default 50' },
      },
    },
  },
];

// Defensive: inject ACCOUNT_PROP into every tool schema at module init.
// Some MCP clients (e.g. Claude Code) cache tool schemas at first connect and don't re-fetch tools/list,
// so dynamic merge in the tools/list handler isn't enough — schema must be explicit at definition time.
for (const t of TOOLS as Array<{ inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] } }>) {
  if (!t.inputSchema) t.inputSchema = { type: 'object', properties: {} };
  if (!t.inputSchema.properties) t.inputSchema.properties = {};
  if (!('account' in t.inputSchema.properties)) {
    Object.assign(t.inputSchema.properties, ACCOUNT_PROP);
  }
}

const encodeHeader = (s: string) =>
  /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=` : s;

// ---------- Notion helpers ----------

function extractNotionTitle(obj: any): string {
  // Pages: find property of type "title"; databases: top-level title array; blocks: best-effort.
  if (obj.object === 'database' && Array.isArray(obj.title)) {
    return obj.title.map((rt: any) => rt.plain_text ?? '').join('') || '(untitled)';
  }
  const props = obj.properties ?? {};
  for (const v of Object.values(props) as any[]) {
    if (v?.type === 'title' && Array.isArray(v.title)) {
      return v.title.map((rt: any) => rt.plain_text ?? '').join('') || '(untitled)';
    }
  }
  return '(untitled)';
}

function stringifyNotionProperty(p: any): string {
  if (!p) return '';
  switch (p.type) {
    case 'title':
    case 'rich_text':
      return (p[p.type] ?? []).map((rt: any) => rt.plain_text ?? '').join('');
    case 'number': return String(p.number ?? '');
    case 'select': return p.select?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((s: any) => s.name).join(', ');
    case 'status': return p.status?.name ?? '';
    case 'date': {
      const d = p.date;
      if (!d) return '';
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case 'checkbox': return p.checkbox ? '✓' : '✗';
    case 'url': return p.url ?? '';
    case 'email': return p.email ?? '';
    case 'phone_number': return p.phone_number ?? '';
    case 'people': return (p.people ?? []).map((u: any) => u.name ?? u.id).join(', ');
    case 'files': return (p.files ?? []).map((f: any) => f.name).join(', ');
    case 'relation': return (p.relation ?? []).map((r: any) => r.id).join(', ');
    case 'formula': return stringifyNotionProperty({ type: p.formula?.type, [p.formula?.type]: p.formula?.[p.formula?.type] });
    case 'rollup': return JSON.stringify(p.rollup);
    case 'created_time': return p.created_time;
    case 'last_edited_time': return p.last_edited_time;
    case 'created_by': return p.created_by?.id ?? '';
    case 'last_edited_by': return p.last_edited_by?.id ?? '';
    case 'unique_id': return `${p.unique_id?.prefix ?? ''}${p.unique_id?.number ?? ''}`;
    default: return `[${p.type}]`;
  }
}

function stringifyBlockSummary(b: any): string {
  const t = b.type;
  const data = b[t];
  if (!data) return `<empty ${t}>`;
  if (Array.isArray(data.rich_text)) {
    return data.rich_text.map((rt: any) => rt.plain_text ?? '').join('').slice(0, 200);
  }
  if (data.url) return data.url;
  if (data.title) return data.title;
  return `<${t}>`;
}

async function fetchBlocksRecursive(blockId: string, account: NotionAccount | undefined, maxDepth: number, depth: number): Promise<string> {
  if (depth >= maxDepth) return '  '.repeat(depth) + '… (max depth reached)';
  const blocks: any[] = await notionPaginate('GET', `/blocks/${blockId}/children?page_size=100`, account, undefined, 5);
  const lines: string[] = [];
  for (const b of blocks) {
    const indent = '  '.repeat(depth);
    const prefix = b.type === 'heading_1' ? '# '
      : b.type === 'heading_2' ? '## '
      : b.type === 'heading_3' ? '### '
      : b.type === 'bulleted_list_item' ? '- '
      : b.type === 'numbered_list_item' ? '1. '
      : b.type === 'to_do' ? (b.to_do?.checked ? '[x] ' : '[ ] ')
      : b.type === 'quote' ? '> '
      : b.type === 'code' ? '```\n' + (b.code?.language ?? '') + '\n'
      : '';
    const summary = stringifyBlockSummary(b);
    lines.push(`${indent}${prefix}${summary}${b.type === 'code' ? '\n```' : ''}`);
    if (b.has_children) {
      lines.push(await fetchBlocksRecursive(b.id, account, maxDepth, depth + 1));
    }
  }
  return lines.join('\n');
}

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
      const all: Array<{ id?: string | null; name?: string | null; mimeType?: string | null }> = [];
      let pageToken: string | undefined;
      // Paginate through all pages — Drive caps at 1000 per page; loop until exhausted
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
      if (!all.length) return 'Folder is empty.';
      const header = `Total: ${all.length} item(s)\n`;
      return header + all.map(f => `${f.mimeType?.includes('folder') ? '📁' : '📄'} ${f.name}  (${f.id})`).join('\n');
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
      const allDay = (args.allDay as boolean) === true;
      const tz = args.timeZone as string | undefined;
      const start = allDay
        ? { date: args.start as string }
        : { dateTime: args.start as string, ...(tz ? { timeZone: tz } : {}) };
      const end = allDay
        ? { date: args.end as string }
        : { dateTime: args.end as string, ...(tz ? { timeZone: tz } : {}) };

      const overrideReminders = args.overrideReminders as Array<{ method: string; minutes: number }> | undefined;

      const requestBody: Record<string, unknown> = {
        summary: args.summary as string,
        description: args.description as string | undefined,
        location: args.location as string | undefined,
        start,
        end,
        attendees: (args.attendees as string[] | undefined)?.map(email => ({ email })),
        colorId: args.colorId as string | undefined,
        visibility: args.visibility as string | undefined,
        recurrence: args.recurrenceData as string[] | undefined,
        ...(overrideReminders ? { reminders: { useDefault: false, overrides: overrideReminders } } : {}),
        ...((args.addGoogleMeetUrl as boolean) === true
          ? { conferenceData: { createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
          : {}),
      };

      const sendUpdates = ((args.notificationLevel as string | undefined) === 'ALL') ? 'all'
        : ((args.notificationLevel as string | undefined) === 'EXTERNAL_ONLY') ? 'externalOnly'
        : 'none';

      const res = await calendar.events.insert({
        calendarId: (args.calendarId as string) ?? 'primary',
        sendUpdates,
        ...((args.addGoogleMeetUrl as boolean) === true ? { conferenceDataVersion: 1 } : {}),
        requestBody,
      });
      return `Event created: ${res.data.htmlLink}`;
    }

    case 'update_event': {
      const calId = (args.calendarId as string) ?? 'primary';
      const existing = await calendar.events.get({ calendarId: calId, eventId: args.eventId as string });
      const e = existing.data;

      const allDay = (args.allDay as boolean) === true;
      const tz = args.timeZone as string | undefined;
      const start = args.start
        ? (allDay
            ? { date: args.start as string }
            : { dateTime: args.start as string, ...(tz ? { timeZone: tz } : {}) })
        : e.start;
      const end = args.end
        ? (allDay
            ? { date: args.end as string }
            : { dateTime: args.end as string, ...(tz ? { timeZone: tz } : {}) })
        : e.end;

      const overrideReminders = args.overrideReminders as Array<{ method: string; minutes: number }> | undefined;

      const requestBody: Record<string, unknown> = {
        summary: (args.summary as string) ?? e.summary,
        description: (args.description as string) ?? e.description,
        location: (args.location as string) ?? e.location,
        start,
        end,
        attendees: args.attendees ? (args.attendees as string[]).map(email => ({ email })) : e.attendees,
        colorId: (args.colorId as string) ?? e.colorId,
        visibility: (args.visibility as string) ?? e.visibility,
        recurrence: (args.recurrenceData as string[] | undefined) ?? e.recurrence,
        ...(overrideReminders ? { reminders: { useDefault: false, overrides: overrideReminders } } : {}),
      };

      const sendUpdates = ((args.notificationLevel as string | undefined) === 'ALL') ? 'all'
        : ((args.notificationLevel as string | undefined) === 'EXTERNAL_ONLY') ? 'externalOnly'
        : 'none';

      const res = await calendar.events.update({
        calendarId: calId,
        eventId: args.eventId as string,
        sendUpdates,
        requestBody,
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

    // ---------- Notion ----------

    case 'notion_search': {
      const body: any = {};
      if (args.query !== undefined) body.query = args.query;
      if (args.filterType) body.filter = { property: 'object', value: args.filterType };
      if (args.sortLastEditedDesc !== false) body.sort = { direction: 'descending', timestamp: 'last_edited_time' };
      const maxResults = (args.maxResults as number) ?? 50;
      body.page_size = Math.min(100, maxResults);
      const results = await notionPaginate('POST', '/search', account as NotionAccount | undefined, body, Math.ceil(maxResults / 100));
      const trimmed = results.slice(0, maxResults);
      if (!trimmed.length) return 'No Notion pages/databases found.';
      return trimmed.map((r: any) => {
        const title = extractNotionTitle(r);
        return `[${r.object}] ${title}\n  id: ${r.id}\n  url: ${r.url}\n  last_edited: ${r.last_edited_time}`;
      }).join('\n---\n');
    }

    case 'notion_fetch_page': {
      const pageId = args.pageId as string;
      const page: any = await notionFetch('GET', `/pages/${pageId}`, account as NotionAccount | undefined);
      const lines = [
        `PAGE ${pageId}`,
        `Title: ${extractNotionTitle(page)}`,
        `URL: ${page.url}`,
        `Created: ${page.created_time}`,
        `Last edited: ${page.last_edited_time}`,
        `Archived: ${page.archived}`,
      ];
      if (Object.keys(page.properties ?? {}).length) {
        lines.push('', 'Properties:');
        for (const [k, v] of Object.entries(page.properties as any)) {
          lines.push(`  ${k}: ${stringifyNotionProperty(v as any)}`);
        }
      }
      if (args.includeBlocks !== false) {
        lines.push('', 'Content:');
        const maxDepth = (args.maxDepth as number) ?? 3;
        const text = await fetchBlocksRecursive(pageId, account as NotionAccount | undefined, maxDepth, 0);
        lines.push(text);
      }
      return lines.join('\n');
    }

    case 'notion_create_page': {
      const body: any = { parent: args.parent };
      if (args.properties) body.properties = args.properties;
      if (args.children) body.children = args.children;
      if (args.icon) body.icon = args.icon;
      if (args.cover) body.cover = args.cover;
      const res: any = await notionFetch('POST', '/pages', account as NotionAccount | undefined, body);
      return `Created page ${res.id}\nURL: ${res.url}\nTitle: ${extractNotionTitle(res)}`;
    }

    case 'notion_update_page': {
      const pageId = args.pageId as string;
      const body: any = {};
      if (args.properties) body.properties = args.properties;
      if (args.icon) body.icon = args.icon;
      if (args.cover) body.cover = args.cover;
      if (args.archived !== undefined) body.archived = args.archived;
      const res: any = await notionFetch('PATCH', `/pages/${pageId}`, account as NotionAccount | undefined, body);
      return `Updated page ${res.id}\nURL: ${res.url}\nArchived: ${res.archived}`;
    }

    case 'notion_get_block_children': {
      const blockId = args.blockId as string;
      const maxResults = (args.maxResults as number) ?? 100;
      const path = `/blocks/${blockId}/children?page_size=${Math.min(100, maxResults)}`;
      const results = await notionPaginate('GET', path, account as NotionAccount | undefined, undefined, Math.ceil(maxResults / 100));
      const trimmed = results.slice(0, maxResults);
      if (!trimmed.length) return 'No child blocks.';
      return trimmed.map((b: any) => `[${b.type}] ${b.id}\n  ${stringifyBlockSummary(b)}`).join('\n---\n');
    }

    case 'notion_append_blocks': {
      const blockId = args.blockId as string;
      const body: any = { children: args.children };
      if (args.after) body.after = args.after;
      const res: any = await notionFetch('PATCH', `/blocks/${blockId}/children`, account as NotionAccount | undefined, body);
      return `Appended ${(res.results ?? []).length} block(s) to ${blockId}`;
    }

    case 'notion_update_block': {
      const blockId = args.blockId as string;
      const res: any = await notionFetch('PATCH', `/blocks/${blockId}`, account as NotionAccount | undefined, args.block);
      return `Updated block ${res.id} (${res.type})`;
    }

    case 'notion_delete_block': {
      const blockId = args.blockId as string;
      const res: any = await notionFetch('DELETE', `/blocks/${blockId}`, account as NotionAccount | undefined);
      return `Deleted block ${res.id ?? blockId}`;
    }

    case 'notion_query_database': {
      const databaseId = args.databaseId as string;
      const body: any = {};
      if (args.filter) body.filter = args.filter;
      if (args.sorts) body.sorts = args.sorts;
      const maxResults = (args.maxResults as number) ?? 100;
      body.page_size = Math.min(100, maxResults);
      const results = await notionPaginate('POST', `/databases/${databaseId}/query`, account as NotionAccount | undefined, body, Math.ceil(maxResults / 100));
      const trimmed = results.slice(0, maxResults);
      if (!trimmed.length) return 'No rows match.';
      return trimmed.map((p: any) => {
        const props = Object.entries(p.properties ?? {})
          .map(([k, v]: [string, any]) => `  ${k}: ${stringifyNotionProperty(v)}`)
          .join('\n');
        return `id: ${p.id}\nurl: ${p.url}\n${props}`;
      }).join('\n---\n');
    }

    case 'notion_create_database': {
      const body: any = {
        parent: args.parent,
        title: args.title,
        properties: args.properties,
      };
      if (args.icon) body.icon = args.icon;
      if (args.isInline !== undefined) body.is_inline = args.isInline;
      const res: any = await notionFetch('POST', '/databases', account as NotionAccount | undefined, body);
      return `Created database ${res.id}\nURL: ${res.url}`;
    }

    case 'notion_update_database': {
      const databaseId = args.databaseId as string;
      const body: any = {};
      if (args.title) body.title = args.title;
      if (args.description) body.description = args.description;
      if (args.properties) body.properties = args.properties;
      const res: any = await notionFetch('PATCH', `/databases/${databaseId}`, account as NotionAccount | undefined, body);
      return `Updated database ${res.id}`;
    }

    case 'notion_get_comments': {
      const blockId = args.blockId as string;
      const maxResults = (args.maxResults as number) ?? 100;
      const path = `/comments?block_id=${blockId}&page_size=${Math.min(100, maxResults)}`;
      const results = await notionPaginate('GET', path, account as NotionAccount | undefined, undefined, Math.ceil(maxResults / 100));
      const trimmed = results.slice(0, maxResults);
      if (!trimmed.length) return 'No comments.';
      return trimmed.map((c: any) => {
        const text = (c.rich_text ?? []).map((rt: any) => rt.plain_text ?? '').join('');
        return `id: ${c.id}\ncreated: ${c.created_time}\nby: ${c.created_by?.id ?? '?'}\ntext: ${text}`;
      }).join('\n---\n');
    }

    case 'notion_create_comment': {
      const body: any = { rich_text: args.richText };
      if (args.parent) body.parent = args.parent;
      if (args.discussionId) body.discussion_id = args.discussionId;
      const res: any = await notionFetch('POST', '/comments', account as NotionAccount | undefined, body);
      return `Created comment ${res.id}`;
    }

    case 'notion_get_users': {
      const maxResults = (args.maxResults as number) ?? 50;
      const path = `/users?page_size=${Math.min(100, maxResults)}`;
      const results = await notionPaginate('GET', path, account as NotionAccount | undefined, undefined, Math.ceil(maxResults / 100));
      const trimmed = results.slice(0, maxResults);
      if (!trimmed.length) return 'No users found.';
      return trimmed.map((u: any) => {
        const kind = u.type === 'bot' ? '[bot]' : '[user]';
        return `${kind} ${u.name ?? '(no name)'}\n  id: ${u.id}\n  email: ${u.person?.email ?? '-'}`;
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
        serverInfo: { name: 'productivity-mcp-server', version: '2.0.0' },
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

      // Hard timeout to guarantee response within bounded time — prevents Claude Code tmux hangs
      // when Google API stalls. If exceeded, JSON-RPC error returns instead of infinite wait.
      const TOOL_TIMEOUT_MS = parseInt(process.env.MCP_TOOL_TIMEOUT_MS ?? '25000', 10);
      const startedAt = Date.now();

      const text = await Promise.race([
        callTool(toolName, toolArgs),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool '${toolName}' exceeded ${TOOL_TIMEOUT_MS}ms timeout — call aborted to avoid client hang. Try again or check Google API status.`)),
            TOOL_TIMEOUT_MS
          )
        ),
      ]);

      const duration = Date.now() - startedAt;
      if (duration > 10000) {
        console.warn(`SLOW-TOOL: '${toolName}' took ${duration}ms (acc=${(toolArgs.account as string) ?? 'business'})`);
      }

      return res.json(jsonrpc(id, { content: [{ type: 'text', text }] }));
    }

    return res.json(jsonrpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('MCP error:', message);
    return res.json(jsonrpcError(id, -32000, message));
  }
}

export type NotionAccount = 'personal' | 'business';

const NOTION_VERSION = '2022-06-28';
const NOTION_BASE = 'https://api.notion.com/v1';
const HTTP_TIMEOUT_MS = parseInt(process.env.MCP_NOTION_HTTP_TIMEOUT_MS ?? '20000', 10);

function resolveToken(account?: NotionAccount): string | undefined {
  if (account === 'business') return process.env.NOTION_TOKEN_BUSINESS;
  // Default + 'personal' both resolve to personal (user's primary workspace).
  return process.env.NOTION_TOKEN_PERSONAL;
}

export class NotionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(`Notion ${status} ${code}: ${message}`);
  }
}

export async function notionFetch<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  account?: NotionAccount,
  body?: unknown
): Promise<T> {
  const token = resolveToken(account);
  if (!token) {
    throw new Error(
      `Notion token not configured for account=${account ?? 'personal'}. ` +
      `Set NOTION_TOKEN_${(account ?? 'personal').toUpperCase()} in Vercel env.`
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${NOTION_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error(`Notion API timeout after ${HTTP_TIMEOUT_MS}ms on ${method} ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }

  if (!res.ok) {
    throw new NotionError(res.status, parsed?.code ?? 'unknown', parsed?.message ?? text);
  }
  return parsed as T;
}

/**
 * Fetch all pages of a paginated list response (cursor-based).
 * Notion returns { results, has_more, next_cursor } on /search, /databases/:id/query, /blocks/:id/children, /comments.
 */
export async function notionPaginate<T = any>(
  method: 'GET' | 'POST',
  path: string,
  account?: NotionAccount,
  body?: any,
  maxPages: number = 10
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const reqBody = method === 'POST' ? { ...(body ?? {}), start_cursor: cursor } : undefined;
    const sep = method === 'GET' ? (path.includes('?') ? '&' : '?') : '';
    const reqPath = method === 'GET' && cursor ? `${path}${sep}start_cursor=${cursor}` : path;
    const res: any = await notionFetch(method, reqPath, account, reqBody);
    all.push(...(res.results ?? []));
    cursor = res.has_more ? res.next_cursor : undefined;
    pages++;
  } while (cursor && pages < maxPages);
  return all;
}

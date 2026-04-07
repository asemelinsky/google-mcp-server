import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../lib/mcp-server.js';

interface SessionState {
  transport: StreamableHTTPServerTransport;
  getToken: () => string | undefined;
  setToken: (token: string) => void;
}

const sessions = new Map<string, SessionState>();

function authError(res: VercelResponse) {
  res.status(401).json({ error: 'Unauthorized' });
}

function validateBearer(req: VercelRequest): boolean {
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${process.env.MCP_SECRET_TOKEN}`) return true;
  const queryToken = req.query['token'] as string | undefined;
  return queryToken === process.env.MCP_SECRET_TOKEN;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!validateBearer(req)) return authError(res);

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    let state: SessionState;

    if (sessionId && sessions.has(sessionId)) {
      state = sessions.get(sessionId)!;
    } else {
      let sessionToken: string | undefined;
      const getToken = () => sessionToken;
      const setToken = (t: string) => { sessionToken = t; };

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => { sessions.set(id, state); },
      });

      state = { transport, getToken, setToken };
      const server = createMcpServer(getToken, setToken);
      await server.connect(transport);
    }

    await state.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === 'GET') {
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Missing or unknown session ID' });
      return;
    }
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../lib/mcp-server.js';

const sessions = new Map<string, StreamableHTTPServerTransport>();

function authError(res: VercelResponse) {
  res.status(401).json({ error: 'Unauthorized' });
}

function validateBearer(req: VercelRequest): boolean {
  // Accept token via Authorization header OR ?token= query param
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${process.env.MCP_SECRET_TOKEN}`) return true;
  const queryToken = req.query['token'] as string | undefined;
  return queryToken === process.env.MCP_SECRET_TOKEN;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!validateBearer(req)) return authError(res);

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => { sessions.set(id, transport); },
      });
      const server = createMcpServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === 'GET') {
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Missing or unknown session ID' });
      return;
    }
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

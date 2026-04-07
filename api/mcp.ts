import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../lib/mcp-server.js';

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

  if (!validateBearer(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.method === 'POST') {
    // Stateless: create a fresh server+transport for every request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

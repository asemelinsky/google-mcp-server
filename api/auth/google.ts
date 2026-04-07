import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createOAuth2Client, SCOPES } from '../../lib/google-client.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const auth = createOAuth2Client();
  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
}

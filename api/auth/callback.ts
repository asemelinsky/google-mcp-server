import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createOAuth2Client } from '../../lib/google-client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  const auth = createOAuth2Client();
  const { tokens } = await auth.getToken(code);

  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    res.status(400).send('No refresh_token received. Make sure you passed prompt=consent and access_type=offline.');
    return;
  }

  res.status(200).send(`
    <html><body style="font-family:monospace;padding:2rem">
      <h2>✅ OAuth success!</h2>
      <p>Copy this refresh token and add it to Vercel env as <b>GOOGLE_REFRESH_TOKEN</b>, then redeploy:</p>
      <pre style="background:#f4f4f4;padding:1rem;word-break:break-all">${refreshToken}</pre>
      <p>After redeploying, you can close this page.</p>
    </body></html>
  `);
}

import { google } from 'googleapis';

export type GoogleAccount = 'personal' | 'business';

/**
 * Resolve refresh token for a given account name.
 * - 'personal' → GOOGLE_REFRESH_TOKEN_PERSONAL (a.semelinsky@gmail.com)
 * - 'business' → GOOGLE_REFRESH_TOKEN_BUSINESS (o.semelinksy@j127group.com)
 * - undefined  → legacy GOOGLE_REFRESH_TOKEN (currently business)
 */
function resolveToken(account?: GoogleAccount): string | undefined {
  if (account === 'personal') return process.env.GOOGLE_REFRESH_TOKEN_PERSONAL;
  if (account === 'business') return process.env.GOOGLE_REFRESH_TOKEN_BUSINESS ?? process.env.GOOGLE_REFRESH_TOKEN;
  return process.env.GOOGLE_REFRESH_TOKEN;
}

export function createOAuth2Client(accountOrToken?: GoogleAccount | string, explicitToken?: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    'https://google-mcp-server-sigma.vercel.app/api/auth/callback'
  );

  // Backwards-compat: createOAuth2Client(refreshToken) — single arg starting with "1//" treated as token
  let token: string | undefined;
  if (explicitToken) {
    token = explicitToken;
  } else if (accountOrToken === 'personal' || accountOrToken === 'business') {
    token = resolveToken(accountOrToken);
  } else if (typeof accountOrToken === 'string' && accountOrToken.length > 20) {
    // Legacy: passed as refresh_token directly (e.g. authorize tool)
    token = accountOrToken;
  } else {
    token = resolveToken();
  }

  if (token) {
    client.setCredentials({ refresh_token: token });
  }

  return client;
}

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts.readonly',
];

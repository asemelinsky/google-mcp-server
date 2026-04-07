import { google } from 'googleapis';

export function createOAuth2Client(refreshToken?: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    'https://google-mcp-server-sigma.vercel.app/api/auth/callback'
  );

  const token = refreshToken ?? process.env.GOOGLE_REFRESH_TOKEN;
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

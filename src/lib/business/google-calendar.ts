/**
 * Google Calendar integration module.
 *
 * TODO: Configure OAuth client ID and secret in environment variables:
 *   GOOGLE_CALENDAR_CLIENT_ID=<your-client-id>
 *   GOOGLE_CALENDAR_CLIENT_SECRET=<your-client-secret>
 *   GOOGLE_CALENDAR_REDIRECT_URI=<your-redirect-uri>  (e.g. https://yourapp.com/api/businesses/[id]/calendar/callback)
 *
 * TODO: Create a google_calendar_tokens table or add columns to businesses for storing:
 *   - access_token
 *   - refresh_token
 *   - token_expiry
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface CalendarEvent {
  id?: string;
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  all_day?: boolean;
}

/**
 * Generate a Google OAuth consent URL for calendar access.
 *
 * TODO: Store the state parameter (businessId) in a session or DB for CSRF protection.
 */
export function generateAuthUrl(businessId: string): string {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('Google Calendar OAuth is not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_REDIRECT_URI.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state: businessId,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for tokens and store them.
 *
 * TODO: Store the tokens in the database (google_calendar_tokens or similar table).
 */
export async function handleCallback(
  code: string,
  _businessId: string
): Promise<{ access_token: string; refresh_token?: string }> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google Calendar OAuth is not configured.');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokens = await response.json();

  // TODO: Store tokens in database keyed by businessId
  // await supabase.from('google_calendar_tokens').upsert({
  //   business_id: businessId,
  //   access_token: tokens.access_token,
  //   refresh_token: tokens.refresh_token,
  //   expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  // });

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
}

/**
 * Sync events from Google Calendar to the local database.
 *
 * TODO: Implement token refresh when access_token is expired.
 * TODO: Map Google Calendar events to local calendar_events format.
 */
export async function syncEvents(
  _businessId: string
): Promise<CalendarEvent[]> {
  // TODO: Retrieve stored access_token for this business
  // const { data: tokenRow } = await supabase
  //   .from('google_calendar_tokens')
  //   .select('access_token, refresh_token, expires_at')
  //   .eq('business_id', businessId)
  //   .single();

  // TODO: Refresh token if expired

  // TODO: Fetch events from Google Calendar API
  // const response = await fetch(
  //   `${GOOGLE_CALENDAR_API}/calendars/primary/events?maxResults=250&singleEvents=true&orderBy=startTime`,
  //   { headers: { Authorization: `Bearer ${tokenRow.access_token}` } }
  // );

  // TODO: Parse and return events
  return [];
}

/**
 * Push a local event to Google Calendar.
 *
 * TODO: Implement token retrieval and refresh.
 * TODO: Create event via Google Calendar API and store the external_event_id.
 */
export async function pushEvent(
  _businessId: string,
  _event: CalendarEvent
): Promise<string | null> {
  // TODO: Retrieve access_token
  // TODO: POST to Google Calendar API
  // const response = await fetch(
  //   `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
  //   {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${accessToken}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       summary: event.title,
  //       description: event.description,
  //       start: event.all_day
  //         ? { date: event.start_at.slice(0, 10) }
  //         : { dateTime: event.start_at },
  //       end: event.end_at
  //         ? event.all_day
  //           ? { date: event.end_at.slice(0, 10) }
  //           : { dateTime: event.end_at }
  //         : undefined,
  //     }),
  //   }
  // );
  // const data = await response.json();
  // return data.id; // external_event_id

  return null;
}

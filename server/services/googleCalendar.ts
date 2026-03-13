import { google } from 'googleapis';

/**
 * Inicializa o cliente da Google Calendar API com OAuth 2.0
 * Requer as variáveis de ambiente:
 * - GOOGLE_CALENDAR_CLIENT_ID
 * - GOOGLE_CALENDAR_CLIENT_SECRET
 * - GOOGLE_CALENDAR_REDIRECT_URI
 * - GOOGLE_CALENDAR_REFRESH_TOKEN (obtido após primeira autenticação)
 */

export async function createGoogleCalendarEvent(
  eventTitle: string,
  eventDescription: string,
  startDateTime: Date,
  endDateTime: Date,
  attendeeEmail: string
) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CALENDAR_CLIENT_ID,
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      process.env.GOOGLE_CALENDAR_REDIRECT_URI
    );

    // Define o refresh token para obter um novo access token
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: eventTitle,
      description: eventDescription,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'America/Sao_Paulo', // Ajuste conforme necessário
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      attendees: [
        {
          email: attendeeEmail,
          displayName: attendeeEmail,
        },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 dia antes
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    return {
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink,
    };
  } catch (error) {
    console.error('[Google Calendar] Error creating event:', error);
    throw new Error('Failed to create Google Calendar event');
  }
}

/**
 * Função para gerar a URL de autorização do Google
 * O usuário deve acessar essa URL para conceder permissão
 */
export function getGoogleAuthUrl() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI
  );

  const scopes = ['https://www.googleapis.com/auth/calendar'];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });

  return authUrl;
}

/**
 * Função para trocar o código de autorização por um refresh token
 * Deve ser chamada após o usuário autorizar a aplicação
 */
export async function getRefreshToken(authCode: string) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CALENDAR_CLIENT_ID,
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      process.env.GOOGLE_CALENDAR_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(authCode);
    return tokens.refresh_token;
  } catch (error) {
    console.error('[Google Calendar] Error getting refresh token:', error);
    throw new Error('Failed to get refresh token');
  }
}

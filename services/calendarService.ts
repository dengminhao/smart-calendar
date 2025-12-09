
// Global types for Google Identity Services
declare global {
  interface Window {
    google: any;
  }
}

const SCOPES = 'https://www.googleapis.com/auth/calendar'; // Updated scope to allow managing calendars

export class CalendarService {
  private tokenClient: any;
  private accessToken: string | null = null;

  constructor() {
    // If env var is present at build time, try to init immediately
    if (process.env.GOOGLE_CLIENT_ID) {
      this.initializeGis(process.env.GOOGLE_CLIENT_ID);
    }
  }

  public initializeGis(clientId: string) {
    if (!window.google) {
      console.warn("Google Identity Services script not loaded yet.");
      return;
    }
    
    try {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.error !== undefined) {
            console.error("GIS Error:", resp);
            throw resp;
          }
          this.accessToken = resp.access_token;
        },
      });
    } catch (e) {
      console.error("Failed to initialize Token Client", e);
      throw e;
    }
  }

  public async requestAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) {
        reject('Google Client ID not set or GIS not initialized.');
        return;
      }
      
      this.tokenClient.callback = (resp: any) => {
        if (resp.error) {
          reject(resp);
        } else {
          this.accessToken = resp.access_token;
          resolve();
        }
      };

      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // --- Helpers ---

  private formatTime(timeStr: string) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(timeStr);
    
    if (isDateOnly) {
      return { date: timeStr };
    }
    
    return {
      dateTime: timeStr,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}) {
    if (!this.accessToken) throw new Error("Not authenticated");
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 404) throw new Error('404 Not Found');
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API Error: ${response.statusText}`);
    }
    
    return response.json();
  }

  // --- Calendar Management ---

  public async listCalendars(): Promise<any[]> {
    const data = await this.fetchWithAuth('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    return data.items || [];
  }

  public async createSecondaryCalendar(summary: string): Promise<any> {
    return this.fetchWithAuth('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary })
    });
  }

  // --- Event Operations ---

  public async listEvents(calendarId: string = 'primary', timeMin: string, timeMax: string): Promise<any[]> {
    const params = new URLSearchParams({
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const data = await this.fetchWithAuth(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
    return data.items || [];
  }

  public async createEvent(calendarId: string = 'primary', event: any): Promise<any> {
    const resource = {
      summary: event.summary,
      location: event.location,
      description: event.description,
      start: this.formatTime(event.startTime),
      end: this.formatTime(event.endTime),
    };

    return this.fetchWithAuth(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(resource)
    });
  }

  public async updateEvent(calendarId: string = 'primary', eventId: string, event: any): Promise<any> {
     const resource: any = {
       summary: event.summary,
       description: event.description,
       location: event.location,
     };

     if (event.startTime) resource.start = this.formatTime(event.startTime);
     if (event.endTime) resource.end = this.formatTime(event.endTime);

     return this.fetchWithAuth(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
       method: 'PATCH',
       body: JSON.stringify(resource)
     });
  }

  public async moveEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<any> {
    const params = new URLSearchParams({
      destination: destinationCalendarId
    });
    
    return this.fetchWithAuth(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?${params.toString()}`,
      { method: 'POST' }
    );
  }

  // --- Utility Methods (No Auth Required) ---

  public generateCalendarUrl(event: any): string {
    const formatTime = (isoString: string) => {
      // Remove punctuation for Google Calendar format: YYYYMMDDTHHMMSSZ
      return isoString.replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    };

    const start = new Date(event.startTime).toISOString();
    const end = new Date(event.endTime).toISOString();
    
    const dates = `${formatTime(start)}/${formatTime(end)}`;
    
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.summary,
      dates: dates,
      details: (event.description || '') + '\n\n(Created via Smart Calendar Sync)',
    });

    if (event.location) {
      params.append('location', event.location);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
}

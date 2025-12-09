
// Global types for Google Identity Services
declare global {
  interface Window {
    google: any;
  }
}

const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

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

  /**
   * Google Calendar API requires:
   * - 'date' field for all-day events (YYYY-MM-DD)
   * - 'dateTime' field for timed events (ISO)
   * They cannot be mixed.
   */
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

  // --- API Methods (Authenticated via fetch) ---

  public async listEvents(timeMin: string, timeMax: string): Promise<any[]> {
    if (!this.accessToken) throw new Error("Not authenticated");

    const params = new URLSearchParams({
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to list events');
    }

    const data = await response.json();
    return data.items || [];
  }

  public async createEvent(event: any): Promise<any> {
    if (!this.accessToken) throw new Error("Not authenticated");
    
    const resource = {
      summary: event.summary,
      location: event.location,
      description: event.description,
      start: this.formatTime(event.startTime),
      end: this.formatTime(event.endTime),
    };

    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resource)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to create event');
    }
    
    return await response.json();
  }

  public async updateEvent(eventId: string, event: any): Promise<any> {
    if (!this.accessToken) throw new Error("Not authenticated");

     const resource: any = {
       summary: event.summary,
       description: event.description,
       location: event.location,
     };

     if (event.startTime) resource.start = this.formatTime(event.startTime);
     if (event.endTime) resource.end = this.formatTime(event.endTime);

     const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
       method: 'PATCH',
       headers: {
         'Authorization': `Bearer ${this.accessToken}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify(resource)
     });

     if (!response.ok) {
       if (response.status === 404) {
         throw new Error('404 Not Found');
       }
       const errorData = await response.json();
       throw new Error(errorData.error?.message || 'Failed to update event');
     }

     return await response.json();
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

// Global types for Google APIs
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

export class CalendarService {
  private tokenClient: any;
  private gapiInited = false;
  private gisInited = false;
  private accessToken: string | null = null;

  constructor() {
    this.initializeGapi();
    // If env var is present at build time, try to init immediately
    if (process.env.GOOGLE_CLIENT_ID) {
      this.initializeGis(process.env.GOOGLE_CLIENT_ID);
    }
  }

  private initializeGapi() {
    if(!window.gapi) return;
    window.gapi.load('client', async () => {
      await window.gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
      });
      this.gapiInited = true;
    });
  }

  public initializeGis(clientId: string) {
    if(!window.google) {
      console.warn("Google Identity Services script not loaded yet.");
      return;
    }
    
    try {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.error !== undefined) {
            throw resp;
          }
          this.accessToken = resp.access_token;
        },
      });
      this.gisInited = true;
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
      
      // Override callback to resolve promise
      this.tokenClient.callback = (resp: any) => {
        if (resp.error) {
          reject(resp);
        } else {
          this.accessToken = resp.access_token;
          resolve();
        }
      };

      if (window.gapi.client.getToken() === null) {
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        this.tokenClient.requestAccessToken({ prompt: '' });
      }
    });
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // --- API Methods (Authenticated) ---

  public async createEvent(event: any): Promise<any> {
    if (!this.accessToken) throw new Error("Not authenticated");
    
    // Ensure gapi client is set with token
    window.gapi.client.setToken({ access_token: this.accessToken });

    const resource = {
      summary: event.summary,
      location: event.location,
      description: event.description,
      start: {
        dateTime: event.startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: event.endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    const response = await window.gapi.client.calendar.events.insert({
      'calendarId': 'primary',
      'resource': resource,
    });
    
    return response.result;
  }

  public async updateEvent(eventId: string, event: any): Promise<any> {
    if (!this.accessToken) throw new Error("Not authenticated");

     window.gapi.client.setToken({ access_token: this.accessToken });

     const resource: any = {
       summary: event.summary,
       description: event.description,
     };

     if (event.location) resource.location = event.location;
     
     if (event.startTime) {
       resource.start = {
         dateTime: event.startTime,
         timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
       };
     }
     if (event.endTime) {
       resource.end = {
         dateTime: event.endTime,
         timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
       };
     }

     const response = await window.gapi.client.calendar.events.patch({
       'calendarId': 'primary',
       'eventId': eventId,
       'resource': resource
     });

     return response.result;
  }

  // --- Utility Methods (No Auth Required) ---

  /**
   * Generates a Google Calendar Web Link (render URL).
   * Used when the user is not authenticated via OAuth.
   */
  public generateCalendarUrl(event: any): string {
    const formatTime = (isoString: string) => {
      // Remove punctuation for Google Calendar format: YYYYMMDDTHHMMSSZ
      return isoString.replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    };

    // Convert to UTC for the link to ensure timezone consistency
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

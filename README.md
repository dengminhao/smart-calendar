# Smart Calendar Sync

An intelligent assistant that parses IM messages to automatically create or update Google Calendar events.

## Environment Setup

You can configure the AI provider (Gemini or OpenAI) and API keys using a `.env.local` file in the root directory.

### `.env.local` Example

```ini
# --- Google Calendar Configuration ---
# Required for Google Calendar Sync
GOOGLE_CLIENT_ID=your-google-oauth-client-id

# --- AI Configuration ---

# Default Provider: 'GEMINI' or 'OPENAI'
# If not set, defaults to GEMINI
AI_PROVIDER=OPENAI

# --- Gemini Configuration ---
# Required if AI_PROVIDER is GEMINI
API_KEY=your-gemini-api-key
# Optional: Proxy for Gemini
# GEMINI_BASE_URL=https://your-proxy.com

# --- OpenAI Configuration ---
# Required if AI_PROVIDER is OPENAI
OPENAI_API_KEY=sk-your-openai-api-key
# Optional: Model (defaults to gpt-4o)
OPENAI_MODEL=gpt-4o
# Optional: Proxy for OpenAI
OPENAI_BASE_URL=https://api.openai.com
```

### Running Locally

1. `npm install`
2. Create `.env.local` with the above values.
3. `npm run dev`

### Switching Providers in UI

You can also switch providers dynamically in the web interface by clicking the **"Settings"** button in the top right corner. Configurations saved in the browser (LocalStorage) will override environment variables.

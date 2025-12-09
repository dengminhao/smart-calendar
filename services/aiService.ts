import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, LocalEventRecord, ActionType, CalendarEventData, AIConfig } from "../types";

const COMMON_SYSTEM_INSTRUCTION = `
You are a smart calendar assistant. 
Your job is to analyze incoming Instant Messenger (IM) texts and manage a calendar.

You have access to a list of "Existing Events" that you previously created.
When the user provides a message, you must decide to:
1. CREATE: If it's a new event not in the existing list.
2. UPDATE: If the message refers to an existing event (e.g., "Change the time for the meeting with Bob").
3. IGNORE: If the message is irrelevant to scheduling.

CRITICAL TIME & DATE RULES:
1.  **Format**: Return 'startTime' and 'endTime' as strictly ISO 8601 DateTime strings (YYYY-MM-DDTHH:mm:ss).
2.  **No UTC 'Z'**: Do NOT append 'Z' to the end. The system assumes local time. If you add 'Z', the time will be shifted wrong.
3.  **Duration**: If no duration is specified, assume 1 hour.
4.  **Consistency**: 'startTime' and 'endTime' MUST be the same format. Do not mix simple Date (YYYY-MM-DD) with DateTime. Always prefer DateTime.
5.  **Relative Dates**: Calculate specific dates based on the "Current Date/Time" provided in the prompt.

Rules for UPDATE:
- Look for semantic matches (similar titles, same participants) in the existing events list.
- Return the 'targetLocalId' of the event to update.
`;

// Schema description for OpenAI (since it doesn't use the strictly typed schema object of Gemini SDK)
const OPENAI_JSON_SCHEMA_PROMPT = `
You MUST respond with valid JSON strictly matching this structure:
{
  "actions": [
    {
      "type": "CREATE" | "UPDATE" | "IGNORE",
      "confidenceScore": number,
      "reasoning": string,
      "targetLocalId": string | null,
      "eventData": {
        "summary": string,
        "description": string,
        "location": string,
        "startTime": "YYYY-MM-DDTHH:mm:ss",
        "endTime": "YYYY-MM-DDTHH:mm:ss"
      } | null
    }
  ]
}
`;

// --- Gemini Implementation ---
const callGemini = async (prompt: string, config: AIConfig): Promise<GeminiResponse> => {
  const ai = new GoogleGenAI({ 
    apiKey: config.apiKey,
    baseUrl: config.baseUrl 
  });

  const response = await ai.models.generateContent({
    model: config.model || 'gemini-2.5-flash',
    contents: prompt,
    config: {
      systemInstruction: COMMON_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: [ActionType.CREATE, ActionType.UPDATE, ActionType.IGNORE] },
                confidenceScore: { type: Type.NUMBER },
                reasoning: { type: Type.STRING },
                targetLocalId: { type: Type.STRING, nullable: true },
                eventData: {
                  type: Type.OBJECT,
                  nullable: true,
                  properties: {
                    summary: { type: Type.STRING },
                    description: { type: Type.STRING },
                    location: { type: Type.STRING },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                  }
                }
              },
              required: ["type", "confidenceScore", "reasoning"]
            }
          }
        }
      }
    }
  });

  if (response.text) {
    return JSON.parse(response.text) as GeminiResponse;
  }
  throw new Error("Gemini returned empty response");
};

// --- OpenAI Implementation ---
const callOpenAI = async (prompt: string, config: AIConfig): Promise<GeminiResponse> => {
  const baseUrl = config.baseUrl ? config.baseUrl.replace(/\/$/, '') : 'https://api.openai.com';
  const url = `${baseUrl}/v1/chat/completions`;
  
  const systemMessage = `${COMMON_SYSTEM_INSTRUCTION}\n\n${OPENAI_JSON_SCHEMA_PROMPT}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API Error: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) throw new Error("OpenAI returned empty content");
  
  return JSON.parse(content) as GeminiResponse;
};


// --- Main Public Methods ---

export const analyzeMessage = async (
  message: string,
  existingEvents: LocalEventRecord[],
  config: AIConfig
): Promise<GeminiResponse> => {
  
  if (!config.apiKey) {
    throw new Error(`${config.provider} API Key is missing.`);
  }

  const now = new Date();
  const contextPrompt = `
    Current Date/Time (Local): ${now.toLocaleString()} 
    ISO Reference: ${now.toISOString()}
    
    User Message: "${message}"

    Existing Events Context (JSON):
    ${JSON.stringify(existingEvents, null, 2)}
  `;

  try {
    if (config.provider === 'OPENAI') {
      return await callOpenAI(contextPrompt, config);
    } else {
      return await callGemini(contextPrompt, config);
    }
  } catch (e) {
    console.error("AI Service Error", e);
    throw e;
  }
};

export const fixActionWithAI = async (
  failedEventData: CalendarEventData,
  errorMessage: string,
  config: AIConfig
): Promise<CalendarEventData> => {
  
  const prompt = `
    I tried to send this event data to Google Calendar API but it failed.
    
    My Data:
    ${JSON.stringify(failedEventData, null, 2)}
    
    The API Error:
    "${errorMessage}"
    
    Please correct the data structure to fix the error. 
    Often this is due to:
    1. Mixing Date (YYYY-MM-DD) and DateTime (ISO). Make them both ISO DateTime.
    2. Invalid Timezone offsets.
    3. Missing required fields.
    
    Return ONLY the corrected JSON object for the event data.
  `;

  let responseText = "";

  if (config.provider === 'OPENAI') {
    const baseUrl = config.baseUrl ? config.baseUrl.replace(/\/$/, '') : 'https://api.openai.com';
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o',
        messages: [
          { role: 'system', content: "You are a JSON fixer. Return strictly JSON." },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    responseText = data.choices[0]?.message?.content || "";
  } else {
    // Gemini
    const ai = new GoogleGenAI({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const result = await ai.models.generateContent({
      model: config.model || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            description: { type: Type.STRING },
            location: { type: Type.STRING },
            startTime: { type: Type.STRING },
            endTime: { type: Type.STRING },
          }
        }
      }
    });
    responseText = result.text || "";
  }

  if (responseText) {
    return JSON.parse(responseText) as CalendarEventData;
  }
  throw new Error("AI could not fix the error.");
};

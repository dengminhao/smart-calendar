import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, LocalEventRecord, ActionType, CalendarEventData } from "../types";

const SYSTEM_INSTRUCTION = `
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

export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
}

const getAIClient = (config?: GeminiConfig) => {
  const apiKey = config?.apiKey || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing.");
  }
  return new GoogleGenAI({ 
    apiKey: apiKey,
    baseUrl: config?.baseUrl 
  });
};

export const analyzeMessage = async (
  message: string,
  existingEvents: LocalEventRecord[],
  config?: GeminiConfig
): Promise<GeminiResponse> => {
  
  const ai = getAIClient(config);

  const now = new Date();
  const contextPrompt = `
    Current Date/Time (Local): ${now.toLocaleString()} 
    ISO Reference: ${now.toISOString()}
    
    User Message: "${message}"

    Existing Events Context (JSON):
    ${JSON.stringify(existingEvents, null, 2)}
  `;

  // Define strict schema for output
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: contextPrompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
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
    try {
      return JSON.parse(response.text) as GeminiResponse;
    } catch (e) {
      console.error("Failed to parse Gemini JSON", e);
      throw new Error("AI returned invalid JSON");
    }
  }
  
  throw new Error("No response from AI");
};

/**
 * Feeds an API error back to Gemini to ask for a corrected JSON payload.
 */
export const fixActionWithAI = async (
  failedEventData: CalendarEventData,
  errorMessage: string,
  config?: GeminiConfig
): Promise<CalendarEventData> => {
  const ai = getAIClient(config);

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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
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

  if (response.text) {
    return JSON.parse(response.text) as CalendarEventData;
  }
  throw new Error("AI could not fix the error.");
};
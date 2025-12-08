import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, LocalEventRecord, ActionType } from "../types";

const SYSTEM_INSTRUCTION = `
You are a smart calendar assistant. 
Your job is to analyze incoming Instant Messenger (IM) texts and manage a calendar.

You have access to a list of "Existing Events" that you previously created.
When the user provides a message, you must decide to:
1. CREATE: If it's a new event not in the existing list.
2. UPDATE: If the message refers to an existing event (e.g., "Change the time for the meeting with Bob").
3. IGNORE: If the message is irrelevant to scheduling.

Rules for UPDATE:
- Look for semantic matches (similar titles, same participants) in the existing events list.
- If the user says "Change the meeting on Friday to 2pm", find the Friday meeting in the list and target it.
- Return the 'targetLocalId' of the event to update.

Rules for Time:
- Parse relative dates (e.g., "tomorrow", "next friday") assuming the current date is provided in the prompt.
- Return ISO 8601 strings for start/end times.
- If no duration is specified, assume 1 hour.
`;

export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
}

export const analyzeMessage = async (
  message: string,
  existingEvents: LocalEventRecord[],
  config?: GeminiConfig
): Promise<GeminiResponse> => {
  
  // Use provided key, or fallback to env var
  const apiKey = config?.apiKey || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please set it in the code or environment.");
  }

  // Initialize SDK dynamically to support Base URL (Proxy) changes
  const ai = new GoogleGenAI({ 
    apiKey: apiKey,
    baseUrl: config?.baseUrl // Allows routing requests through a proxy
  });

  const now = new Date();
  const contextPrompt = `
    Current Date/Time: ${now.toISOString()} (${now.toLocaleDateString('en-US', { weekday: 'long' })})
    
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
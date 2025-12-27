
import { GoogleGenAI } from "@google/genai";

/**
 * Converts a Blob to a Base64 string.
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const analyzeAudio = async (audioBlob: Blob): Promise<{ transcription: string; summary: string }> => {
  try {
    const apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey === "") {
      throw new Error("API Key is missing. Please ensure your API key is configured.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const base64Audio = await blobToBase64(audioBlob);

    // Using gemini-2.5-flash for efficient audio processing
    const model = 'gemini-2.5-flash';

    const prompt = `
      You are an expert meeting secretary. 
      1. Transcribe the following audio meeting recording accurately. Identify different speakers if possible (e.g., Speaker 1, Speaker 2).
      2. Provide a concise bullet-point summary of the key discussion points and action items.
      
      Output Format:
      ## Transcription
      [Full transcription here]

      ## Summary
      [Summary here]
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: audioBlob.type || 'audio/webm',
              data: base64Audio
            }
          },
          {
            text: prompt
          }
        ]
      }
    });

    const text = response.text || "";
    
    const summaryIndex = text.indexOf("## Summary");
    
    let transcription = "";
    let summary = "";

    if (summaryIndex !== -1) {
      transcription = text.substring(0, summaryIndex).replace("## Transcription", "").trim();
      summary = text.substring(summaryIndex).replace("## Summary", "").trim();
    } else {
      transcription = text;
      summary = "Could not generate structured summary.";
    }

    return { transcription, summary };

  } catch (error) {
    console.error("Error analyzing audio with Gemini:", error);
    throw error;
  }
};

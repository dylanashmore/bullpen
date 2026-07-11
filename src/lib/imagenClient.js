import { GoogleGenAI, Modality } from '@google/genai';

// Switched from standalone Imagen (imagen-4.0-generate-001) to
// gemini-2.5-flash-image ("Nano Banana") — verified live that this account's
// Google AI plan can't call Imagen ("Imagen 3 is only available on paid
// plans"), while this model has a free-tier daily quota. Also sidesteps
// Imagen's own 2026-08-17 deprecation, since this was already its announced
// replacement. Goes through the same generateContent path as every other
// Gemini call in this codebase, just with image response modality enabled.
const IMAGE_MODEL = 'gemini-2.5-flash-image';

let client = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Generates an image from a prompt and returns it as a data: URI string,
// which is a plain string like any other step output.
export async function generateImage(prompt) {
  try {
    const response = await getClient().models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((part) => part.inlineData?.data);
    if (!imagePart) {
      throw new Error('gemini-2.5-flash-image returned no image data');
    }
    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  } catch (err) {
    throw new Error(`generateImage failed: ${err.message}`);
  }
}

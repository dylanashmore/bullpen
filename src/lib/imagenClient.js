import { GoogleGenAI } from '@google/genai';

// Standalone Imagen models (imagen-4.0-*) are on Google's deprecation path
// (shutdown announced for 2026-08-17) in favor of gemini-2.5-flash-image ("Nano
// Banana"). They're still live as of this build — swap IMAGEN_MODEL if that
// changes before the demo.
const IMAGEN_MODEL = 'imagen-4.0-generate-001';

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
    const response = await getClient().models.generateImages({
      model: IMAGEN_MODEL,
      prompt,
      config: {
        numberOfImages: 1,
      },
    });

    const generated = response.generatedImages?.[0];
    const imageBytes = generated?.image?.imageBytes;
    if (!imageBytes) {
      throw new Error('Imagen returned no image data');
    }
    return `data:image/png;base64,${imageBytes}`;
  } catch (err) {
    throw new Error(`generateImage failed: ${err.message}`);
  }
}

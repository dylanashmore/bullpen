import { runStyleEnrichmentPrompt } from './geminiClient.js';

// Runs once at agent creation (never per task). Always resolves to a string
// or null — a nonsense/unrecognized reference and an outright failure both
// fall back to null so this can never block or fail agent creation.
export async function enrichStyleReference(rawInput) {
  const trimmed = rawInput?.trim();
  if (!trimmed) return null;

  try {
    const result = await runStyleEnrichmentPrompt(trimmed);
    if (/^none\.?$/i.test(result)) return null;
    return result;
  } catch (err) {
    console.error(`styleReference enrichment failed for "${trimmed}", falling back to null:`, err.message);
    return null;
  }
}

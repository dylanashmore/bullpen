// gemini-2.5-* models were pulled from new API keys 2026-07-09 (ahead of their
// official 2026-10-16 shutdown) — confirmed live, they 404 on this project's
// key regardless of billing tier. Verified 2026-07-11 against a live key:
// gemini-flash-lite-latest, gemini-3.5-flash, and gemini-pro-latest all work
// for generateContent, so the picker's Lite/Flash/Pro tiers now map to three
// distinct ids (see frontend/src/App.jsx's geminiModels).
export const SUPPORTED_AGENT_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-pro-latest'];

export const DEFAULT_AGENT_MODEL = 'gemini-3.5-flash';

export function isSupportedAgentModel(model) {
  return SUPPORTED_AGENT_MODELS.includes(model);
}

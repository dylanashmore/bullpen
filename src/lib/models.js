// gemini-2.5-* models were pulled from new API keys 2026-07-09 (ahead of their
// official 2026-10-16 shutdown) — confirmed live, they 404 on this project's
// key regardless of billing tier. gemini-3.5-flash is the only model verified
// working here so far; the picker's Lite/Flash/Pro tiers are cosmetic for now
// (see frontend/src/App.jsx's geminiModels) until lite/pro variants are
// individually confirmed live and added here.
export const SUPPORTED_AGENT_MODELS = ['gemini-3.5-flash'];

export const DEFAULT_AGENT_MODEL = 'gemini-3.5-flash';

export function isSupportedAgentModel(model) {
  return SUPPORTED_AGENT_MODELS.includes(model);
}

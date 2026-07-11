export const SUPPORTED_AGENT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

export const DEFAULT_AGENT_MODEL = 'gemini-2.5-flash';

export function isSupportedAgentModel(model) {
  return SUPPORTED_AGENT_MODELS.includes(model);
}

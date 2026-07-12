export const EXECUTION_MODES = ['fast', 'thorough'];
export const DEFAULT_EXECUTION_MODE = 'fast';

export function isExecutionMode(value) {
  return EXECUTION_MODES.includes(value);
}

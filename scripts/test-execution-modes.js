import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../src/app.js';
import { getTextAgentPhaseCount } from '../src/orchestrator.js';
import { shouldUseWebAccess } from '../src/lib/geminiClient.js';

assert.equal(getTextAgentPhaseCount('fast'), 1);
assert.equal(getTextAgentPhaseCount('thorough'), 2);
assert.equal(getTextAgentPhaseCount('unknown'), 1);

const writingAgent = { role: 'Writes product copy', directive: '', specialty: 'Writing' };
assert.equal(shouldUseWebAccess(writingAgent, 'Write a welcome email', 'fast'), false);
assert.equal(shouldUseWebAccess(writingAgent, 'Summarize current market research with sources', 'fast'), true);
assert.equal(shouldUseWebAccess(writingAgent, 'Write a welcome email', 'thorough'), true);

const server = app.listen(0);
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const invalid = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'test', executionMode: 'turbo' }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /executionMode/);

  const valid = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'test', executionMode: 'thorough' }),
  });
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).executionMode, 'thorough');

  const form = new FormData();
  form.append('input', 'multipart test');
  form.append('executionMode', 'fast');
  const multipart = await fetch(`${baseUrl}/api/tasks`, { method: 'POST', body: form });
  assert.equal(multipart.status, 201);
  assert.equal((await multipart.json()).executionMode, 'fast');
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

console.log('Execution mode tests passed');

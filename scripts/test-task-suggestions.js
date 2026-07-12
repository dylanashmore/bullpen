import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../src/app.js';
import { buildTaskSuggestionContext } from '../src/lib/taskSuggestions.js';

const context = buildTaskSuggestionContext({
  profile: { description: 'A coffee roastery', goal: 'Grow online sales', term: 'long' },
  agents: [{ id: 'writer', name: 'Writer', specialty: 'Copy', role: 'Writes campaigns', context: 'Warm voice' }],
  tasks: [
    { input: 'Launch email', status: 'working', steps: [] },
    { input: 'Product page', status: 'done', steps: [{ agentId: 'writer', output: 'Finished copy' }] },
    { input: 'Poster', status: 'done', steps: [{ agentId: 'writer', output: 'data:image/png;base64,large-payload' }] },
    { input: 'Failed work', status: 'error', steps: [] },
  ],
});

assert.equal(context.business.goal, 'Grow online sales');
assert.deepEqual(context.activeTasks.map((task) => task.input), ['Launch email']);
assert.deepEqual(context.completedTasks.map((task) => task.input), ['Product page', 'Poster']);
assert.equal(context.completedTasks[1].outcomes[0].output, '[Generated image]');
assert.equal(JSON.stringify(context).includes('large-payload'), false);

const server = app.listen(0);
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const emptySuggestions = await fetch(`${baseUrl}/api/tasks/suggestions`, { method: 'POST' });
  assert.equal(emptySuggestions.status, 400);

  const invalidProfile = await fetch(`${baseUrl}/api/workspace`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: '', goal: 'Grow', term: 'long' }),
  });
  assert.equal(invalidProfile.status, 400);

  const savedProfile = await fetch(`${baseUrl}/api/workspace`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'A coffee roastery', goal: 'Grow online sales', term: 'long' }),
  });
  assert.equal(savedProfile.status, 200);
  assert.equal((await savedProfile.json()).profile.goal, 'Grow online sales');

  const loadedProfile = await fetch(`${baseUrl}/api/workspace`);
  assert.equal(loadedProfile.status, 200);
  assert.equal((await loadedProfile.json()).profile.description, 'A coffee roastery');
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

console.log('Task suggestion tests passed');

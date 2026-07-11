// Exercises the running local server end to end. Start the server first
// (`npm run dev` or `npm start`), then in another terminal: `npm run test:api`.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function requestMultipart(method, path, fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('file', new Blob([file.content], { type: file.mimeType }), file.name);

  const res = await fetch(`${BASE_URL}${path}`, { method, body: form });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function summarizeTask(task) {
  const steps = task.steps
    .map((s) => `${s.agentId}:${s.status}${s.status === 'done' ? ` (${String(s.output).slice(0, 60)}...)` : ''}`)
    .join(', ');
  return `[${task.status}] ${task.input} -> ${steps || '(no steps yet)'}`;
}

async function pollUntilSettled(taskId, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body: tasks } = await request('GET', '/api/tasks');
    const task = tasks.find((t) => t.id === taskId);
    if (task && (task.status === 'done' || task.status === 'error')) return task;
    if (task) console.log('  polling:', summarizeTask(task));
    await sleep(intervalMs);
  }
  throw new Error(`Task ${taskId} did not settle within ${timeoutMs}ms`);
}

async function main() {
  console.log(`Testing against ${BASE_URL}\n`);

  console.log('1) GET /api/agents (fresh server — expect an empty roster, no seeded agents)');
  const listRes = await request('GET', '/api/agents');
  console.log('  status:', listRes.status, '- agents:', listRes.body.map((a) => a.id).join(', ') || '(none)');

  console.log('\n2) Build a roster from scratch: researcher, writer, designer -> writer, artist -> designer');
  await request('POST', '/api/agents', {
    name: 'Researcher',
    role: 'Gathers background facts, context, and key points on a topic so other agents can build on solid information.',
    inputType: 'topic',
    outputType: 'text',
    dependsOnAgent: null,
    tone: 'thorough and neutral',
    acceptsFiles: true,
  });
  await request('POST', '/api/agents', {
    name: 'Writer',
    role: 'Writes clear, well-structured prose (copy, posts, articles) from a topic.',
    inputType: 'topic',
    outputType: 'text',
    dependsOnAgent: null,
    tone: 'engaging and clear',
  });
  await request('POST', '/api/agents', {
    name: 'Designer',
    role: 'Turns written copy into a detailed visual design brief describing composition, style, mood, and color for an image.',
    inputType: 'agent_output',
    outputType: 'text',
    dependsOnAgent: 'writer',
    tone: 'visually descriptive',
  });
  await request('POST', '/api/agents', {
    name: 'Artist',
    role: 'Generates a final image from a visual design brief.',
    inputType: 'agent_output',
    outputType: 'image',
    dependsOnAgent: 'designer',
  });
  const rosterRes = await request('GET', '/api/agents');
  console.log('  status:', rosterRes.status, '- agents:', rosterRes.body.map((a) => a.id).join(', '));

  console.log('\n2b) POST /api/agents (create a standalone "critic" agent)');
  const createRes = await request('POST', '/api/agents', {
    name: 'Critic',
    role: 'Gives short, constructive feedback on a piece of writing.',
    inputType: 'agent_output',
    outputType: 'feedback',
    dependsOnAgent: null,
    tone: 'blunt but kind',
  });
  console.log('  status:', createRes.status, '- body:', createRes.body);

  console.log('\n2c) POST /api/agents with missing fields (should 400)');
  const badCreateRes = await request('POST', '/api/agents', { name: 'Incomplete' });
  console.log('  status:', badCreateRes.status, '- body:', badCreateRes.body);

  console.log('\n2d) POST /api/tasks with empty input (should 400)');
  const badTaskRes = await request('POST', '/api/tasks', { input: '   ' });
  console.log('  status:', badTaskRes.status, '- body:', badTaskRes.body);

  console.log('\n3) POST /api/tasks — single-agent task, targeted directly at "writer" via agentId');
  const singleRes = await request('POST', '/api/tasks', {
    input: 'Write a short, upbeat blog intro about the benefits of morning walks.',
    agentId: 'writer',
  });
  console.log('  status:', singleRes.status, '- created task:', singleRes.body.id);
  const singleDone = await pollUntilSettled(singleRes.body.id);
  console.log('  final:', summarizeTask(singleDone));

  console.log('\n4) POST /api/tasks — full media pipeline, targeted at "artist" (expect writer + designer pulled in automatically)');
  const pipelineRes = await request('POST', '/api/tasks', {
    input: 'Create a promotional image announcing the launch of a new energy drink brand called Volt.',
    agentId: 'artist',
  });
  console.log('  status:', pipelineRes.status, '- created task:', pipelineRes.body.id);
  const pipelineDone = await pollUntilSettled(pipelineRes.body.id, { timeoutMs: 90000 });
  console.log('  final:', summarizeTask(pipelineDone));

  console.log('\n5) POST /api/tasks — multipart with a file attached, targeted at "researcher" (which accepts files)');
  const fileNotes = 'Q3 field notes: adoption grew 18% MoM, churn dropped to 2.1%, top complaint was onboarding friction.';
  const fileRes = await requestMultipart(
    'POST',
    '/api/tasks',
    { input: 'Summarize the key takeaways from the attached notes file.', agentId: 'researcher' },
    { content: fileNotes, mimeType: 'text/plain', name: 'notes.txt' }
  );
  console.log('  status:', fileRes.status, '- created task:', fileRes.body.id, '- file:', fileRes.body.file);
  const fileDone = await pollUntilSettled(fileRes.body.id);
  console.log('  final:', summarizeTask(fileDone));

  console.log('\n6) POST /api/tasks — no agentId, let the orchestrator choose (expect it to pick "writer" or similar)');
  const autoRes = await request('POST', '/api/tasks', {
    input: 'Write two upbeat sentences about the benefits of morning walks.',
  });
  console.log('  status:', autoRes.status, '- created task:', autoRes.body.id);
  const autoDone = await pollUntilSettled(autoRes.body.id);
  console.log('  final:', summarizeTask(autoDone));

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});

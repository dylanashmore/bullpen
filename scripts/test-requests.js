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

  console.log('1) GET /api/agents (should list the 4 seeded default agents)');
  const listRes = await request('GET', '/api/agents');
  console.log('  status:', listRes.status, '- agents:', listRes.body.map((a) => a.id).join(', '));

  console.log('\n2) POST /api/agents (create a standalone "critic" agent)');
  const createRes = await request('POST', '/api/agents', {
    name: 'Critic',
    role: 'Gives short, constructive feedback on a piece of writing.',
    inputType: 'agent_output',
    outputType: 'feedback',
    dependsOnAgent: null,
    tone: 'blunt but kind',
  });
  console.log('  status:', createRes.status, '- body:', createRes.body);

  console.log('\n2b) POST /api/agents with missing fields (should 400)');
  const badCreateRes = await request('POST', '/api/agents', { name: 'Incomplete' });
  console.log('  status:', badCreateRes.status, '- body:', badCreateRes.body);

  console.log('\n2c) POST /api/tasks with empty input (should 400)');
  const badTaskRes = await request('POST', '/api/tasks', { input: '   ' });
  console.log('  status:', badTaskRes.status, '- body:', badTaskRes.body);

  console.log('\n3) POST /api/tasks — single-agent task (expect just "writer")');
  const singleRes = await request('POST', '/api/tasks', {
    input: 'Write a short, upbeat blog intro about the benefits of morning walks.',
  });
  console.log('  status:', singleRes.status, '- created task:', singleRes.body.id);
  const singleDone = await pollUntilSettled(singleRes.body.id);
  console.log('  final:', summarizeTask(singleDone));

  console.log('\n4) POST /api/tasks — full media pipeline (expect writer -> designer -> artist)');
  const pipelineRes = await request('POST', '/api/tasks', {
    input: 'Create a promotional image announcing the launch of a new energy drink brand called Volt.',
  });
  console.log('  status:', pipelineRes.status, '- created task:', pipelineRes.body.id);
  const pipelineDone = await pollUntilSettled(pipelineRes.body.id, { timeoutMs: 90000 });
  console.log('  final:', summarizeTask(pipelineDone));

  console.log('\n5) POST /api/tasks — multipart with a file attached (expect it to route to "researcher", which accepts files)');
  const fileNotes = 'Q3 field notes: adoption grew 18% MoM, churn dropped to 2.1%, top complaint was onboarding friction.';
  const fileRes = await requestMultipart(
    'POST',
    '/api/tasks',
    { input: 'Summarize the key takeaways from the attached notes file.' },
    { content: fileNotes, mimeType: 'text/plain', name: 'notes.txt' }
  );
  console.log('  status:', fileRes.status, '- created task:', fileRes.body.id, '- file:', fileRes.body.file);
  const fileDone = await pollUntilSettled(fileRes.body.id);
  console.log('  final:', summarizeTask(fileDone));

  console.log('\n6) POST /api/agents with a real, recognizable styleReference (expect it enriched, not raw/NONE/null)');
  const styledRes = await request('POST', '/api/agents', {
    name: 'Illustrator',
    role: 'Produces visual design briefs for the artist agent to render.',
    inputType: 'agent_output',
    outputType: 'text',
    styleReference: 'Studio Ghibli',
  });
  console.log('  status:', styledRes.status, '- styleReference:', styledRes.body.styleReference);
  if (styledRes.status !== 201 || !styledRes.body.styleReference || styledRes.body.styleReference === 'NONE') {
    console.warn('  WARNING: expected a non-null, non-"NONE" enriched styleReference');
  }

  console.log('\n7) POST /api/agents with nonsense styleReference (expect graceful fallback to null)');
  const nonsenseRes = await request('POST', '/api/agents', {
    name: 'Gibberish Agent',
    role: 'Just here to test the fallback path.',
    inputType: 'topic',
    outputType: 'text',
    styleReference: 'asdkjfh qpwoeiruq. z9x8c7v6, blorp the florp',
  });
  console.log('  status:', nonsenseRes.status, '- styleReference:', nonsenseRes.body.styleReference);
  if (nonsenseRes.status !== 201 || nonsenseRes.body.styleReference !== null) {
    console.warn('  WARNING: expected styleReference to fall back to null for nonsense input');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});

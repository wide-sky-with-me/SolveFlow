import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const script = resolve('scripts/test-verifier-regression.mjs');
it.each([undefined, 'detailed'] as const)('reviews a saved %s answer with its original presentation requirements', async answerMode => {
  const directory = await mkdtemp(join(tmpdir(), 'solveflow-verifier-mode-'));
  const expectedMode = answerMode ?? 'brief';
  try {
    await mkdir(join(directory, '.runtime'));
    await symlink(resolve('packages'), join(directory, 'packages'), 'dir');
    const image = Buffer.from([1, 2, 3]); // Synthetic transport only; no real image/model request.
    await writeFile(join(directory, '.runtime/question.jpg'), image);
    const profile = { provider: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 1024, maxTokensField: 'max_tokens' };
    const candidate = { schemaVersion: 1, kind: 'answer', problem: { text: 'x+1=3', subject: 'math', uncertainties: [] }, answer: 'x=2', steps: [], knowledgePoints: [], citationIds: [], clarificationQuestions: [] };
    await writeFile(join(directory, '.runtime/cases.json'), JSON.stringify({ profile, cases: [{ id: 'saved-answer', exam: 'general', imagePath: '.runtime/question.jpg', imageSha256: createHash('sha256').update(image).digest('hex'), candidate, expected: 'pass', provenance: 'Self-authored synthetic fixture', ...(answerMode ? { answerMode } : {}) }] }));
    const values: Record<string, string> = { SOLVEFLOW_LIVE_CALLS: 'true', SOLVEFLOW_LLM_PROVIDER: 'fixture', SOLVEFLOW_LLM_BASE_URL: profile.baseURL, SOLVEFLOW_LLM_API_KEY: 'synthetic', SOLVEFLOW_LLM_SUPPORTS_IMAGES: 'true', SOLVEFLOW_LLM_SUPPORTS_TOOLS: 'true' };
    for (const role of ['SOLVER', 'VERIFIER']) for (const [field, value] of Object.entries({ MODEL: profile.model, CONTEXT_WINDOW: '32768', MAX_OUTPUT_TOKENS: '2048', MAX_TOKENS: '1024', INPUT_RMB_PER_MTOK: '0', OUTPUT_RMB_PER_MTOK: '0' })) values[`SOLVEFLOW_${role}_${field}`] = value;
    await writeFile(join(directory, '.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));
    await writeFile(join(directory, 'provider.mjs'), `
      import { writeFileSync } from 'node:fs';
      globalThis.fetch = async (url, init) => {
        if (String(url) !== 'https://fixture.invalid/v1/chat/completions') throw new Error('REAL_NETWORK_REJECTED');
        const body = JSON.parse(init.body);
        const user = body.messages.findLast(message => message.role === 'user');
        const text = typeof user.content === 'string' ? user.content : user.content.find(part => part.type === 'text').text;
        const input = JSON.parse(text);
        writeFileSync('seen.json', JSON.stringify({ answerMode: input.answerMode, role: input.role }));
        const verification = input.answerMode === ${JSON.stringify(expectedMode)}
          ? { schemaVersion: 1, verdict: 'pass', checked: ['transcription', 'logic', 'diagram'], issues: [] }
          : { schemaVersion: 1, verdict: 'fail', checked: ['transcription'], issues: [{ code: 'INVALID_CANDIDATE', message: 'Wrong requirements for the saved answer mode.' }] };
        return Response.json({ id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(verification) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      };
    `);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SOLVEFLOW_') && key !== 'NODE_OPTIONS'));
    const result = await new Promise<{ code: number | null; output: string }>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', join(directory, 'provider.mjs'), script, '--cases=.runtime/cases.json', '--live'], { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => { clearTimeout(timeout); accept({ code, output }); });
    });
    expect(result.output).toContain('"passed":true');
    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(join(directory, 'seen.json'), 'utf8'))).toEqual({ answerMode: expectedMode, role: 'verifier' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

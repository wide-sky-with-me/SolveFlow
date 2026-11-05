import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.each([
    ['--suite=unknown', 'INVALID_MANAGED_EXAM_SUITE'],
    ['--image=postgres:latest', 'POSTGRES_17_TEST_IMAGE_REQUIRED'],
    ['--image=postgres:17;echo unsafe', 'POSTGRES_17_TEST_IMAGE_REQUIRED'],
])('rejects %s before any Docker command', async (argument, code) => {
    const folder = await mkdtemp(join(tmpdir(), 'solveflow-exam-runner-'));
    const marker = join(folder, 'docker-called');
    try {
        await writeFile(join(folder, 'docker'), '#!' + process.execPath + '\nimport("node:fs").then(fs=>fs.writeFileSync(' + JSON.stringify(marker) + ',"called"));\n', { mode: 0o700 });
        const result = spawnSync(process.execPath, ['scripts/test-managed-exams.mjs', argument], { encoding: 'utf8', env: { ...process.env, PATH: folder }, timeout: 5000 });
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(code);
        await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(folder, { recursive: true, force: true }); }
});

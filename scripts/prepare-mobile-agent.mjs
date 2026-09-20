import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../packages/agent/', import.meta.url);
// Explicit reviewed manifest; no cwd/HOME/AGENTS discovery or model-supplied paths.
const manifest = { exams: ['SKILL.md', 'references/sat.md', 'references/act.md', 'references/ap.md'], general: ['SKILL.md'], math: ['SKILL.md', 'references/algebra.md'], diagram: ['SKILL.md', 'references/example.md', 'references/economics.md'], economics: ['SKILL.md'], physics: ['SKILL.md', 'references/models.md'], chemistry: ['SKILL.md', 'references/stoichiometry.md'], biology: ['SKILL.md', 'references/genetics-and-experiments.md'] };
const files = {}; const skills = [];
for (const [name, paths] of Object.entries(manifest)) {
  for (const path of paths) {
    const content = await readFile(new URL(`resources/skills/${name}/${path}`, root), 'utf8');
    if (Buffer.byteLength(content) > 32 * 1024) throw new Error('SKILL_TOO_LARGE');
    files[`/skills/${name}/${path}`] = content;
    if (path === 'SKILL.md') { const description = /^description:\s*(.+)$/m.exec(content)?.[1]; if (!description) throw new Error('MISSING_SKILL_DESCRIPTION'); skills.push({ name, description, path: `/skills/${name}/SKILL.md` }); }
  }
}
const policy = {};
for (const name of ['SYSTEM', 'VERIFIER', 'CONTENT_POLICY']) policy[name] = await readFile(new URL(`resources/${name}.md`, root), 'utf8');
await writeFile(new URL('src/pi/mobile-resources.ts', root), `// Generated from reviewed student resources by scripts/prepare-mobile-agent.mjs.\nexport const resources: Readonly<Record<string, string>> = ${JSON.stringify(files)};\nexport const skills = ${JSON.stringify(skills)};\nexport const policies = ${JSON.stringify(policy)};\n`);
console.log('Prepared reviewed mobile skills and student policies.');

import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { policies, resources } from './mobile-resources.js';

// Compare with source, not readMobileSkill's copy of the same generated resource.
// This test never invokes the generator or modifies its output.
it.each(['exams/SKILL.md', 'exams/references/act.md', 'writing/SKILL.md', 'math/SKILL.md', 'general/SKILL.md'] as const)('embeds the current reviewed %s source without dropping content', async path => {
  const source = await readFile(new URL(`../../resources/skills/${path}`, import.meta.url), 'utf8');
  expect(resources[`/skills/${path}`]).toBe(source.replaceAll('/solveflow/skills/', '/skills/'));
});
it.each(['SYSTEM', 'VERIFIER', 'CONTENT_POLICY', 'ACT_TRANSCRIBER'] as const)('embeds the exact current student %s policy', async name => {
  const source = await readFile(new URL(`../../resources/${name}.md`, import.meta.url), 'utf8');
  expect(policies[name]).toBe(source);
});

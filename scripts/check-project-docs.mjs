import { readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Decision: .agents/notes/implemented/process/2026-10-03-documentation-management.md
// Decision: .agents/notes/implemented/process/2026-10-04-project-rule-ownership.md
const skipped = new Set(['node_modules', 'dist', 'build', '.expo', 'android', 'ios', '.runtime', '.git']);
const notePath = /^\.agents\/notes\/(proposed|implemented|archived)\/[a-z0-9-]+\/(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/;
const requiredSections = ['背景', '决定', '放弃的方案', '后果与限制', '验证'];
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const digest = text => createHash('sha256').update(text).digest('hex');

export function lengthUnits(text) {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  return (text.match(cjk) ?? []).length + (text.replace(cjk, ' ').match(/[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function withoutCode(text) {
  let fence;
  return text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return '';
    }
    if (marker) { fence = marker[1]; return ''; }
    return line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, '');
  }).join('\n');
}

export function headingAnchors(text) {
  const ids = new Set();
  const counts = new Map();
  // Keep inline-code heading text, but ignore fenced examples.
  const visible = withoutCode(text.replace(/^(#{1,6} .*)$/gm, line => line.replace(/`/g, '')));
  for (const match of visible.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '')
      .toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    let id = slug;
    let suffix = counts.get(slug) ?? 0;
    while (ids.has(id)) id = `${slug}-${++suffix}`;
    counts.set(slug, suffix); ids.add(id);
  }
  for (const match of visible.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(match[1]);
  return ids;
}

export function markdownLinks(text) {
  const visible = withoutCode(text);
  const definitions = new Map();
  const links = [];
  const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const body = visible.replace(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:[^\n]*)$/gm, (_, id, bracket, bare) => {
    definitions.set(normalize(id), bracket ?? bare); return '';
  });
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^()\s]|\([^()\n]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) links.push(match[1] ?? match[2]);
  const missing = [];
  for (const match of body.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
    const key = normalize(match[2] || match[1]);
    if (definitions.has(key)) links.push(definitions.get(key));
    else if (match[2] !== undefined) missing.push(key);
  }
  return { links: [...new Set(links)], missing };
}

function classify(file) {
  if (file === 'AGENTS.md') return 'rootRules';
  if (path.basename(file) === 'AGENTS.md') return 'rules';
  if (path.basename(file) === 'README.md') return 'readme';
  if (file === '.github/pull_request_template.md') return 'document';
  if (file === 'docs/architecture.md') return 'architecture';
  if (notePath.test(file)) return 'note';
  if (/^docs\/postmortem\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(file)) return 'report';
  if (/^docs\/(?:[a-z][a-z0-9-]*|(?:subsystems|cookbook)\/[a-z][a-z0-9-]*)\.md$/.test(file)) return 'document';
  return undefined;
}

export async function checkProjectDocs(root, policy) {
  root = await realpath(root);
  const errors = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.entrypoints) || !Array.isArray(policy.scanRoots)
      || (policy.sourceFiles !== undefined && !Array.isArray(policy.sourceFiles))
      || !policy.budgets || !policy.frozen || typeof policy.frozen !== 'object' || Array.isArray(policy.frozen)) {
    throw new Error('Invalid docs policy');
  }
  for (const name of ['rootRules', 'rules', 'readme', 'architecture', 'document', 'note', 'report']) {
    if (!Number.isSafeInteger(policy.budgets[name]) || policy.budgets[name] <= 0) throw new Error(`Invalid budget: ${name}`);
  }
  const safeRelative = file => typeof file === 'string' && !!file && !file.includes('\\') && !path.isAbsolute(file)
    && path.posix.normalize(file) === file && file !== '..' && !file.startsWith('../');
  const sourceFiles = policy.sourceFiles ?? [];
  for (const file of [...policy.entrypoints, ...policy.scanRoots, ...sourceFiles, ...Object.keys(policy.frozen)]) {
    if (!safeRelative(file)) throw new Error('Policy contains an unsafe path');
  }
  for (const [file, hash] of Object.entries(policy.frozen)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || !(file.startsWith('docs/') || file.startsWith('.agents/notes/archived/'))) throw new Error(`Invalid frozen entry: ${file}`);
  }
  const documents = new Set(policy.entrypoints);
  const sources = new Set(sourceFiles);
  async function walk(relative, allMarkdown) {
    const directory = path.join(root, relative);
    try {
      if (!inside(root, await realpath(directory))) { fail(relative, 'Directory escapes repository'); return; }
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (skipped.has(item.name)) continue;
        const file = `${relative}/${item.name}`;
        if (item.isSymbolicLink()) { fail(file, 'Symlinks are not allowed in managed trees'); continue; }
        if (item.isDirectory()) await walk(file, allMarkdown);
        else if (item.isFile()) {
          if (item.name.endsWith('.md') && (allMarkdown || item.name === 'AGENTS.md')) documents.add(file);
          if (/\.(?:[cm]?[jt]sx?|kt|py|ya?ml)$/.test(item.name) && !allMarkdown) sources.add(file);
        }
      }
    } catch (error) { fail(relative, `Cannot scan directory (${error.code ?? 'I/O'})`); }
  }
  await walk('docs', true); await walk('.agents/notes', true);
  for (const relative of policy.scanRoots) await walk(relative, false);
  for (const file of Object.keys(policy.frozen)) documents.add(file);
  async function readSafe(file) {
    const absolute = path.resolve(root, file);
    if (!inside(root, absolute) || !inside(root, await realpath(absolute))) throw new Error('Path escapes repository');
    return readFile(absolute, 'utf8');
  }
  async function checkLink(file, target) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return;
    try {
      const hash = target.indexOf('#');
      const fragment = hash >= 0 ? decodeURIComponent(target.slice(hash + 1)) : '';
      const rawPath = decodeURIComponent((hash >= 0 ? target.slice(0, hash) : target).split('?')[0]);
      const absolute = rawPath ? path.resolve(rawPath.startsWith('/') ? root : path.dirname(path.join(root, file)), rawPath.replace(/^\//, '')) : path.join(root, file);
      if (!inside(root, absolute) || !inside(root, await realpath(absolute))) throw new Error('Target escapes repository');
      if (fragment && absolute.endsWith('.md') && !headingAnchors(await readFile(absolute, 'utf8')).has(fragment)) throw new Error('Missing heading');
    } catch (error) { fail(file, `Broken local link ${target} (${error.code ?? error.message})`); }
  }
  let current = 0; let frozen = 0; let notes = 0;
  for (const file of [...documents].sort()) {
    try {
      const text = await readSafe(file);
      if (policy.frozen[file]) {
        frozen++;
        if (digest(text) !== policy.frozen[file]) fail(file, 'Frozen document changed; add a successor instead');
        continue;
      }
      current++;
      const kind = classify(file);
      if (!kind) { fail(file, 'Document has no current home; use subsystems/cookbook/postmortem/notes'); continue; }
      if (file.startsWith('.agents/notes/')) {
        if (/\/index\.md$/i.test(file)) fail(file, 'Global notes indexes are forbidden');
        if (kind === 'note') {
          notes++;
          const [, status, date] = notePath.exec(file);
          if (status === 'archived') fail(file, 'Archived note must have a reviewed frozen hash');
          const parsedDate = new Date(`${date}T00:00:00Z`);
          if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) fail(file, 'Invalid note date');
          const metadata = /^日期：(\d{4}-\d{2}-\d{2})。状态：(proposed|implemented|archived)。/.exec(text.split(/\r?\n/, 3)[2] ?? '');
          if (!metadata) fail(file, 'Missing or invalid note metadata on the third line');
          else {
            if (metadata[1] !== date) fail(file, 'Note date must agree with its path');
            if (metadata[2] !== status) fail(file, 'Note status must agree with its path');
          }
          const body = withoutCode(text);
          for (const section of requiredSections) if (!new RegExp(`^## ${section}\\s*$`, 'm').test(body)) fail(file, `Missing note section: ${section}`);
        } else if (!['.agents/notes/README.md', '.agents/notes/AGENTS.md'].includes(file) && path.basename(file) !== 'AGENTS.md') fail(file, 'Notes need a dated topic path');
      }
      const units = lengthUnits(text);
      if (units > policy.budgets[kind]) fail(file, `Length ${units} exceeds ${policy.budgets[kind]} ${kind} units`);
      const { links, missing } = markdownLinks(text);
      for (const id of missing) fail(file, `Missing link reference: ${id}`);
      for (const target of links) await checkLink(file, target);
    } catch (error) { fail(file, `Cannot validate document (${error.code ?? error.message})`); }
  }
  let anchors = 0;
  for (const file of [...sources].sort()) {
    let source;
    try { source = await readSafe(file); }
    catch (error) { fail(file, `Cannot validate source (${error.code ?? error.message})`); continue; }
    for (const match of source.matchAll(/^\s*(?:\/\/|\*|#)\s*Decision:\s*(\S+)/gm)) {
      anchors++;
      const target = match[1];
      if (!notePath.test(target) || !target.startsWith('.agents/notes/implemented/')) { fail(file, `Invalid decision anchor: ${target}`); continue; }
      await checkLink(file, `/${target}`);
      try {
        const note = await readSafe(target);
        const backlink = markdownLinks(note).links.some(link => !/^[a-z]+:/i.test(link) && path.resolve(root, path.dirname(target), link.split('#')[0]) === path.resolve(root, file));
        if (!backlink) fail(file, `Decision note needs a source backlink: ${target}`);
      } catch { /* Missing target already reported by checkLink. */ }
    }
  }
  return { errors, current, frozen, notes, anchors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const policy = JSON.parse(await readFile(path.join(root, 'scripts/docs-policy.json'), 'utf8'));
    const result = await checkProjectDocs(root, policy);
    if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
    else console.log(`Docs OK: ${result.current} current, ${result.notes} decisions, ${result.anchors} source anchors, ${result.frozen} frozen documents.`);
  } catch (error) { console.error(`Docs policy failed: ${error.message}`); process.exitCode = 1; }
}

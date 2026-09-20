import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url));
const metadata = JSON.parse(await readFile(resolve(root, 'metadata.json'), 'utf8'));
for (const platform of ['android', 'ios']) {
  const entry = metadata.fileMetadata[platform]; assert.ok(entry.bundle.endsWith('.hbc'));
  assert.ok((await stat(resolve(root, entry.bundle))).size > 0);
  assert.ok(entry.assets.some(asset => asset.ext === 'html'), `${platform} must include its local answer document`);
  for (const asset of entry.assets) assert.ok((await stat(resolve(root, asset.path))).size > 0);
}
const documents = ['index.html', ...metadata.fileMetadata.ios.assets.filter(asset => asset.ext === 'html').map(asset => asset.path)];
let fonts = false;
for (const document of documents) {
  const html = await readFile(resolve(root, document), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    assert.ok(!/^(?:https?:)?\/\//.test(match[1]), 'Application assets must be local');
    const target = resolve(match[1].startsWith('/') ? root : dirname(resolve(root, document)), match[1].replace(/^\//, ''));
    assert.ok(target.startsWith(resolve(root) + sep)); assert.ok((await stat(target)).size > 0);
    if (target.endsWith('.css')) {
      const css = await readFile(target, 'utf8');
      assert.ok(!/url\(["']?(?:fonts\/|https?:\/\/)/.test(css), 'Fonts must be bundled');
      if (css.includes('data:font/woff2;base64,')) fonts = true;
    }
  }
}
assert.ok(fonts, 'KaTeX fonts must be included');
console.log('RN Web, Android/iOS Hermes and local answer/font assets verified; no native binary was built.');

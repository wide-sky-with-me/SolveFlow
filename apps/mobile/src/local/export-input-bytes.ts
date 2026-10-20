// Decision: .agents/notes/implemented/storage/2026-10-16-export-input-byte-accounting.md
const encodedCharacter = /[\u0000-\u001f"\\\u0080-\uffff]/;

export function exportInputBytes(value: unknown): number {
  // Keep proofs local and bounded; repeated images still contribute every byte.
  const safeAscii = new Set<string>();
  let omitted = 0;
  const metadata = JSON.stringify(value, (_key, item: unknown) => {
    // Plain ASCII needs one byte per character and no JSON escaping.
    if (typeof item === 'string' && item.length >= 4096 && (safeAscii.has(item) || !encodedCharacter.test(item))) {
      if (safeAscii.size < 64) safeAscii.add(item);
      omitted += item.length;
      return '';
    }
    return item;
  });
  return omitted + new TextEncoder().encode(metadata).byteLength;
}

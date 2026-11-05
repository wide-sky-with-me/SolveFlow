/** getRandomValues also works on HTTP; never substitute predictable randomness. */
// Decision: .agents/notes/implemented/architecture/2026-11-05-http-ip-trial.md
export function newRequestId(): string {
    const random = globalThis.crypto;
    if (typeof random?.randomUUID === 'function') return random.randomUUID();
    if (typeof random?.getRandomValues !== 'function')
        throw new Error('浏览器不支持安全随机数，请更新浏览器后重试。');
    const bytes = random.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (byte, index) => {
        const value = index === 6 ? (byte & 15) | 64 : index === 8 ? (byte & 63) | 128 : byte;
        return value.toString(16).padStart(2, '0');
    }).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

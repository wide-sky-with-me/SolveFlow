const keys = new Map<string, string>();
export async function readKey(role: string) { return keys.get(role) ?? null; }
export async function writeKey(role: string, key: string | null) { if (key) keys.set(role, key); else keys.delete(role); }

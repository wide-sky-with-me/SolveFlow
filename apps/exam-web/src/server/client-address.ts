// Decision: .agents/notes/implemented/architecture/2026-11-03-exam-review-hardening.md
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

function subnet(value: string) {
    const [address, bits, extra] = value.split('/');
    if (!address || extra !== undefined) return null;
    const version = isIP(address);
    if (!version) return null;
    const maximum = version === 4 ? 32 : 128;
    if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return null;
    const prefix = bits === undefined ? maximum : Number(bits);
    if (prefix > maximum) return null;
    return { address, prefix, type: version === 4 ? 'ipv4' as const : 'ipv6' as const };
}

export const TrustedProxyCidrSchema = z.string().min(1).max(64).refine(value => subnet(value) !== null, 'Invalid trusted proxy CIDR');

/** Walk from the socket peer; arbitrary client-supplied forwarding headers confer no trust. */
export function clientAddressResolver(cidrs: readonly string[] = []) {
    const trusted = new BlockList();
    for (const value of cidrs) {
        const rule = subnet(TrustedProxyCidrSchema.parse(value));
        if (rule) trusted.addSubnet(rule.address, rule.prefix, rule.type);
    }
    const isTrusted = (address: string) => {
        const version = isIP(address);
        return version !== 0 && trusted.check(address, version === 4 ? 'ipv4' : 'ipv6');
    };
    return (peer: string | undefined, forwarded: string | undefined) => {
        if (!peer) return 'unknown';
        if (!isTrusted(peer) || !forwarded || forwarded.length > 1024) return peer;
        const chain = forwarded.split(',').map(value => value.trim());
        if (chain.length > 16 || chain.some(address => !isIP(address))) return peer;
        let address = peer;
        for (let index = chain.length - 1; index >= 0 && isTrusted(address); index--) {
            const next = chain[index];
            if (next) address = next;
        }
        return address;
    };
}

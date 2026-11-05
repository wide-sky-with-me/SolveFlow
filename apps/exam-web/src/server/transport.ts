import { isIP } from 'node:net';
// Decision: .agents/notes/implemented/architecture/2026-11-05-http-ip-trial.md

export function examTransport(value: string, insecureHttpTrial = false) {
    const origin = new URL(value);
    if (origin.origin !== value || origin.username || origin.password)
        throw new Error('CANONICAL_ORIGIN_REQUIRED');
    if (insecureHttpTrial) {
        const port = Number(origin.port);
        if (origin.protocol !== 'http:' || isIP(origin.hostname) !== 4 || !Number.isInteger(port) || port < 1024 || port > 65535)
            throw new Error('HTTP_TRIAL_REQUIRES_IPV4_AND_HIGH_PORT');
        return { secure: false, cookieName: 'solveflow_exam_http_trial' };
    }
    if (origin.protocol === 'https:') return { secure: true, cookieName: 'solveflow_exam' };
    if (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))
        return { secure: false, cookieName: 'solveflow_exam' };
    throw new Error('HTTPS_OR_LOOPBACK_REQUIRED');
}

export function examOrigins(origin: string, insecureHttpTrial = false, aliases: readonly string[] = []) {
    examTransport(origin, insecureHttpTrial);
    if (aliases.length > 2 || aliases.length && !insecureHttpTrial)
        throw new Error('HTTP_ALIASES_REQUIRE_TRIAL_MODE');
    const primary = new URL(origin);
    for (const value of aliases) {
        const alias = new URL(value);
        if (alias.origin !== value || alias.username || alias.password || alias.protocol !== 'http:' || (alias.port && alias.port !== primary.port) || alias.hostname.includes('*'))
            throw new Error('HTTP_ALIAS_REQUIRES_EXACT_ORIGIN_AND_ALLOWED_PORT');
    }
    return [...new Set([origin, ...aliases])];
}

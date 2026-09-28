export function releaseApiOrigin(value: string | undefined): string;
export function androidRequirements(root: string, catalog: string): { packages: string[]; missing: string[] };
export function latestVersionedApk(names: string[]): string | null;
export function verifySigningContinuity(current: string, previous: string | null): boolean;

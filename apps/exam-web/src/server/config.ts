import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { WebStoredModelsSchema } from '@solveflow/contracts/local';
import { TrustedProxyCidrSchema } from './client-address.js';
import { examTransport, examOrigins } from './transport.js';
const storage = z.discriminatedUnion('type', [z.strictObject({ type: z.literal('s3'), endpoint: z.url(), region: z.string().min(1), bucket: z.string().min(3), accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) }), z.strictObject({ type: z.literal('local'), root: z.string().min(1) })]);
export const ExamConfigSchema = z.strictObject({ schemaVersion: z.literal(1), origin: z.url(), insecureHttpTrial: z.boolean().default(false), httpTrialAliases: z.array(z.url()).max(2).default([]), trustedProxyCidrs: z.array(TrustedProxyCidrSchema).max(32).default([]), databaseUrl: z.url(), redisUrl: z.url().optional(), storage, models: WebStoredModelsSchema.optional(), secondaryModels: WebStoredModelsSchema.optional(), modelSettingsKey: z.string().regex(/^[a-f0-9]{64}$/i).optional(), allowedModelOrigins: z.array(z.url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&url.origin===value;})).max(16).default([]), liveCalls: z.boolean().default(false), solverConcurrency: z.number().int().min(1).max(64).default(8), verifierConcurrency: z.number().int().min(1).max(64).default(8), dailyCallsPerStudent: z.number().int().min(1).max(10000).default(1000), bootstrap: z.strictObject({ username: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/), displayName: z.string().min(1).max(80), password: z.string().min(12).max(128) }).optional() });
export async function loadExamConfig() { const file = process.env.SOLVEFLOW_EXAM_CONFIG; if (!file)
    throw new Error('EXAM_CONFIG_REQUIRED'); const metadata = await stat(file); if ((metadata.mode & 0o077) !== 0)
    throw new Error('EXAM_CONFIG_MUST_BE_0600'); const config = ExamConfigSchema.parse(JSON.parse(await readFile(file, 'utf8'))); if(new URL(config.databaseUrl).protocol!=='postgresql:'&&new URL(config.databaseUrl).protocol!=='postgres:')throw new Error('POSTGRES_URL_REQUIRED');
    if(config.bootstrap?.password.startsWith('REPLACE_')||config.databaseUrl.includes('REPLACE_'))throw new Error('PRIVATE_VALUES_REQUIRED');
    const transport = examTransport(config.origin, config.insecureHttpTrial);
    examOrigins(config.origin, config.insecureHttpTrial, config.httpTrialAliases);
    if (config.storage.type === 'local' && (transport.secure || config.insecureHttpTrial))
    throw new Error('PRODUCTION_REQUIRES_PRIVATE_S3'); if (config.storage.type === 's3' && new URL(config.storage.endpoint).protocol !== 'https:')
    throw new Error('PRIVATE_S3_REQUIRES_HTTPS'); for (const profile of Object.values(config.models?.models ?? {}))
    if (profile && !profile.baseURL.startsWith('https:'))
        throw new Error('MODELS_REQUIRE_HTTPS'); return config; }

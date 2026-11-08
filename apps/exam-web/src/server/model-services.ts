// Decision: .agents/notes/implemented/architecture/2026-11-06-managed-model-services.md
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { WebStoredModelsSchema, type LocalModelProfile } from '@solveflow/contracts/local';
import { ExamModelServiceAdminSchema, ExamModelServiceSelectionSchema, ExamServiceModelsSchema, type ExamModelServiceCode, type ExamModelServiceRef, type ExamModelServiceUpdate, ExamModelServiceCheckSchema } from '@solveflow/contracts/exam-model-services';
import type { ExamUser } from '@solveflow/contracts/managed-exam';
import { ExamError, conflict, forbidden, initializeModelServices, isAdmin, modelServiceVersion, modelServiceVersions, preferredModelService, saveModelService, selectModelService, userModelService, type StoredModelService } from '@solveflow/db';

type StoredModels = z.infer<typeof WebStoredModelsSchema>;
const roles = ['solver', 'verifier', 'backup'] as const;
type Role = typeof roles[number];
const unavailable = () => new ExamError(503, 'MODEL_SERVICE_UNAVAILABLE', '服务配置暂不可用，请联系管理员。');
function sameDestination(a: LocalModelProfile | null | undefined, b: LocalModelProfile) { return a?.baseURL === b.baseURL && a.provider === b.provider; }

/** Shared by API/worker processes through immutable, encrypted database versions. */
export class ModelServices {
    private readonly key: Buffer;
    private readonly origins: Set<string>;
    private readonly checks = new Set<string>();
    constructor(private readonly pool: Pool, key: string, private readonly legacy?: StoredModels, private readonly backup?: StoredModels, origins: string[] = [], private readonly fetcher: typeof fetch = fetch) {
        if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('MODEL_SETTINGS_KEY_REQUIRED');
        this.key = Buffer.from(key, 'hex');
        this.origins = new Set(['https://api.apiyi.com', 'https://b.apiyi.com', ...origins]);
        for (const source of [legacy, backup]) for (const profile of Object.values(source?.models ?? {})) if (profile) this.origins.add(new URL(profile.baseURL).origin);
    }
    private seal(ref: ExamModelServiceRef, value: StoredModels) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(ref.code + ':' + ref.version));
        const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
        return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
    }
    private open(row: StoredModelService): StoredModels | null {
        if (!row.ciphertext) return null;
        try {
            const parts = row.ciphertext.split('.');
            if (parts.length !== 4 || parts[0] !== 'v1' || !parts[1] || !parts[2] || !parts[3]) throw unavailable();
            const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(parts[1], 'base64'));
            decipher.setAAD(Buffer.from(row.code + ':' + row.version)); decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
            const value: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8'));
            const stored = WebStoredModelsSchema.parse(value); ExamServiceModelsSchema.parse(stored.models); return stored;
        } catch { throw unavailable(); }
    }
    private checkProfile(profile: LocalModelProfile) {
        if (!this.origins.has(new URL(profile.baseURL).origin)) throw new ExamError(400, 'MODEL_ORIGIN', '该服务地址尚未获准，请使用已批准的供应商地址。');
    }
    readonly network: typeof fetch = async (url, init) => {
        const target = new URL(url instanceof Request ? url.url : url);
        if (target.protocol !== 'https:' || !this.origins.has(target.origin) || target.username || target.password) throw new Error('MODEL_ORIGIN_NOT_ALLOWED');
        return this.fetcher(url, { ...init, redirect: 'error' });
    };
    async initialize() {
        const seeds: StoredModelService[] = [];
        for (const code of ['primary', 'backup'] as const) {
            const source = code === 'primary' ? this.legacy : this.backup;
            if (source) ExamServiceModelsSchema.parse(source.models);
            seeds.push({ code, version: 1, name: code === 'primary' ? '主服务' : '备用服务', enabled: !!source, ciphertext: source ? this.seal({code,version:1}, source) : null });
        }
        await initializeModelServices(this.pool, seeds);
        // A lost/wrong master key must fail startup rather than accept jobs that cannot be decoded.
        for (const row of await modelServiceVersions(this.pool)) if (row.ciphertext) this.open(row);
    }
    async selection(user: ExamUser) {
        if (user.state !== 'active' || !user.roles.includes('student')) throw forbidden();
        const [choice, versions] = await Promise.all([userModelService(this.pool,user.id), modelServiceVersions(this.pool)]);
        return ExamModelServiceSelectionSchema.parse({ selected:choice.code,version:choice.version,services:versions.map(row=>({code:row.code,name:row.name,available:row.enabled && !!row.ciphertext})) });
    }
    async select(user: ExamUser, code: ExamModelServiceCode, expectedVersion: number) {
        await selectModelService(this.pool,user,code,expectedVersion); return this.selection(user);
    }
    async capture(userId: string) { return preferredModelService(this.pool,userId); }
    async resolve(ref: ExamModelServiceRef | null | undefined) {
        if (!ref) { if (!this.legacy) throw unavailable(); return this.legacy; }
        const stored = this.open(await modelServiceVersion(this.pool,ref));
        if (!stored) throw unavailable();
        for (const profile of Object.values(stored.models)) if (profile) this.checkProfile(profile);
        return stored;
    }
    private admin(row: StoredModelService) {
        const source = this.open(row);
        return ExamModelServiceAdminSchema.parse({ code:row.code,name:row.name,enabled:row.enabled,version:row.version,models:source?.models ?? null,hasKeys:{solver:!!source?.keys.solver,verifier:!!source?.keys.verifier,backup:!!source?.keys.backup} });
    }
    async list(user: ExamUser) { if (!isAdmin(user)) throw forbidden(); return (await modelServiceVersions(this.pool)).map(row=>this.admin(row)); }
    private async current(code: ExamModelServiceCode, expectedVersion: number) {
        const row = (await modelServiceVersions(this.pool)).find(row=>row.code===code);
        if (!row) throw unavailable();
        if (row.version !== expectedVersion) throw conflict('服务配置已更新，请重新读取后再操作。');
        return row;
    }
    async update(user: ExamUser, code: ExamModelServiceCode, input: ExamModelServiceUpdate) {
        if (!isAdmin(user)) throw forbidden();
        const old = this.open(await this.current(code,input.expectedVersion));
        const ref = {code,version:input.expectedVersion+1};
        let source: StoredModels | null = null;
        if (input.models) {
            const keys: StoredModels['keys'] = {solver:null,verifier:null,backup:null};
            for (const role of roles) {
                const profile = input.models[role]; if (!profile) continue;
                this.checkProfile(profile);
                keys[role] = input.keys[role] ?? (sameDestination(old?.models[role], profile) ? old?.keys[role] ?? null : null);
                if (!keys[role]) throw new ExamError(400, 'MODEL_KEY_REQUIRED', '更换服务地址或供应商时，请填写对应的新 API Key。');
            }
            source = WebStoredModelsSchema.parse({schemaVersion:1,models:input.models,keys});
        } else if (roles.some(role=>input.keys[role])) throw new ExamError(400, 'MODEL_PROFILE_REQUIRED', '请先填写模型配置。');
        const row = await saveModelService(this.pool,user,input.expectedVersion,{...ref,name:input.name,enabled:input.enabled,ciphertext:source?this.seal(ref,source):null});
        return this.admin(row);
    }
    /** Metadata-only connectivity check: never submits a prompt or incurs inference usage. */
    async check(user: ExamUser, code: ExamModelServiceCode, input: z.infer<typeof ExamModelServiceCheckSchema>) {
        if (!isAdmin(user)) throw forbidden();
        if (this.checks.size >= 16 || this.checks.has(user.id)) throw new ExamError(429,'MODEL_CHECK_BUSY','正在检查连接，请稍后重试。');
        const source = this.open(await this.current(code,input.expectedVersion));
        this.checkProfile(input.profile);
        const key = input.key ?? (sameDestination(source?.models[input.role],input.profile) ? source?.keys[input.role] : null);
        if (!key) throw new ExamError(400,'MODEL_KEY_REQUIRED','请填写该服务的 API Key。');
        this.checks.add(user.id);
        const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const response = await this.network(input.profile.baseURL + '/models',{headers:{authorization:'Bearer '+key},signal:controller.signal});
            if (!response.ok) throw new ExamError(502,'MODEL_CHECK_FAILED','接口连接失败（HTTP '+response.status+'）。');
            reader = response.body?.getReader(); if (!reader) throw new Error('EMPTY_MODEL_LIST');
            const chunks: Uint8Array[] = []; let bytes = 0;
            for (;;) { const part=await reader.read(); if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024*1024)throw new Error('MODEL_LIST_LIMIT');chunks.push(part.value); }
            const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const models = z.object({data:z.array(z.object({id:z.string().max(200)})).max(4096)}).parse(raw);
            return {reachable:true as const,modelListed:models.data.some(row=>row.id===input.profile.model)};
        } catch (error) { if (error instanceof ExamError) throw error; throw new ExamError(502,'MODEL_CHECK_FAILED','接口检查未通过，请检查地址、密钥或网络。'); }
        finally { clearTimeout(timer);this.checks.delete(user.id);try{await reader?.cancel();}catch{}reader?.releaseLock(); }
    }
}

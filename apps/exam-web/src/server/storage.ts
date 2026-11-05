import { EXAM_SOURCE_IMAGE_BYTES } from '@solveflow/contracts/managed-exam';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, GetBucketAclCommand } from '@aws-sdk/client-s3';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
export interface ExamStorage {
    put(key: string, data: Uint8Array): Promise<void>;
    get(key: string): Promise<Uint8Array>;
    remove(key: string): Promise<void>;
    close(): void;
}
export class PrivateS3Storage implements ExamStorage {
    private readonly client: S3Client;
    constructor(private readonly config: {
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
    }) { this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: false, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 2 }); }
    async verifyPrivate() { const acl = await this.client.send(new GetBucketAclCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(10000) }); if ((acl.Grants ?? []).some(grant => grant.Grantee?.URI?.includes('AllUsers') || grant.Grantee?.URI?.includes('AuthenticatedUsers')))
        throw new Error('PRIVATE_BUCKET_REQUIRED'); }
    async put(key: string, data: Uint8Array) { await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data, ContentType: 'image/jpeg', CacheControl: 'private, no-store' }), { abortSignal: AbortSignal.timeout(30000) }); }
    async get(key: string) { const signal = AbortSignal.timeout(30000); const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal }); if (!result.Body)
        throw new Error('IMAGE_UNAVAILABLE'); const reader = result.Body.transformToWebStream().getReader(); const chunks: Uint8Array[] = []; let size = 0; try {
        for (;;) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.length;
            if (size > EXAM_SOURCE_IMAGE_BYTES)
                throw new Error('IMAGE_LIMIT');
            chunks.push(part.value);
        }
        return Uint8Array.from(Buffer.concat(chunks));
    }
    finally {
        await reader.cancel();
        reader.releaseLock();
    } }
    async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) }); }
    close() { this.client.destroy(); }
}
/** Local development only; production bootstrap rejects this adapter. Never served statically. */
export class LocalExamStorage implements ExamStorage {
    constructor(private readonly root: string) { }
    private path(key: string) { if (!/^[a-f0-9-]+\/[a-f0-9-]+\.jpg$/.test(key))
        throw new Error('INVALID_OBJECT_KEY'); const path = resolve(this.root, key); if (!path.startsWith(resolve(this.root) + sep))
        throw new Error('INVALID_OBJECT_KEY'); return path; }
    async put(key: string, data: Uint8Array) { const file = this.path(key); await mkdir(resolve(file, '..'), { recursive: true }); const tmp = file + '.tmp'; await writeFile(tmp, data, { mode: 0o600 }); await rename(tmp, file); }
    async get(key: string) { const bytes = await readFile(this.path(key)); if (bytes.length > EXAM_SOURCE_IMAGE_BYTES)
        throw new Error('IMAGE_LIMIT'); return bytes; }
    async remove(key: string) { await rm(this.path(key), { force: true }); }
    close() { }
}

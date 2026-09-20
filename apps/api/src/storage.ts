import { S3Client, CreateBucketCommand, HeadBucketCommand, GetBucketPolicyCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "@solveflow/config";
export interface ImageStore { put(key: string, data: Uint8Array, signal: AbortSignal): Promise<void>; get(key: string, signal: AbortSignal): Promise<Uint8Array>; remove(key: string, signal: AbortSignal): Promise<void>; }
export class S3ImageStore implements ImageStore {
  private readonly client: S3Client;
  constructor(private readonly config: AppConfig["storage"]) {
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true, maxAttempts: 1 });
  }
  private signal(signal: AbortSignal) { return AbortSignal.any([signal, AbortSignal.timeout(5000)]); }
  async ensurePrivateBucket() {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(5000) }); }
    catch (error) {
      if (!(error instanceof Error) || !["NotFound", "NoSuchBucket"].includes(error.name)) throw new Error("STORAGE_UNAVAILABLE");
      try { await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(5000) }); }
      catch (creation) { if (!(creation instanceof Error) || creation.name !== "BucketAlreadyOwnedByYou") throw new Error("STORAGE_UNAVAILABLE"); }
    }
    try { await this.client.send(new GetBucketPolicyCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(5000) }); }
    catch (error) { if (error instanceof Error && error.name === "NoSuchBucketPolicy") return; throw new Error("STORAGE_POLICY_UNVERIFIED"); }
    throw new Error("STORAGE_POLICY_UNVERIFIED");
  }
  async put(key: string, data: Uint8Array, signal: AbortSignal) {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data, ContentType: "image/jpeg", CacheControl: "private, no-store" }), { abortSignal: this.signal(signal) });
  }
  async get(key: string, signal: AbortSignal) {
    const active = this.signal(signal);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: active });
    if (!result.Body) throw new Error("IMAGE_UNAVAILABLE");
    const reader = result.Body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { active.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 4 * 1024 * 1024) throw new Error("IMAGE_LIMIT"); chunks.push(next.value); }
      if (!size) throw new Error("IMAGE_UNAVAILABLE");
      return new Uint8Array(Buffer.concat(chunks));
    } finally { await reader.cancel(); reader.releaseLock(); }
  }
  async remove(key: string, signal: AbortSignal) { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: this.signal(signal) }); }
  close() { this.client.destroy(); }
}

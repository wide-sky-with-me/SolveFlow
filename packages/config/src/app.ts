import { z } from "zod";
const text = z.string().trim().min(1);
const localUrl = z.url().refine(value => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; });
export const appEnvironmentSchema = z.object({
  SOLVEFLOW_APP_DATABASE_URL: z.string().refine(value => { try { return ["postgres:", "postgresql:"].includes(new URL(value).protocol); } catch { return false; } }),
  SOLVEFLOW_APP_DB_PASSWORD: text.optional(),
  SOLVEFLOW_APP_S3_ENDPOINT: localUrl,
  SOLVEFLOW_APP_S3_REGION: text.default("us-east-1"),
  SOLVEFLOW_APP_S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/),
  SOLVEFLOW_APP_S3_ACCESS_KEY: text,
  SOLVEFLOW_APP_S3_SECRET_KEY: z.string().min(16),
  SOLVEFLOW_APP_COOKIE_SECRET: z.string().min(32),
  SOLVEFLOW_APP_ORIGIN: localUrl.refine(value => new URL(value).origin === value),
  SOLVEFLOW_APP_API_PORT: z.coerce.number().int().min(1024).max(65535).default(3101),
  SOLVEFLOW_APP_MODE: z.enum(["disabled", "live", "demo"]).default("disabled"),
});
export const appEnvironmentKeys = Object.keys(appEnvironmentSchema.shape);
export function loadAppConfig(environment: unknown) {
  const parsed = appEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error("APP_CONFIG_INVALID");
  const value = parsed.data;
  return Object.freeze({ databaseUrl: value.SOLVEFLOW_APP_DATABASE_URL, origin: value.SOLVEFLOW_APP_ORIGIN,
    cookieSecret: value.SOLVEFLOW_APP_COOKIE_SECRET, apiPort: value.SOLVEFLOW_APP_API_PORT, mode: value.SOLVEFLOW_APP_MODE,
    storage: Object.freeze({ endpoint: value.SOLVEFLOW_APP_S3_ENDPOINT, region: value.SOLVEFLOW_APP_S3_REGION, bucket: value.SOLVEFLOW_APP_S3_BUCKET,
      accessKeyId: value.SOLVEFLOW_APP_S3_ACCESS_KEY, secretAccessKey: value.SOLVEFLOW_APP_S3_SECRET_KEY }) });
}
export type AppConfig = ReturnType<typeof loadAppConfig>;

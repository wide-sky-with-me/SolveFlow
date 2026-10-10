export class ClientError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export const clientError = (error: unknown) => error instanceof ClientError ? error.message : error instanceof Error && !["AbortError", "TimeoutError", "TypeError", "ZodError"].includes(error.name) ? error.message : "连接中断或请求超时，请重试。";

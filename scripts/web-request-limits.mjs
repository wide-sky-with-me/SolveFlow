// Decision: .agents/notes/implemented/architecture/2026-10-22-remote-web-upload-budget.md
export const WEB_CONFIG_BODY_TIMEOUT_MS = 10_000;
export const WEB_MODEL_BODY_TIMEOUT_MS = 120_000;
export const WEB_MODEL_BODY_IDLE_TIMEOUT_MS = 30_000;
export const WEB_REQUEST_TIMEOUT_MS = WEB_MODEL_BODY_TIMEOUT_MS + 10_000;
export function configureWebRequestTimeouts(server) {
  server.requestTimeout = WEB_REQUEST_TIMEOUT_MS;
  server.headersTimeout = 10_000;
}

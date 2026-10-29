export const WEB_CONFIG_BODY_TIMEOUT_MS: number;
export const WEB_MODEL_BODY_TIMEOUT_MS: number;
export const WEB_MODEL_BODY_IDLE_TIMEOUT_MS: number;
export const WEB_REQUEST_TIMEOUT_MS: number;
export function configureWebRequestTimeouts(server: { requestTimeout: number; headersTimeout: number }): void;

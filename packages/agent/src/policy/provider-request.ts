import { boundProviderResponse } from "./bounded-response.js";
export type ProviderFailure = "PROVIDER_AUTH_FAILED" | "MODEL_UNAVAILABLE" | "PROVIDER_RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REQUEST_REJECTED" | "PROVIDER_REDIRECT_DENIED" | "PROVIDER_TRANSPORT_FAILED" | "PROVIDER_REQUEST_DENIED" | "PROVIDER_RESPONSE_LIMIT";

/** One authorized model attempt, one exact POST destination. Trusted composition
 * supplies the endpoint; this helper does not grant live-call or billing permission.
 * No response-body/stream memory cap is claimed here.
 */
export function createProviderRequest(endpoint: string, transport: typeof globalThis.fetch = globalThis.fetch) {
  let expected: URL;
  try {
    expected = new URL(endpoint);
    if ((expected.protocol !== "https:" && !(expected.protocol === "http:" && expected.hostname === "127.0.0.1")) || expected.username || expected.password || expected.search || expected.hash || !expected.pathname.endsWith("/chat/completions")) throw new Error();
  } catch { throw new Error("INVALID_PROVIDER_ENDPOINT"); }
  const destination = expected.href;
  let attempted = false; let failure: ProviderFailure | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); } catch { failure ??= "PROVIDER_REQUEST_DENIED"; throw new Error(failure); }
    if (attempted || failure !== undefined || request.signal.aborted || request.url !== destination || request.method !== "POST") {
      failure ??= "PROVIDER_REQUEST_DENIED"; throw new Error(failure);
    }
    attempted = true;
    try {
      const response = await transport(request, { redirect: "manual" });
      if (response.status >= 300 && response.status < 400) failure = "PROVIDER_REDIRECT_DENIED";
      else if (response.status === 401 || response.status === 403) failure = "PROVIDER_AUTH_FAILED";
      else if (response.status === 404) failure = "MODEL_UNAVAILABLE";
      else if (response.status === 429) failure = "PROVIDER_RATE_LIMIT";
      else if (response.status >= 500) failure = "PROVIDER_UNAVAILABLE";
      else if (!response.ok) failure = "PROVIDER_REQUEST_REJECTED";
      return boundProviderResponse(response, code => { failure ??= code; });
    } catch { failure ??= "PROVIDER_TRANSPORT_FAILED"; throw new Error(failure); }
  };
  return Object.freeze({ fetch, failure: () => failure });
}

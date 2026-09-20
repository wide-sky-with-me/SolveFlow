import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@solveflow/contracts/http";
const payload = z.strictObject({ v: z.literal(1), id: z.uuid(), expires: z.number().int().positive() });
export function createIdentity(secret: string, purpose: "browser" | "native-v1" = "browser") {
  if (secret.length < 32) throw new Error("COOKIE_SECRET_INVALID");
  const sign = (data: string) => createHmac("sha256", secret).update(purpose === "browser" ? data : `${purpose}:${data}`).digest("base64url");
  return {
    issue() { const id = randomUUID(); const data = Buffer.from(JSON.stringify({ v: 1, id, expires: Date.now() + 30 * 86400_000 })).toString("base64url"); return { id, cookie: `${data}.${sign(data)}` }; },
    verify(cookie: string | undefined) {
      try {
        if (!cookie || cookie.length > 512) throw new Error();
        const parts = cookie.split("."); const data = parts[0]; const signature = parts[1];
        if (parts.length !== 2 || !data || !signature) throw new Error();
        const expected = Buffer.from(sign(data)); const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
        const parsed = payload.parse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")));
        if (parsed.expires <= Date.now()) throw new Error();
        return parsed.id;
      } catch { throw new ApiError("UNAUTHORIZED"); }
    },
  };
}

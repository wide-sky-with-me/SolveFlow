import { MAX_MODEL_DISPATCHES } from "@solveflow/contracts/agent";
import { z } from "zod";
export const SpendRequestSchema = z.strictObject({ type: z.literal("model.reserve"), id: z.number().int().min(1).max(MAX_MODEL_DISPATCHES), modelId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/) });
export const SpendReplySchema = z.strictObject({ type: z.literal("model.reserved"), id: z.number().int().min(1).max(MAX_MODEL_DISPATCHES), ok: z.literal(true) });

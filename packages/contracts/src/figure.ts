import { z } from "zod";
const coordinate = z.number().finite().min(-10000).max(10000);
const point = z.tuple([coordinate, coordinate]);
const label = z.string().trim().max(80).optional();
const color = z.enum(["green", "blue", "orange", "gray"]).default("green");
const element = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("point"), at: point, label, color }),
  z.strictObject({ kind: z.literal("segment"), from: point, to: point, label, color }),
  z.strictObject({ kind: z.literal("circle"), center: point, radius: z.number().finite().positive().max(10000), label, color }),
  z.strictObject({ kind: z.literal("polyline"), points: z.array(point).min(2).max(128), label, color }),
  z.strictObject({ kind: z.literal("polygon"), points: z.array(point).min(3).max(32), label, color }),
  z.strictObject({ kind: z.literal("polynomial"), coefficients: z.array(coordinate).min(1).max(4), label, color }),
]);
const range = z.tuple([coordinate, coordinate]).refine(([min, max]) => max - min >= 0.1, "Invalid coordinate range");
export const FigureSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), kind: z.literal("coordinate"),
  title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(500),
  xLabel: z.string().trim().min(1).max(60).optional(), yLabel: z.string().trim().min(1).max(60).optional(),
  equalAspect: z.boolean().optional(),
  xRange: range, yRange: range, elements: z.array(element).min(1).max(24),
});
export const FiguresSchema = z.array(FigureSchema).max(3).refine(items => new Set(items.map(item => item.id)).size === items.length);
export type Figure = z.infer<typeof FigureSchema>;

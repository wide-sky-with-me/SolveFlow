import { z } from "zod";
import { figureCheckErrors } from './figure-checks.js';
const coordinate = z.number().finite().min(-10000).max(10000);
const point = z.tuple([coordinate, coordinate]);
const label = z.string().trim().max(80).optional();
const color = z.enum(["green", "blue", "orange", "gray"]).default("green");
const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const presentation = { id: identifier.optional(), label, color, lineStyle: z.enum(['solid', 'dashed']).optional() };
const element = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("point"), at: point, ...presentation }),
  z.strictObject({ kind: z.literal("segment"), from: point, to: point, arrow: z.boolean().optional(), ...presentation }),
  z.strictObject({ kind: z.literal("circle"), center: point, radius: z.number().finite().positive().max(10000), ...presentation }),
  z.strictObject({ kind: z.literal("polyline"), points: z.array(point).min(2).max(128), ...presentation }),
  z.strictObject({ kind: z.literal("polygon"), points: z.array(point).min(3).max(32), ...presentation }),
  z.strictObject({ kind: z.literal("polynomial"), coefficients: z.array(coordinate).min(1).max(4), ...presentation }),
]);
const check = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('point-on-curve'), pointId: identifier, curveId: identifier }),
  z.strictObject({ kind: z.literal('intersection'), pointId: identifier, curveIds: z.tuple([identifier, identifier]) }),
  z.strictObject({ kind: z.literal('polygon-area'), polygonId: identifier, expected: z.number().finite().positive().max(400_000_000) }),
]);
const range = z.tuple([coordinate, coordinate]).refine(([min, max]) => max - min >= 0.1, "Invalid coordinate range");
const FigureObject = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), kind: z.literal("coordinate"),
  title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(500),
  xLabel: z.string().trim().min(1).max(60).optional(), yLabel: z.string().trim().min(1).max(60).optional(),
  equalAspect: z.boolean().optional(),
  purpose: z.enum(['function', 'geometry', 'economics', 'data']).optional(), checks: z.array(check).min(1).max(8).optional(),
  xRange: range, yRange: range, elements: z.array(element).min(1).max(24),
});
export type Figure = z.infer<typeof FigureObject>;
export const FigureSchema = FigureObject.superRefine((value, ctx) => {
  for (const message of figureCheckErrors(value)) ctx.addIssue({ code: 'custom', message, path: ['checks'] });
});
export const FiguresSchema = z.array(FigureSchema).max(3).refine(items => new Set(items.map(item => item.id)).size === items.length);

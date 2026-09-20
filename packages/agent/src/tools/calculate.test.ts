import { expect, it } from "vitest";
import { calculate } from "./calculate.js";
const fresh = () => new AbortController().signal;
const input = (expression: string, angleUnit: "rad" | "deg" = "rad") => ({ schemaVersion: 1, expression, angleUnit });

it.each([
  ["2 + 3 * 4", 14], ["(7-3)/2", 2], ["-2**2", -4], ["2**3**2", 512], ["2**-2", 0.25],
  ["sqrt(9) + abs(-2)", 5], ["log(e)", 1], ["exp(0)", 1], ["sin(pi/2)", 1], ["cos(0)", 1],
  [".5 + 1.5e1", 15.5], ["1 + +2", 3], ["9007199254740991", 9007199254740991],
])("evaluates the restricted grammar: %s", (expression, expected) => {
  expect(Number(calculate(input(expression), fresh()).value)).toBeCloseTo(expected, 12);
});
it("distinguishes degrees, radians, finite approximations and exact integers", () => {
  expect(calculate(input("sin(30)", "deg"), fresh())).toMatchObject({ value: "0.5", approximate: true, precision: 15 });
  expect(Number(calculate(input("sin(30)"), fresh()).value)).toBeCloseTo(Math.sin(30), 12);
  expect(calculate(input("0.1+0.2"), fresh())).toMatchObject({ value: "0.3", approximate: true });
  expect(calculate(input("1/3"), fresh())).toMatchObject({ value: "0.333333333333333", approximate: true });
  expect(calculate(input("(7-3)/2"), fresh())).toMatchObject({ value: "2", approximate: false, precision: 1, warnings: [] });
  expect(calculate(input("9007199254740991"), fresh())).toMatchObject({ value: "9007199254740991", approximate: false, precision: 16 });
});
it.each(["process.exit()", "globalThis", "constructor.constructor('x')()", "import('fs')", "Math.sin(1)", "x=1", "1;2", "1,2", "[1]", "2^3", "sin(1,2)", "1/*x*/2", "2cm", "2(3)", "sqrt", "", " ", "0xff", "Infinity", "NaN", "1e", "((2)"])("rejects unsupported syntax without execution: %s", expression => {
  expect(() => calculate(input(expression), fresh())).toThrow("INVALID_EXPRESSION");
});
it.each(["1/0", "sqrt(-1)", "log(0)", "log(-1)", "0**0", "0**-1", "(-2)**0.5"])("rejects real-domain errors: %s", expression => {
  expect(() => calculate(input(expression), fresh())).toThrow("DOMAIN_ERROR");
});
it("refuses tangent at or too close to an asymptote", () => {
  expect(() => calculate(input("tan(90)", "deg"), fresh())).toThrow("DOMAIN_ERROR");
  expect(() => calculate(input("tan(pi/2)"), fresh())).toThrow("DOMAIN_ERROR");
});
it.each(["1e101", "1e-101", "1e999", "1e-999", "10**100 * 10", "1e-100**100"])("refuses overflow/underflow rather than returning fake zero: %s", expression => {
  expect(() => calculate(input(expression), fresh())).toThrow("NUMERIC_RANGE");
});
it.each(["2**101", "2**2**100", "exp(101)", "sin(1e7)", "(".repeat(40) + "1" + ")".repeat(40), "1+".repeat(100) + "1"])("bounds computational work: %s", expression => {
  expect(() => calculate(input(expression), fresh())).toThrow("EXPRESSION_LIMIT");
});
it("checks cancellation and the one-second deadline inside parsing/evaluation", () => {
  const controller = new AbortController(); controller.abort(new Error("private"));
  expect(() => calculate(input("2+2"), controller.signal)).toThrow(/^CANCELLED$/);
  let time = 0;
  expect(() => calculate(input("2+2"), fresh(), () => { time += 250; return time; })).toThrow("CALCULATION_TIMEOUT");
});
it("validates version, fields, input length and angle units", () => {
  for (const raw of [{ expression: "2" }, { ...input("2"), code: "private" }, { ...input("2"), angleUnit: "grad" }, input("1".repeat(513))]) {
    expect(() => calculate(raw, fresh())).toThrow("INVALID_EXPRESSION");
  }
});

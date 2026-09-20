import { CalculationInputSchema, CalculationResultSchema, type CalculationResult } from "@solveflow/contracts/calculation";

type Operator = "+" | "-" | "*" | "/" | "**";
type FunctionName = "sin" | "cos" | "tan" | "sqrt" | "abs" | "log" | "exp";
type Ast = { kind: "number"; value: number; exact: boolean }
  | { kind: "unary"; operator: "+" | "-"; operand: Ast }
  | { kind: "binary"; operator: Operator; left: Ast; right: Ast }
  | { kind: "function"; name: FunctionName; operand: Ast };
type Value = { value: number; exact: boolean };
export class CalculationError extends Error {
  constructor(readonly code: "INVALID_EXPRESSION" | "EXPRESSION_LIMIT" | "DOMAIN_ERROR" | "NUMERIC_RANGE" | "CALCULATION_TIMEOUT" | "CANCELLED") { super(code); }
}
const invalid = () => new CalculationError("INVALID_EXPRESSION");
const isFunction = (name: string): name is FunctionName => ["sin", "cos", "tan", "sqrt", "abs", "log", "exp"].includes(name);
const isOperator = (value: string): value is Operator => ["+", "-", "*", "/", "**"].includes(value);

/** Numeric AST only: no dynamic property/function resolution or host capabilities.
 * At most 512 characters, 256 tokens, 128 nodes, depth 32 and one second. IEEE-754
 * approximations are labelled, never used as symbolic proof or unit conversion. */
export function calculate(raw: unknown, signal: AbortSignal, now: () => number = () => performance.now()): CalculationResult {
  const started = now();
  const check = () => {
    if (signal.aborted) throw new CalculationError("CANCELLED");
    if (now() - started >= 1000) throw new CalculationError("CALCULATION_TIMEOUT");
  };
  check();
  const parsed = CalculationInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const { expression, angleUnit } = parsed.data;
  const tokens: string[] = [];
  const scanner = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-z]+|\*\*|[()+\-*/]/y;
  while (scanner.lastIndex < expression.length) {
    check();
    const match = scanner.exec(expression);
    if (!match) throw invalid();
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
    if (tokens.length > 256) throw new CalculationError("EXPRESSION_LIMIT");
  }
  let index = 0;
  let nodes = 0;
  const node = (value: Ast): Ast => { nodes += 1; if (nodes > 128) throw new CalculationError("EXPRESSION_LIMIT"); return value; };
  const parse = (minimum: number, depth: number): Ast => {
    check();
    if (depth > 32) throw new CalculationError("EXPRESSION_LIMIT");
    const token = tokens[index++];
    if (!token) throw invalid();
    let left: Ast;
    if (token === "+" || token === "-") left = node({ kind: "unary", operator: token, operand: parse(20, depth + 1) });
    else if (token === "(") { left = parse(0, depth + 1); if (tokens[index++] !== ")") throw invalid(); }
    else if (isFunction(token)) {
      if (tokens[index++] !== "(") throw invalid();
      const operand = parse(0, depth + 1);
      if (tokens[index++] !== ")") throw invalid();
      left = node({ kind: "function", name: token, operand });
    } else if (token === "pi" || token === "e") left = node({ kind: "number", value: token === "pi" ? Math.PI : Math.E, exact: false });
    else if (/^(?:\d|\.)/.test(token)) {
      const value = Number(token);
      left = node({ kind: "number", value, exact: /^\d+$/.test(token) && Number.isSafeInteger(value) });
      if (value === 0 && /[1-9]/.test(token.split(/[eE]/)[0] ?? "")) throw new CalculationError("NUMERIC_RANGE");
    } else throw invalid();
    for (;;) {
      const operator = tokens[index];
      if (!operator || !isOperator(operator)) break;
      const precedence = operator === "**" ? 30 : operator === "*" || operator === "/" ? 10 : 5;
      if (precedence < minimum) break;
      index += 1;
      left = node({ kind: "binary", operator, left, right: parse(operator === "**" ? precedence : precedence + 1, depth + 1) });
    }
    return left;
  };
  const ast = parse(0, 0);
  if (index !== tokens.length) throw invalid();
  const bounded = (value: number, exact: boolean): Value => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e100 || (value !== 0 && Math.abs(value) < 1e-100)) throw new CalculationError("NUMERIC_RANGE");
    return { value: Object.is(value, -0) ? 0 : value, exact: exact && Number.isSafeInteger(value) };
  };
  const evaluate = (ast: Ast, depth = 0): Value => {
    check();
    if (depth > 32) throw new CalculationError("EXPRESSION_LIMIT");
    if (ast.kind === "number") return bounded(ast.value, ast.exact);
    if (ast.kind === "unary") { const operand = evaluate(ast.operand, depth + 1); return bounded(ast.operator === "-" ? -operand.value : operand.value, operand.exact); }
    if (ast.kind === "binary") {
      const left = evaluate(ast.left, depth + 1); const right = evaluate(ast.right, depth + 1);
      const exact = left.exact && right.exact;
      switch (ast.operator) {
        case "+": return bounded(left.value + right.value, exact);
        case "-": return bounded(left.value - right.value, exact);
        case "*": return bounded(left.value * right.value, exact);
        case "/":
          if (right.value === 0) throw new CalculationError("DOMAIN_ERROR");
          return bounded(left.value / right.value, exact);
        case "**": {
          if (Math.abs(right.value) > 100) throw new CalculationError("EXPRESSION_LIMIT");
          if ((left.value === 0 && right.value <= 0) || (left.value < 0 && !Number.isInteger(right.value))) throw new CalculationError("DOMAIN_ERROR");
          const power = left.value ** right.value;
          if (left.value !== 0 && power === 0) throw new CalculationError("NUMERIC_RANGE");
          return bounded(power, false);
        }
      }
    }
    const operand = evaluate(ast.operand, depth + 1);
    const x = operand.value;
    const angle = angleUnit === "deg" ? x / 180 * Math.PI : x;
    switch (ast.name) {
      case "abs": return bounded(Math.abs(x), operand.exact);
      case "sqrt":
        if (x < 0) throw new CalculationError("DOMAIN_ERROR");
        return bounded(Math.sqrt(x), false);
      case "log":
        if (x <= 0) throw new CalculationError("DOMAIN_ERROR");
        return bounded(Math.log(x), false);
      case "exp":
        if (Math.abs(x) > 100) throw new CalculationError("EXPRESSION_LIMIT");
        return bounded(Math.exp(x), false);
      case "sin": case "cos": case "tan":
        if (Math.abs(angle) > 1e6) throw new CalculationError("EXPRESSION_LIMIT");
        if (ast.name === "tan" && Math.abs(Math.cos(angle)) < 1e-12) throw new CalculationError("DOMAIN_ERROR");
        return bounded(ast.name === "sin" ? Math.sin(angle) : ast.name === "cos" ? Math.cos(angle) : Math.tan(angle), false);
    }
  };
  const result = evaluate(ast);
  check();
  return CalculationResultSchema.parse({ schemaVersion: 1,
    value: result.exact ? String(result.value) : String(Number(result.value.toPrecision(15))),
    approximate: !result.exact, precision: result.exact ? String(Math.abs(result.value)).length : 15,
    warnings: result.exact ? [] : ["使用浮点近似，不构成符号证明；log 为自然对数，结果不包含物理单位。", `三角函数角度单位：${angleUnit}。`],
  });
}

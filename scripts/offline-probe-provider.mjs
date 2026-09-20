import { ModelConnectionsSchema } from "../packages/contracts/dist/model.js";
import { createServer } from "node:http";
import { once } from "node:events";

// Deterministic synthetic provider, never imported by the live branch.
export async function startOfflineProbeProvider({ scenario = "pass" } = {}) {
  if (!["pass", "diagram", "missing-learning", "fail-pass", "fail-fail", "unknown", "policy", "clarification", "unavailable", "invalid-json"].includes(scenario)) throw new Error("INVALID_FIXTURE_SCENARIO");
  const observations = { requests: 0, images: 0, verifierWithoutTools: 0, calculations: 0, diagramReads: 0 };
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== "/v1/chat/completions" || request.method !== "POST" || request.headers.authorization !== "Bearer synthetic-local-only") { response.writeHead(403).end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      observations.requests++;
      if (scenario === "unavailable") { response.writeHead(404, { "content-type": "application/json" }).end('{"error":{"message":"private-fixture-canary"}}'); return; }
      if (/data:image\/(png|jpeg);base64,/.test(JSON.stringify(body.messages))) observations.images++;
      const solver = body.tools?.some(tool => tool.function?.name === "read");
      const hasRead = body.messages.some(message => message.role === "tool");
      let delta; let finish;
      if (solver && !hasRead && scenario !== "clarification" && scenario !== "invalid-json") {
        if (!body.tools.some(tool => tool.function?.name === "calculate")) throw new Error("CALCULATOR_MISSING");
        delta = { role: "assistant", tool_calls: [
          { index: 0, id: "read-general", type: "function", function: { name: "read", arguments: JSON.stringify({ path: scenario === "diagram" ? "/solveflow/skills/diagram/SKILL.md" : "/solveflow/skills/general/SKILL.md" }) } },
          { index: 1, id: "calculate-equation", type: "function", function: { name: "calculate", arguments: JSON.stringify({ schemaVersion: 1, expression: "(7-3)/2" }) } },
        ] };
        finish = "tool_calls";
      } else if (solver && scenario === "diagram" && !body.messages.some(message => message.role === "tool" && message.tool_call_id === "read-reference")) {
        if (!JSON.stringify(body.messages).includes("polynomial.coefficients")) throw new Error("SKILL_NOT_LOADED");
        delta = { role: "assistant", tool_calls: [{ index: 0, id: "read-reference", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "/solveflow/skills/diagram/references/example.md" }) } }] };
        finish = "tool_calls";
      } else {
        if (solver && scenario !== "clarification" && scenario !== "invalid-json") {
          const calculation = body.messages.find(message => message.role === "tool" && message.tool_call_id === "calculate-equation");
          const result = JSON.parse(calculation?.content ?? "null");
          if (result?.value !== "2" || result?.approximate !== false) throw new Error("CALCULATION_FAILED");
          observations.calculations++;
        }
        if (!solver) observations.verifierWithoutTools++;
        const result = solver ? { schemaVersion: 1, kind: "answer", problem: { text: "2x + 3 = 7", subject: "math", uncertainties: [] }, answer: "x = 2",
          steps: [{ id: "s1", title: "移项", explanation: "两边减去3得到2x=4，再除以2得到x=2。" }], knowledgePoints: ["一元一次方程"], knowledgeDetails: [{ name: "一元一次方程", explanation: "未知数最高次数为1的等式。", application: "移项后两边除以系数。" }], citationIds: [], clarificationQuestions: [] }
          : { schemaVersion: 1, verdict: "pass", checked: ["transcription", "arithmetic", "domain"], issues: [] };
        if (scenario === "diagram") {
          if (solver) {
            const reference = body.messages.find(message => message.role === "tool" && message.tool_call_id === "read-reference");
            if (!reference?.content?.includes('"coefficients"')) throw new Error("REFERENCE_NOT_LOADED");
            observations.diagramReads += 2;
            result.figures = [{ schemaVersion: 1, id: "line", kind: "coordinate", title: "一次函数", description: "直线与y=7相交于x=2", xRange: [0,4], yRange: [0,12], elements: [{ kind: "polynomial", coefficients: [3,2], label: "y=2x+3" }, { kind: "point", at: [2,7], label: "交点" }] }];
          } else result.checked.push("diagram");
        }
        if (!solver && ["fail-pass", "fail-fail", "unknown"].includes(scenario)) {
          result.verdict = scenario === "unknown" ? "unknown" : scenario === "fail-fail" || observations.verifierWithoutTools === 1 ? "fail" : "pass";
          if (result.verdict !== "pass") result.issues = [{ code: "ARITHMETIC", stepId: "s1", message: "请复查这一步的计算。" }];
        }
        if (scenario === "policy") {
          if (solver) result.answer = "rejected-candidate-canary";
          else { result.verdict = "fail"; result.issues = [{ code: "POLICY_VIOLATION", message: "rejected-issue-canary" }]; }
        }
        if (solver && (scenario === "clarification" || scenario === "missing-learning")) delete result.knowledgeDetails;
        if (solver && scenario === "clarification") Object.assign(result, { kind: "clarification", answer: null, steps: [], clarificationQuestions: ["请补齐图片中缺失的条件。"] });
        delta = { role: "assistant", content: scenario === "invalid-json" ? "invalid-fixture-output" : JSON.stringify(result) }; finish = "stop";
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const frame = { id: "offline-probe", object: "chat.completion.chunk", created: 1, model: body.model };
      response.write("data: " + JSON.stringify({ ...frame, choices: [{ index: 0, delta, finish_reason: null }] }) + "\n\n");
      response.write("data: " + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) + "\n\n");
      response.end("data: [DONE]\n\n");
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("FIXTURE_ADDRESS");
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, observations,
    async close() { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

// Synthetic metadata only. The live entry never imports this fixture.
export function offlineModelConnections(baseURL) {
  const role = model => ({ route: { schemaVersion: 1, model, provider: "local-fixture", api: "openai-completions", baseURL, contextWindow: 64000, maxOutputTokens: 8192, requestMaxTokens: 4096, inputRmbPerMillionTokens: 0, outputRmbPerMillionTokens: 0, supportsImages: true, supportsTools: true, compat: {} }, apiKey: "synthetic-local-only" });
  return ModelConnectionsSchema.parse({ solver: role("fixture/solver:v1"), verifier: role("fixture/verifier:v2") });
}

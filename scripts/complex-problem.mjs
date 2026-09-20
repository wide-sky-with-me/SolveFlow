// Self-authored fixture and independently calculated truth. Only the problem
// screenshot and question are sent to Solver; expected answers stay in this test.
export async function complexProblemImage(page) {
  await page.setContent(`<html lang="zh"><meta charset="utf-8"><style>body{margin:0;background:white;color:#14201c;font:30px/1.8 sans-serif}main{width:1040px;padding:55px;box-sizing:border-box}h1{font-size:36px}p{margin:24px 0}.formula{font-size:42px;text-align:center}</style><main><h1>二次函数综合题</h1><p>已知函数</p><p class="formula">f(x) = x² − 4x + 3。</p><p>（1）求抛物线的顶点坐标及与 x 轴的交点。</p><p>（2）求抛物线与直线 y = 3 的交点，并计算<br>两条曲线围成的区域面积。</p><p>请画出坐标图，标出关键点，并说明计算步骤。</p></main></html>`);
  return page.locator("main").screenshot();
}
export function assertComplexAnswer(assert, outcome) {
  assert.equal(outcome.status, "completed");
  const candidate = outcome.candidate;
  const text = [candidate.answer, ...candidate.steps.flatMap(step => [step.explanation, step.latex ?? ""])].join(" ").replace(/\\(?:left|right|,|!|;|quad|qquad)/g, "").replace(/\s/g, "");
  assert.match(text, /(?:\\(?:d|t)?frac\{32\}\{3\}|32\/3)/, "independent area truth 32/3");
  assert.match(text, /[（(]2[,，]-1[）)]/, "vertex (2,-1)");
  for (const [x,y] of [[1,0],[3,0],[0,3],[4,3]]) assert(text.includes(`(${x},${y})`) || text.includes(`（${x}，${y}）`) || text.includes(`(${x}，${y})`), `intersection (${x},${y})`);
  assert(candidate.figures?.some(figure => figure.elements.some(element => element.kind === "polynomial" && element.coefficients.length === 3 && element.coefficients.every((c, i) => c === [3,-4,1][i]))), "correct rendered polynomial");
  assert(outcome.verification.checked.includes("diagram"));
  // ∫₀⁴ [3 - (x² - 4x + 3)] dx = [2x² - x³/3]₀⁴.
  assert(Math.abs((2*4**2 - 4**3/3) - 32/3) < 1e-12);
}

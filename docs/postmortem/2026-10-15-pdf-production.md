# PDF 生产体验持续验收

日期：2026-10-15，01:12起（Asia/Shanghai）。范围：本机3100服务，独立自动化浏览器中的真实27条保存副本；用户明确允许真实模型调用。

结论：持续验收中，不声明整批可用。原浏览器题库、模型设置、远端部署与未提交改动均保留。功能和UI需在真实整批、生成文件、缓存复用及失败恢复共同通过后交付。

## 变更与处理

建立 `.runtime/pdf-production-2026-10-15/live-batch.py`：固定目标批次、仅转发 solver、每轮最多81次分发，完整遵守应用的单条三次和总截止。隔离 qa-profile 持久保留已成功缓存，后续复测从剩余记录继续；原始题图和响应不进入 Git，响应仅留RAM做校验元数据分析。

首次真实执行3次付费请求，全部 HTTP200/stop、关闭思考，首条无成功缓存：先报 problem.illustrations.alt 超长，再报图示数量超限，最后报 problem.response.parts 不足。最终2408正文字节、660 completion tokens。三次退避和终止提示真实可见；此前55项单元与28项合成交互通过并未覆盖这个真实输出分布。

[生成视图](../../packages/agent/src/pi/batch-print-layout-generation.ts)收窄整理输出字段，保留题干全文、选项及识别疑点，图示只走真实来源裁框。完整输入、保存契约和接受响应校验保持；原因与放弃方案见[决策](../../.agents/notes/implemented/agent/2026-10-15-print-layout-generation-view.md)。

## 验证结果

- 旧完整生成 Schema 的定向回归首次失败1项；新生成视图及保存兼容断言2项通过。
- `pnpm exec vitest run packages/agent/src/pi/batch-print-layout-generation.test.ts packages/agent/src/pi/batch-print-layout.test.ts packages/agent/src/pi/batch-print-layout-normalization.test.ts packages/agent/src/pi/batch-print-layout-retry.test.ts packages/agent/src/pi/batch-print-layout-resilience.test.ts packages/contracts/src/batch-print-layout.test.ts`：63项通过，退出0。
- `pnpm build:web` 和 `pnpm --filter @solveflow/mobile typecheck`：退出0，新主包 index-89d8cc1744b50348992494545b340c8c.js。
- 新视图首轮真实请求6次：首三条首次通过，第4条前两次 JSON 错误、第三次来源自定义校验失败；留下24题待整理。再次显式续做29次，前3条未重发；余24条均通过完整校验，含第8、10、15、24条重试恢复。累计本轮38次真实调用，最终仍有4条保留待核对来源，下载按钮未启用；不等同PDF可用。
- `pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --config playwright.config.ts --output .runtime/pdf-production-2026-10-15/e2e-generation`：28项通过。随后 lint 因子系统2202单位超出2200失败；加入入口说明后再次2204超限，精简正文，不放宽门槛。
- `pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --config playwright.config.ts --max-failures 1 --output .runtime/pdf-production-2026-10-15/e2e-review-fixed`：修正恢复标记后30项通过，含初始可整理、核对入口、焦点保持与零额外调用。
- 最后 `pnpm build:web`、移动端及根 `tsc --noEmit` 均退出0；主包 index-e3629e9cd04eb423e87f1f8a64c3eecb.js。独立原生浏览器从真实27条缓存分别在1440×1000、390×844打开核对入口，均显示4题待核对、编辑区域展开、模型调用0；已查看截图确认窄屏编辑控件进入视口。
- 最后 `pnpm lint && git diff --check` 退出0，文档检查171份当前文档、53份决策、104个源码锚点、108份冻结档案。持续目标仍为 active，不用上述通过替代实际PDF验收。

## 第一轮停点

新生成视图的真实27条已通过完整结构/归属校验，但4条图示仍保留待核对来源，实际PDF尚未成功生成。纯题目“已保存内容”恢复缓存并预览27页、零模型请求，下载随后在第19题超出一题一页容量处停止（界面明确提示调整图示或重复材料）。首次同步脚本仅等待下载事件，没有及时捕捉界面内失败；补充阶段/告警观察后确认并终止多余等待，无新增付费调用。

增加核对入口后，初版UI将初始化原图占位误当作已整理，6项回归超时/状态失败后停止；改为由恢复成功或提取成功的临时 preparedKeys 标记区分，保持原图占位可正常整理、已有待核对结果可继续显式重试。标记不进入持久契约。窄屏观察发现自动展开后编辑控件仍在折叠标题下方屏外，改在展开渲染后对齐编辑区域顶部。

当时最终PDF页数/可读性/图示边界、份数与作答变体、原Windows实际浏览器均待验。本机没有 pdfinfo/pdftoppm，未为此安装依赖或降低标准。

## 第二轮变更与真实成品

第19题先量测到1671px正文，对应877px可用区域；含8选项、题干图与5张选项裁片。两列带图选项实验减少到1332px，再由既有图示缩放及8pt字号下限适配。仅对带图选项启用并排，普通文字选项不变，不拆题、不丢图、不降低下限。

增加当前题组显式重整，单图多题仍以完整来源记录为单位，其余复用。Pi 0.85.1 使用结构化 user 消息，使每张图片紧邻来源 ID 与未旋转整图参照；参考版可沿用可靠匹配的已有应用标签并披露未印字母，提示区分重复拍屏。见[来源绑定决策](../../.agents/notes/implemented/agent/2026-10-15-print-source-binding.md)。

- `python3 .runtime/pdf-production-2026-10-15/export-cached-async.py`：退出0，首份保存内容纯题参考PDF实际下载；27.4秒、7,839,195字节、模型调用0。脚本同时监听下载与界面告警，不再在已失败后盲等。
- pypdf 校验27页均为A4；PyMuPDF成功渲染第1、8、19、27页，已用图像工具检查。首份产物和关键页保留在私有 `.runtime/pdf-production-2026-10-15/`，未提交题图或PDF。这证明该缓存版本可导出，不证明图示质量合格。
- 单独重整第19题真实调用3次：JSON失败、归属失败、第三次结构接受；来源标记后又调用1次首次接受。模型实际名 deepseek-flash-guan，原设置未改。但重整后的预览出现题干图加16张选项裁片，图像工具确认重复图、标题栏、截断及选项错配；输入提示改善未解决最终视觉质量。
- 剩余4条显式续做5次请求，仅分发记录8、13、22、23，第13条一次 role Schema 失败后恢复，其它已完成记录未重发。累计本任务47次真实分发；缓存现剩1条带保留来源，原题库及已保存答案不变。
- 最新 `export-cached-async.py --artifact source-bound-27.pdf`：退出1，3.7秒捕捉第19题超页，模型调用0，没有生成新成品；首份参考PDF保留。重复裁片已使当前缓存再次越过单页下限，不以此前成功掩盖此次回归。

## 第二轮工程回归

- `pnpm exec vitest run apps/mobile/src/local/print-question-pages.test.ts apps/mobile/src/local/prepare-paper-batch.test.ts apps/mobile/src/local/download-batch-pdfs.test.ts apps/mobile/src/local/prepare-batch-export.test.ts`：19项通过，退出0。
- 来源紧邻断言在旧协议首次失败1项；修正消息后6份 Agent/契约测试63项通过，退出0。未放宽 Schema、归属或输出限制。
- 初版局部重整桌面/窄屏32项通过；增加8张选项图并排、真实PDF签名及零额外提取断言后，全量 `paper-preparation.spec.ts --config playwright.config.ts --max-failures 1 --output .runtime/pdf-production-2026-10-15/e2e-source-binding`：34项通过，退出0。均为合成回归，非真实图示准确率。
- 新 Web 构建、移动端和根 TypeScript、`pnpm lint`、`git diff --check` 均退出0。3100服务返回200且实际加载 index-185649eb23b2b0a3bf268be3e58a268e.js。原测试服务继续使用，没有替换部署。
- 新决策初次文档检查因标题不符和子系统2203单位失败；修正格式并精简正文，未放宽2200限制。最终检查172份当前文档、54份决策、106个源码锚点、108份冻结档案通过。

## 后续精修

第三轮新增显式校验模型精修、恢复保护及实际整批下载，随后逐页发现其它错配、裁边与缺项；完整事实、后续修正和剩余验收统一维护在[精修与逐页复核](2026-10-15-print-layout-refinement.md)。前述测试和停点仅代表对应历史版本，持续目标仍在执行。

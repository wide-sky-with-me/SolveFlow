# 图文提取与多份作答 PDF 第一版验收

日期：2026-10-13。

范围：`feat/batch-pdf-export` 分支的 Web 导出；合成题目、假模型、隔离 IndexedDB，桌面/移动浏览器视口。未修改用户正在运行的 3100 服务或真实数据。

## 变更

导出默认题目＋该份作答选项。纯文字由用户确认或显式AI识别后省略截图；图片定位只裁原像素，按题干/选项归属放置，先裁再旋转，低置信保留全部来源。参考本机 EXamTwin 的来源绑定/缺图保护思路，未启动它的服务。

份数弹窗支持逐份设置对错数和人工参照；取消不应用草稿。按实际题号计数，保留原红警告，调整必须对应真实选项或作答变化，不写回候选或 verified。单份下载PDF，多份一次下载ZIP；文件名包含批次、总数、对数、错数及份序号。

## 验证结果

忽略目录 `.runtime/batch-pdf-enhancement-2026-10-13/` 保存合成下载文件和截图；下载引擎长页验证另在 `.runtime/batch-pdf-v2-downloads/`。

- `pnpm build:shared`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` 均退出0。最终 Web 构建：`pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-pdf-enhancement-2026-10-13/web-final`，退出0。Node 24.21.0 与仓库指定24.19.0有 engine 警告，pnpm11.7.0。
- `pnpm exec vitest run --project unit packages/contracts/src/batch-print-layout.test.ts packages/contracts/src/batch-print-variants.test.ts packages/client/src/batch-print-variants.test.ts packages/client/src/batch-print.test.ts apps/mobile/src/runtime.test.ts --maxWorkers=2`，5文件41项通过，退出0。覆盖来源/字节、基线/参照、组合多样性、完整统计后缀、原数据、取消及模型配置锁；重复复测不累计。
- Agent专项及相关旧回归4文件80项通过：`node node_modules/vitest/vitest.mjs run --project offline packages/agent/src/pi/batch-print-layout.test.ts packages/agent/src/pi/mobile.test.ts packages/agent/src/pi/mobile-transport.test.ts packages/agent/src/pi/mobile-non-stream.test.ts --maxWorkers=2`。包含单次无工具、两种协议/非流式、恶意引用、输出上限、超时及取消，未触发付费模型。
- 下载引擎实际合成DOM：单份4页PDF，3,382,770字节；双份ZIP6,765,844字节，内含两份4页PDF，逐份factory恰好调用2次；成功及取消后的iframe均0，取消不下载。人工检查中文长文、图和最后一题长公式完整。

最终浏览器命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:44783 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/batch-management.spec.ts --output=.runtime/batch-pdf-enhancement-2026-10-13/browser-final`，22项通过，退出0。覆盖单份PDF、10份ZIP、每份实答/名称、设置取消、资源取消、原红警告修正、图示和选项图提取、原数据保护及既有批次管理。

实际文件再次用PDF解析器检查：单份1页、91,715字节，ZIP内10个PDF均1页且A4，名称含对应计数与份序号。人工查看渲染后的PDF页面，正文、选项和作答完整；收据为 `file-validation.json`。`pnpm lint`与`git diff --check`退出0，文档137当前页、42决策、87源码锚点通过。

`pnpm deps:audit`退出1，报告8项（2 critical、5 high、1 low）。只用HEAD清单及锁文件另做基线审计，也退出1，告警ID/数量与当前完全一致；新增PDF依赖没有新增告警。结构化结果为 `audit-current.json`/`audit-baseline.json`。既有告警未在本功能中扩展为依赖升级任务，不能宣称全仓安全审计通过。

## 失败与修正

- 首次新增依赖安装因未声明core-js生命周期策略退出1；显式禁用该转移安装脚本后安装退出0，不执行额外脚本。
- 初版下载按原frame测量分页，html2canvas克隆后字体重排约44px，尾部公式漏失；改在实际绘制DOM重新拟合/测量分页，不稳定则拒绝下载，复测完整。
- 新规划测试夹具的 incomplete-options 与浏览器 red-warning 枚举不符合既有schema；保留失败记录并修正夹具。首次浏览器14项中12通过、2失败，实际坏记录被保留并拒绝导出；未降低断言或放宽契约。
- 浏览器测试初次从根直接导入包无法解析，改用本仓库既有的相对构建契约入口。人工参照与原基线矛盾的回归补齐，最终输出实答跟随参照；超长名字保留完整统计后缀。

## 限制

第一版直接下载使用高清页图，正文不可选/搜索；原打印路径保留可选中文字。AI准确率未做真实样本评测，识别需用户核对；对错数属于用户导出设置与参照，不代表独立校验。原生APK/iOS未构建或安装；没有重新核验原AI答案。代码未提交或推送，测试服务交付前清理。

当前语义见[批次PDF](../subsystems/batch-pdf.md)，依赖及运行取舍见[决策](../../.agents/notes/implemented/storage/2026-10-13-batch-pdf-variants-and-image-layout.md)。

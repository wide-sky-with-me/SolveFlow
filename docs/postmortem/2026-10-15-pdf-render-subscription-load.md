# 弹窗订阅与连续导出

日期：2026-10-15。范围：原本机 `http://127.0.0.1:3100/`，Linux Chrome，隔离浏览器。未提交、推送、发布到 Mac 或修改全局设置。

结论：后台进度曾逐次带动无关导出弹窗渲染。订阅收窄后，固定 20 次进度窗口的组件渲染由 20 次降为零；桌面和窄屏均验证，前台保存重试、取消等共 98 项浏览器回归通过。真实批次十轮共 270 页完成文件、资源和存储终检。整体生产验收继续。

## 改动与取舍

[导出弹窗](../../apps/mobile/src/components/batch-pdf-export.web.tsx) 不再把全队列数组作为外部状态快照；仅选择本次已接受任务的待保存冻结行，其余返回稳定 null，无本次任务时不遍历队列。其它任务更新仍通知各自订阅方，但不再触发这个弹窗渲染。前台自己的进度沿用既有工作订阅，错误与取消不节流。

复用既有冻结行引用，不增加镜像缓存、计时器或共享任务 API，不改数据库、生成器、质量与容量边界。理由补入[原后台导出决策](../../.agents/notes/implemented/storage/2026-10-14-background-pdf-exports.md)；当前语义见[所属文档](../subsystems/batch-pdf.md)。

## 复现与回归

[回归](../../tests/mobile-e2e/background-exports.spec.ts) 使用两题合成记录提交 20 份后台作答，在首次加载绘制模块处暂留，重新打开弹窗后释放。通过[测试探针](../../tests/mobile-e2e/export-render-probe.ts) 解析实际提供的 JS，定位弹窗及任务进度函数；CDP 条件断点计数而不暂停，不向产品打包调试代码。手动修改份数先证明弹窗探针能捕获组件调用，再观察第 10 至第 30 次进度之间的渲染；容许至多两次无关全局状态更新，修复前后门槛未变。

首次类型检查因 NodeNext 相对导入缺少 `.js` 后缀退出 2，修正后类型检查通过。未修改产品的 `--grep 'background progress does not repeatedly render' --project=desktop --workers=1 --max-failures=1` 退出 1：窗口内组件渲染 20 次，超过既定上限 2。证据保留在 `.runtime/pdf-production-2026-10-15/e2e-render-r14-red/`。

`pnpm exec tsc --noEmit && pnpm --filter @solveflow/mobile build:web && pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --workers=1 --output=.runtime/pdf-production-2026-10-15/e2e-render-r14-final` 退出 0，98 项通过。包含重复保存失败、双击、保存及读取期间取消、放弃成品、原题不变、慢响应、截断、三次重试、图示整理及像素复用。

为读取精确计数，以 `--grep 'background progress does not repeatedly render' --workers=1 --reporter=json --output=.runtime/pdf-production-2026-10-15/e2e-render-r14-measurement` 额外复测，退出 0，JSON 在 `.runtime/pdf-production-2026-10-15/render-measurements-r14.json`。两项目均记录 `renders=1, progress=59, start=1, end=1`：唯一一次组件渲染来自手动改份数，测量窗口实际为零。这两项是重复取证，不累计成 100 个场景；函数调用计数不等于浏览器重绘、帧率或响应耗时。

新主包为 `index-14fe4a70155869ff27ab2210d0249400.js`，既有 CSS 不变。`pnpm lint`（含 `pnpm docs:check`）及 `git diff --check` 退出 0；文档检查为 190 份当前文档、60 份决策、120 个源码锚点、108 份冻结文档，未放宽门槛。Node 24.21.0 与声明的 24.19.0 仍有版本警告。

## 真实连续使用

脚本 `.runtime/pdf-production-2026-10-15/accept-continuous-load-round14.py` 从独立 QA 浏览器复制真实批次到新上下文，在同一弹窗连续执行十次单份下载；逐份解析 A4 页数，核对新任务、保存字节摘要及原题／整理缓存摘要。采集强制 GC 后的 V8 堆、后备存储和 DOM 计数，下载 URL 只记录类型与大小，不保存 Blob 引用；等自然撤销完成，不加速产品时钟。

两次脚本失败成绩保留：首次完成首份后，因初始化脚本只声明箭头函数、未执行 URL 探针而退出 1；第二次完成十份分页后，字符串等待触发站点 CSP 的 unsafe-eval 限制，退出 1，未通过资源终检。修正为执行初始化函数，并通过测试专用 DOM 属性等待自然撤销，未放宽 CSP、产品超时或任何断言。分别保留在 `.runtime/pdf-production-2026-10-15/load-r14-accepted/` 和 `load-r14-accepted-v2/`，均不是完整验收。

最终 `python .runtime/pdf-production-2026-10-15/accept-continuous-load-round14.py` 退出 0，完整证据在 `.runtime/pdf-production-2026-10-15/load-r14-accepted-v3/`。同一弹窗十次下载十份 PDF，各 27 页 A4，共 270 页、65,652,170 字节；十个新任务均成功，下载文件与 IndexedDB 保存字节的摘要多重集精确一致。模型请求、浏览器异常和残留批次打印 frame 均为零；原题与整理缓存摘要精确不变。结束截图已查看。

下载 Blob URL 峰值七个、45,956,519 字节，保留既有自然撤销期后全部释放。强制 GC 的实际计数如下，单位为字节；文档／节点／监听器为个数。

| 指标 | 首份后 | 第十份后 | URL释放后 |
| --- | ---: | ---: | ---: |
| V8已用堆 | 47,258,916 | 48,703,032 | 48,676,076 |
| 后备存储 | 12,484,502 | 12,485,375 | 12,441,729 |
| 文档／节点／监听器 | 4／8,211／1,951 | 4／8,273／2,078 | 2／8,178／1,892 |

十轮内未见按 PDF 文件大小累积的后备存储或持续增长的 DOM；V8 堆仍有约 1.38 MiB 增长，不据此断言无泄漏。单轮约 4.70–5.16 秒，包含采集与文件落盘，且负载可与独立离线回归并行，不用于版本速度对比。强制 GC 指标不代表浏览器峰值，也不覆盖 GPU、所有原生内存或整机 RSS。

## 后续

本轮仅证明订阅范围及有界连续使用，不证明任意输入、长期压力或跨平台表现。照片残边、邻题碎片、透视、实体打印、屏幕阅读器实际朗读及更长时间负载仍待验证；[前台直接恢复](2026-10-15-pdf-inline-save-retry.md) 保留当时范围，不由本报告补推 Mac 或原生通过。

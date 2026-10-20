# PDF 数量草稿与大份数补验

日期：2026-10-16。本机 `http://127.0.0.1:3100/`，Chrome 154、Node 24.21.0、pnpm 11.7.0；沿用既有服务，重建并刷新 Web。结论仅覆盖下述快照与场景，非生产就绪声明。当前行为归属[批次 PDF](../subsystems/batch-pdf.md)，图像校样承接[边界与输入补验](2026-10-16-pdf-perspective-boundary.md)。

## 复现与修复

先补三项桌面回归，原构建全部失败：清空份数被还原为 `1`，清空首份错题数被改为 `0`，输入 `21` 被还原为 `1`，而不是保留输入并说明错误。失败截图与日志保留在 `.runtime/pdf-production-2026-10-16/e2e-copy-input-before/`；未把该阶段记录为旧计划实际下载的证据。

[草稿投影](../../apps/mobile/src/local/print-copy-drafts.ts)保留完整整数文本与最近有效值，非法项不进入导出计划；逐份草稿有界，减份再恢复也保留隐藏项的有效值和未完文本。[字段](../../apps/mobile/src/components/batch-copy-settings.web.tsx)保持焦点、错误关联及主题样式，支持 Esc 与有界上下键。[调用方](../../apps/mobile/src/components/batch-pdf-export.web.tsx)阻断非法作答的打印、下载和后台提交，不阻断纯题目或原始记录；保存重试仍绑定旧成品。未改共享限制、持久格式或图像处理版本。

## 检查

[单测](../../apps/mobile/src/local/print-copy-drafts.test.ts)新增18项，连同既有副本规划11项共29项通过；TypeScript、Web 构建退出0。[浏览器场景](../../tests/mobile-e2e/batch-pdf-variants.spec.ts)与后台、图片整理相关回归154项通过（77场景乘两种视口）；随后新增原始记录往返与键盘上下界场景，两视口再通过2项，合计78场景/156项，不把早期重跑重复累加。

覆盖清空、逐键输入、越界、小数、指数文本、减份恢复与隐藏非法项、模式往返、关闭丢弃、20份精确 ZIP 条目及文件保存故障。故障后改变份数再重试，仍下载原两份成品且未新增渲染 iframe。桌面和窄屏深色截图已目视检查；仅浏览器视口，不代表手机。独立只读交叉审核未发现已证缺陷；其覆盖疑问已用新增两项运行时补验。

实际命令（成功项退出0；初始复现退出1）：

```sh
pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'copy quantity drafts' --project=desktop --workers=1
pnpm exec vitest run apps/mobile/src/local/print-copy-drafts.test.ts packages/client/src/batch-print-variants.test.ts
pnpm exec tsc --noEmit
pnpm --filter @solveflow/mobile build:web
pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --workers=1
pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'copy quantity keyboard bounds' --workers=1
```

最终浏览器产物分别在本轮 `.runtime/pdf-production-2026-10-16/e2e-copy-input-final/` 与 `e2e-copy-keyboard/`；修复首轮6项重跑单独保存，不计入156。文档超长曾导致检查失败，精简后最终 lint（含 docs:check）、类型及差异检查退出0，未提高长度限制。Node 与固定小版本不一致及颜色环境警告仍在。

## 真实成品

从既有 QA 配置经只读页面提取应用存储，另建隔离上下文；复用获准真实批次，未向用户浏览器注入数据。通过界面重做既有10张四角校正，JPEG 逐张匹配前轮校样；原记录摘要不变，整理摘要匹配前轮最终值。清空再逐键输入20份，逐份设错1题，经减份再恢复后导出。

```sh
python .runtime/pdf-production-2026-10-16/accept-copy-quantities-r17.py
```

真实 ZIP 含20个独立命名 PDF，各27页，540页均通过 A4 尺寸检查；CRC完整。生成、保存及下载共99.53秒，不含本次校正前置操作，非平均性能指标。ZIP为131936311字节（约125.8 MiB），保存记录与下载 SHA-256 均为 `69366aa1e99e7ca4a2f4f06f00df676d7900c5a63e361cd2afc5f4a0e544ae0a`。产品模型调用0、页面错误0，打印 iframe 已释放；未放宽128 MiB成品限额。

私有产物在 `.runtime/pdf-production-2026-10-16/copy-quantities-real-replay/`，含结果、ZIP、首末份 PDF、截图及像素比对。首份与前轮最终校样27页按144 DPI逐页像素一致；第23页 PNG 摘要仍为 `fcf7b2ed3433a680142324d7ed7704cb371c161387ff980da43ae4a69118e75d`。未把新序号、元数据或文件哈希变化当作图像质量改善。

## 边界

本轮未重新评定源题完整性、图示标签真实性或答案质量，保留既有披露。真机/实体打印、其他浏览器、低内存及长时负载仍未验；单次约100秒批处理不证明交互无卡顿。生产验收目标继续进行。

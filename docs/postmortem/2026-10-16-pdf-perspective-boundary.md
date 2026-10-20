# PDF 图像边界与数值输入补验

日期：2026-10-16。

范围：本机 Web 的四角采样器、旋转／裁框数值编辑及 27 道存量题回放；接续[前次实图校样](2026-10-15-pdf-image-perspective.md)。未增加真实题样本或付费请求。下文区分同日的采样器与后续输入修复构建。

结论：修复退化尺寸下错误复制边缘像素、逐键输入被改写和最小裁框浮点误判。后续构建完成完整导出回归及十次连续导出；十张 JPEG 和关键校样页仍与前次最终版本一致，不代替整体生产验收。

## 变更与处理

复核发现宽或高为 1 时，归一化图外坐标乘以零后落回合法像素范围。新增 1×5、5×1、1×1 图外选区断言，修复前均失败，保留失败证据。采样器改为在归一化域检查边界，并按原像素容差换算阈值；输出维度为 1 时取中心，新增补白单像素保留用例。原数组、尺寸上限、取消与白边约束继续保持，未变更契约和缓存版本。

实现与回归：[采样器](../../apps/mobile/src/local/print-image-perspective.ts)、[像素测试](../../apps/mobile/src/local/print-image-perspective.test.ts)。运行语义仍归[题图处理](../subsystems/print-images.md)，选择原因仍归[四角决策](../../.agents/notes/implemented/storage/2026-10-15-explicit-print-perspective.md)。

隔日原服务 PID 已退出，3100 无监听且直连超时；按原命令 `node scripts/web-server.mjs` 在原端口恢复本地服务，未启动其他端口或远端部署。原因未查明，不将进程退出直接归为产品崩溃。

## 采样器阶段验证

- `pnpm exec vitest run` 定向执行四角契约、派生结构、像素与批量保留四个测试文件：43 项通过，退出 0；新增断言初次执行时 3 项失败、9 项通过，退出 1，修复后该像素文件 12 项通过。
- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile build:web` 均退出 0；实际新主包为 `index-83f62420fa670852734fe56dd21cd78f.js`。原 Node 精确版本及颜色环境告警仍在，未放宽工具版本要求。
- `pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/paper-preparation.spec.ts --grep four-corner --workers=1`：桌面及移动视口共 8 项通过，退出 0。覆盖源像素复用、投影进入 PDF、拖动／键盘、越界、加工失败及只补保存；此阶段未重跑前次 106 项回归，后续构建范围见下节。
- 原 QA 应用存储经只读页面提取后复制到隔离浏览器，再从原裁片在界面应用同样十组参数；各成品 SHA-256 均与 2026-10-15 最终校样一致。全部 29 个在用未加工裁片不变，只有选定十个派生像素键变化；刷新和导出继续复用。
- 回放脚本退出 0。连续下载十份同批 PDF，每份 6,596,592 字节、27 页 A4；十条任务均成功，保存与下载文件的大小／SHA-256 多重集合一致，无残留打印 iframe、页面异常或模型路由请求。原始 27 条记录快照仍为 `baaa5796f47c31b39c7e5733ae7b57bec9f66b8d9eaa7a839343e239647190cf`。

私有产物位于 `.runtime/pdf-production-2026-10-16/`：`e2e-perspective-boundary/` 与 `perspective-boundary-replay/`。后者保存 `result.json`、十份 PDF、实图 JPEG 和页面截图；重放入口为 `.runtime/pdf-production-2026-10-15/accept-perspective-r15.py`，本次增加前次 JPEG 哈希断言并写入独立输出目录，保留旧产物。

## 数值输入修复与补验

新增浏览器回归在修复前两项均失败，退出 1：逐键输入 `-.75` 得到 `0.75`，`12.55` 得到 `12.6`。另以共享契约复现精确 5% 裁框误判，矩阵用例在 `0.1%..5.1%` 首次失败，退出 1；实际过小裁框仍正确阻断。

[数值解析](../../apps/mobile/src/local/print-number-drafts.ts)保留文本草稿，未编辑字段不经过显示精度往返；[编辑面板](../../apps/mobile/src/components/batch-pdf-panel.web.tsx)在显式更新时提交有效参数，支持方向键和字段 Escape，恢复／四角应用会清除未提交数值。无效字段用主题色虚线及关联提示，不改变现有布局。[共享契约](../../packages/contracts/src/print-image-adjustment.ts)以一个 `Number.EPSILON` 容纳相减舍入误差，最低宽高仍为 5%，无新增字段或缓存版本。

- `pnpm --filter @solveflow/contracts build`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile build:web` 均退出 0。后续主包为 `index-ef82db7df236fb90231671d976b0014d.js`。
- `pnpm exec vitest run` 定向执行四角契约、派生结构、最小裁框、数值草稿、像素及批量保留六个文件，共 62 项通过，退出 0。[裁框矩阵](../../packages/contracts/src/print-crop-bounds.test.ts)检查两个方向各 951 个精确最小跨度，并保持实际过小、反向和越界阻断；[数值用例](../../apps/mobile/src/local/print-number-drafts.test.ts)涵盖不完整输入、范围、精度和既有四角保留。
- `pnpm exec playwright test --config=playwright.functional.config.ts tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --workers=1`：114 项通过，退出 0。覆盖桌面／移动视口，包含新增逐键输入、开关保留、加工故障后原输入重试、落盘与 PDF、精确最小裁框、恢复／四角／切源及保存故障只补存储。未把此前 14 项定向复测重复累计。
- `python3 -u .runtime/pdf-production-2026-10-15/accept-perspective-r15.py` 退出 0。在十个实图编辑器逐键输入试验角度与裁框，再由四角应用覆盖并重置；试验数值未提交到校样成品。十个成品 JPEG 哈希均与前次最终版本一致，29 个在用未加工裁片及原始记录快照不变。
- 本次又连续导出十份同批 PDF，每份 6,596,592 字节、27 页 A4；保存／下载大小与哈希多重集合一致，零页面异常、残留打印 iframe 或模型路由请求。第 23 页渲染哈希仍为 `fcf7b2ed3433a680142324d7ed7704cb371c161387ff980da43ae4a69118e75d`。这是同一批样本复测，不累计为新题。
- `pnpm lint`、`git diff --check` 退出 0；文档变更后另执行 `pnpm docs:check`。Node 精确版本与颜色环境告警保持披露。

私有证据：`.runtime/pdf-production-2026-10-16/e2e-numeric-before/` 保留初次浏览器失败；`e2e-numeric-after-v1/` 保留定向复测；`e2e-numeric-final/` 为后续完整回归；`numeric-real-replay/` 保存新回放结果、PDF、JPEG 及截图。前阶段目录保持原样，重放脚本输出目录已转向后续构建。

## 未验证项与剩余风险

退化尺寸本身此次以纯像素用例验证，实图浏览器覆盖普通尺寸，尚未把所有退化组合接入完整导出场景。移动视口不等于真机；实体打印、其他浏览器、低内存设备与长时压力仍待验。未提交、推送或调整全局配置。

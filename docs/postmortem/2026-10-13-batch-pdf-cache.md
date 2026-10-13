# PDF默认题目整理、缓存与统一控件验收

日期：2026-10-13。

范围：`feat/batch-pdf-export`上的Web导出，隔离IndexedDB与合成题图，假模型响应；真实用户图片和模型未参与故障注入。

## 修改

复用项目主题与按钮，导出内容改分段选择，一份副本直接显示，多份、多题、多图用统一选择面板，支持键盘及明暗主题。默认折叠区域按需挂载，打开弹窗不进行题图像素整理或模型调用。

首次预览/打印/下载作答副本默认使用现有Pi Agent提取必要题目文字与图示；结构和实际裁片缓存到独立的有界IndexedDB，刷新后复用，原图字节变更只使对应记录失效。取消保留已完成记录，只有后续显式操作补缺失部分。原始阅读记录按用户选择才整理整图。参考EXamTwin的题目视觉解析，补强跨主图/补图完整性及不丢既有选项、图示的门禁。

## 验证

- `pnpm build:shared`、`pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-pdf-cache-2026-10-13/web`退出0；同路径前缀下`web-fixed`、`web-scroll`、`web-delivery`均退出0，分别包含焦点/取消提示、移动滚动和最终内存缓存回退。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`退出0。首次前端检查拒绝混合图示角色的flatMap隐式推断；指定公共PrintAsset类型后通过。
- Agent委托子任务运行5个离线文件，79项通过、退出0。契约回归先实测6失败，补完整性门禁后复测通过；包含纯文字主图与补图中的两个图片选项、旋转、低置信与已知内容遗漏。
- 首次完整浏览器命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45665 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/batch-management.spec.ts --output=.runtime/batch-pdf-cache-2026-10-13/browser`。30项中23通过、7失败，退出1。
- 失败归因：一份副本DOM已改为卡片，旧定位需验证完整卡片内容；取消反馈沿用解题文案，修正为导出取消；菜单Portal位于Modal焦点范围外，导致移动端焦点/滚动及键盘问题，移动到弹窗范围并消耗菜单Escape的keyup。未放宽份数、文件、布局或原数据保护标准。

- 首轮修复复测8项中7通过，移动端补图选择因滚动自动关闭仍失败；改为跟随滚动重新定位后，该移动场景通过、退出0。只修实现，没有强制点击或扩大超时。
- `pnpm exec vitest run --maxWorkers=2 packages/contracts/src/batch-print-layout.test.ts packages/agent/src/pi/batch-print-layout.test.ts packages/client/src/batch-print-variants.test.ts apps/mobile/src/runtime.test.ts`，4文件51项通过、退出0；`pnpm lint`和`git diff --check`退出0。

- 最终命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45185 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/batch-management.spec.ts --output=.runtime/batch-pdf-cache-2026-10-13/final-browser`，桌面/移动32项全部通过，退出0；含存储不可用时的内存复用及真实PDF下载。
- 人工查看最终深色弹窗截图，确认分段按钮、单份卡片、折叠区与固定操作栏。将已验收`web-delivery`资源复制到`apps/mobile/dist`，保留旧哈希资源供已打开页面使用，最后原子替换index；现有3100服务无需重启。GET首页哈希与最终构建一致，10个唯一入口资源均HTTP200。四个隔离测试服务已停止，3100服务保留。

## 边界

真实模型识别质量未测，原生未构建/安装。本机缓存是可丢弃派生数据，不参与历史备份。首次处理仍受模型时延影响，缓存命中不调用模型。本次改动未提交；忽略目录中的原始报告及文件不提交。

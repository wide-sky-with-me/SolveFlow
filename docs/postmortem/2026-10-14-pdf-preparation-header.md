# PDF 整理入口与状态补验

日期：2026-10-14。范围仅为 Web 批次导出弹窗的整理入口位置和状态呈现；持久化与模型处理规则未变。结论：当前源码与原 Mac HTTPS 来源的布局和交互通过，已更新原入口。

## 变更

按用户截图的顶部空白区域，将整理按钮移到批次摘要右侧，窄屏折到摘要下方。待整理、处理中、未保存和可复用状态统一显示在按钮下方；保存失败原位显示保存重试，切换其它版式仍保留未保存操作。首次模型调用继续显式触发，不采用打开弹窗自动后台整理。

实现为 [面板](../../apps/mobile/src/components/batch-pdf-panel.web.tsx)与[样式](../../apps/mobile/src/components/batch-pdf-dialog.web.css)；当前规则见[批次 PDF](../subsystems/batch-pdf.md)，先前处理与持久化验收见[持久整理](2026-10-14-persistent-paper-preparation.md)。

## 当前源码回归

`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm build:web`、`pnpm lint`、`git diff --check` 退出 0。Node 本机 24.21.0 与要求 24.19.0 的非致命警告保留，Mac 镜像仍使用固定 24.19.0。

`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3147 python /home/yhr/.dsh/skills/webapp-testing/scripts/with_server.py --server 'node .runtime/pdf-header-2026-10-14/offline-server.mjs' --port 3147 --timeout 30 -- pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --output=.runtime/pdf-header-2026-10-14/e2e` 退出 0，48 个桌面/移动视口场景通过。服务显式空模型环境且上游 transport 抛错；题图合成、模型响应拦截，不调用真实模型，辅助程序已清理该服务。

新场景以受控 Promise 暂停首个模拟请求，验证顶部按钮位置、窄屏无溢出、键盘 Enter、进度只显示一次、按钮互斥、完成状态、明暗主题、减少动效、切换版式和重新打开不重提取。此前保存失败、像素复用、取消及后台导出场景同时通过；不把本次重复执行累加到此前测试数。

## Mac 发布

新发布 `20261014-pdf-header-1530`，升级前保留 `shared/backups/20261014-before-pdf-header` 及前版发布目录/镜像。连接检查在升级前报告 0 条已建立连接，随后只重建 SolveFlow 容器；模型设置、预设、TLS 密钥/证书和 LAN LaunchAgent 的 SHA256 复查均通过。其它项目容器 `396f62b26017` 未变。

上传包 SHA256：`de31af755c97bb501ac1c0f0b790bd579a8adbda69d1050208c7e382c8de2d45`。Web index：`da9a9f3b28c0a7c6e60aa7b723baca3f69d2fedef036570b284bac30b1f0f19c`。服务器摘要仍为 `14d62f632dac117f76af9e4707b07fa0a3dc98eea0ad0d98d8eac38a60e2d333`，本次只改变前端产物。

`pnpm exec playwright test --config=.runtime/pdf-header-2026-10-14/mac-playwright.config.ts tests/mobile-e2e/paper-preparation.spec.ts --grep 'preparation action and live status' --output=.runtime/pdf-header-2026-10-14/mac-e2e` 退出 0，原 `https://192.168.100.84:3130/` 来源的桌面及移动视口两项新场景通过。仍为合成图和模型拦截，不发真实上游请求；Web index/服务器指纹与包一致，首页 HTTP 200，应用容器 `2189ab210c49` 健康。本次未操作用户实际浏览器配置文件；未重复真实自动抽图质量测试，浏览器移动视口不代表原生手机。

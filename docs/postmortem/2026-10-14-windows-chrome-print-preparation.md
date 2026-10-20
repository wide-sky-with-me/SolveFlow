# Windows Chrome 试卷整理追加验收

日期：2026-10-14，20:39 起排查；最终回归于 21:25:53 至 21:30:44（Asia/Shanghai）执行。

范围：当前原 HTTPS 发布，Windows 本机 Chrome 155.0.8059.79、Node v24.18.1、Playwright 1.63.0；隔离配置、合成两题和模型响应夹具。桌面及窄屏各 12 项，窄屏不是手机真机。

结论：缓存经哈希核对的静态发布资源后，24 项回归通过，退出 0；新增真实模型调用为 0。原 Windows 会话直连入口失败，真实 27 题整批仍未验收。本轮没有修改应用代码、服务器发布、模型配置或系统代理，没有访问或清空原题库。

## 变更与处理

原 Chrome 进程 17692 未开启调试端口；通过 Windows UI Automation 选中原地址标签，实测显示 `ERR_CONNECTION_CLOSED`。Windows WLAN 地址为 `192.168.22.101/24`，Mac 为 `192.168.100.84`；目标路由走 Mihomo。Windows 与 WSL 直连 TLS 握手均失败，LAN SSH 也超时。这些观测定位当前连接条件，不推断不同网段一定隔离。

既有 Tailscale SSH 通道仍通。通过此通道确认 Mac 原入口本机 HTTP 200，容器健康且仍为 `20261014-print-extract-1815`，恢复网关进程存在。仅为测试建立回环 SOCKS 隧道，并给隔离 Chrome 设置启动级代理，不修改 Windows 注册表、Mihomo、原 Chrome 配置或 Mac 网关。

Windows Node 对 WSL 的 pnpm 符号链接解析失败；在忽略目录复制现有 Playwright、playwright-core、测试包、Zod 及 contracts dist，未安装或升级依赖。测试执行文件仅替换导入测试 fixture 的首行，反向归一后与原测试字节相等；原文件 SHA-256 为 `4c9fbf34af4026f11b5c518e0a53659931413d9d20bedba72ab23f7177f55311`。断言、45 秒超时、无重试及模型夹具均保留。

## 验证结果

首次 Windows 原生入口探测：`process.platform=win32`、`navigator.platform=Win32`、Chrome 155.0.8059.79，原 URL HTTP 200；入口 SHA-256 为 `8ed04eff701143f967dfdf4191cb5bf00a58abb00687983210f682505ed3d480`，与当前发布一致，探测退出 0。

首次全套回归有 3 个已记录场景在第二次 `page.goto` 超时；停止后任务以 SIGTERM 结束，未算通过。诊断独立探测也出现主脚本仍未完成、DOM interactive 且根节点为空；Windows curl 经隧道传输该脚本 3,225,194 字节耗时 12.36 秒。保留失败日志和截图，不把网络阶段超时列为确定的整理逻辑缺陷。

复测仅缓存静态资源。线上 current/web 与本地最终发布的 20 个文件，按排序的相对路径、文件 SHA-256 汇总摘要，均为 `aca5bfcd721685d83d569ac0d6963e4263bb2d045e9e92d2d5cc48b2faa8a07b`。首页和导航仍访问原 HTTPS 地址；应用代码来自同一发布。未替换应用逻辑或放宽断言。

原生 Windows Node 实际命令（工作目录为下述忽略目录）：

```text
node.exe node_modules/playwright/cli.js test --config playwright.config.ts
```

桌面与窄屏共 24 项通过、0 失败、0 跳过、0 flaky，耗时 290,635 毫秒，退出 0。覆盖保存与刷新复用、裁片像素复用、人工裁切持久化、保存故障仅重试持久化、局部失效、整理按钮状态、Esc 与显式取消、慢响应、截止和迟到、连接错误、截断不保存不重放、空可选题号和未标记选项图保留。PDF 下载与文件头也通过。

新增报告与主题入口的 `pnpm docs:check`、`git diff --check` 通过；未因文档变动重跑应用构建。

工作产物在 `.runtime/windows-chrome-2026-10-14/`：`native-proof.json`、`navigation-proof.json`、`native-tests.log` 保留入口与首次失败；`native-tests-cached-run.log`、`results-cached-run.json` 和 `artifacts-cached-run/` 保存复测结果；配置、依赖镜像生成器与静态缓存 fixture 同目录。原测试位于 [paper-preparation.spec.ts](../../tests/mobile-e2e/paper-preparation.spec.ts)。

## 未验证项与剩余风险

原 Chrome 的真实历史记录、真实 27 题整理、数学准确率及当前跨网段直连路径仍未验收；未新增付费调用。正式用户会话需先接通原地址，隔离测试代理不修复其系统网络。缓存资源后的通过也不证明当前隧道加载性能满足日常使用要求。

Windows Node v24.18.1 低于仓库固定的 v24.19.0；本轮只用其执行 Playwright，没有在 Windows 构建项目或宣称正式工具链已验收。

测试后释放 SOCKS 隧道；原 Chrome 17692 仍存在，仅剩一个 Chrome 主进程，测试 Node 进程为 0；系统代理开关、回环端口、PAC 存在状态和目标绕过规则与测试前相同。临时依赖及测试证据仅留在忽略目录，不进入提交。

关联：[模型截断修复](2026-10-14-print-layout-truncation.md)、[测试规则](../testing.md)。

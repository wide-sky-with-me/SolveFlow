# 依赖漏洞修复与兼容验证

日期：2026-10-29。

范围：基于 `693a220` 的 35 项依赖通告；Node 24.19.0、pnpm 11.7.0；合成数据与假模型。决策和补丁维护责任见[安全更新笔记](../../.agents/notes/implemented/security/2026-10-29-dependency-hardening.md)。

结论：已发布补丁消除 34 项版本告警，严重、高危和中危均为零。deepmerge 尚无正式修复版本，已以可复现补丁阻断原型污染回归；原始审计仍报一项低危并退出 1，不宣称审计全绿。2266 项离线与 32 项浏览器场景、类型和三端 JS/Hermes 导出检查通过。

## 变更与处理

| 范围 | 锁定变化 |
| --- | --- |
| 各包直接 Zod、Expo CLI 57.0.28 的间接 Zod | 4.5.4 / 3.25.76 → 4.6.6 |
| MCP SDK | 1.31.0 → 1.32.0 |
| Hono / Node 适配 | 4.13.7 → 4.13.11；2.1.1 → 2.1.3 |
| jsPDF → DOMPurify | 3.4.16 → 3.4.17 |
| Expo → node-forge | 1.4.0 → 1.4.1 |
| Pi → undici | 8.10.2 → 8.12.2 |
| Vitest / Vite | 5.0.0 → 5.0.3；8.2.2 → 8.2.4 |
| body-parser / qs | 2.3.0 → 2.4.0；6.16.0 → 6.16.1 |
| fast-uri / ip-address | 3.1.8 → 3.1.9；10.7.1 → 10.7.4 |
| Expo → deepmerge | 保留 4.3.1；补丁拒绝危险原型键，兼顾两个输入方向 |

补丁版本均通过 npm 官方注册表核对发布时间、引擎、许可和实际消费方；没有新增库或开启安装脚本。deepmerge 通告中的建议下界与实际发布不同：[官方通告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)仍无修复版本，注册表 latest 为 4.3.1。未使用不存在的 4.3.2、重命名版本、降级或审计忽略项。

## 验证结果

原始注册表摘要、审计 JSON、安装日志、失败与复测保存在 `.runtime/dependency-hardening-2026-10-29/`。

- 升级前 `pnpm audit --json`：退出 1，35 项，1 critical、11 high、18 moderate、5 low。
- 升级前消费方回归：10 项中 8 通过、2 失败，分别复现 Zod 在容量检查前处理全部元素，以及 deepmerge 返回对象继承攻击属性。
- 安装和 `pnpm install --offline --frozen-lockfile`：退出 0。首次安装出现旧 peer 目录的 Expo bin 链接警告；冻结安装无此警告。
- 消费方复测：12 项通过；覆盖 Zod 数组/Set/Map、Expo 插件与工具 schema、RSA/证书读写、deepmerge CommonJS/UMD 和既有兼容边界。中途对源码入口做 require 失败，因为原包未带开发依赖；改为真实发布入口，安全断言保留。
- `pnpm typecheck`：退出 0，含完整共享构建及根/移动端类型检查。
- 修复后 `pnpm audit --json` 与原样 `pnpm deps:audit`：均退出 1，仅 deepmerge 一项 low。
- `pnpm exec vitest run --maxWorkers=2`：194 文件、2266 项全部通过，退出 0；12 项消费方已计入，不重复累计。
- `pnpm test:web-container`：17 项通过，退出 0。
- `node scripts/prepare-mobile-assets.mjs` 后以 Expo `export --platform all --output-dir` 导出隔离构建：退出 0，包含 Web、Android/iOS Hermes 和本地 DOM。执行原移动构建检查逻辑，仅替换构建根目录，同时加载共享构建入口，退出 0；未覆盖服务中的 `dist`。
- Playwright 执行 `act-flow`、`batch-pdf-export`、`export-preflight` 三个文件：桌面/窄屏共 32 项通过，退出 0。覆盖原文/选项保留、追问与旧题核验、含图 PDF、长文续页、取消、容量预检及题目定位，使用假模型。
- `pnpm lint`：退出 0；文档检查、源码边界及 `git diff --check` 通过。
- 暂存后空白检查发现补丁的上下文前缀与上游 TAB 缩进冲突；无上下文表示又被 pnpm 解析为偏移，源码哈希检查退出 1 并拦截。最终保留非零上下文、显式替换相同缩进内容，Git 检查通过；重新安装后的三个源码 SHA-256 与完整回归版本完全相同，锁文件仅补丁哈希变化。最终离线冻结安装及 12 项消费方回归再次退出 0，不重复累计场景。
- 附加检查发现数据库包的可选 Expo bin 残留指向旧版目录；单纯复制移动端 shim 后相对路径仍不适用。备份并按已验证的移动端目标重新生成相对引用，数据库与移动端 `expo --version` 最终均退出 0。这是忽略目录中的本机安装修复，未改变包依赖或锁文件。

## 未验证项与剩余风险

本地补丁不改变公开注册表的风险标记，CI 原始审计仍失败；后续正式补丁需重新核对并移除仓库补丁。Expo router-server 对 metro-runtime、expo-constants 的两条 peer 警告在开工锁文件中已存在，不计为新引入，也未隐藏。

本次没有真实付费请求、APK 编译、真机验收、设备安装或远程 Mac 部署。构建在隔离目录完成，本机服务的 95 个既有构建文件逐一哈希不变；本次测试服务已关闭。升级源码不等同正在运行的页面已更新。

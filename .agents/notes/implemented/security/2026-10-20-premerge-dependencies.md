# 预合并依赖定向修复与未发布补丁

日期：2026-10-20。状态：implemented。范围：六项已发布依赖修复、两项上游阻断。

## 背景

[预合并验收](../../../../docs/postmortem/2026-10-20-branch-premerge.md)发现八项通告。沿用[既有定向策略](2026-10-04-dependency-overrides.md)，只更新受影响路径；本笔记补充选择，不替代旧兼容边界。最初采用审计全绿门槛，后续用户确认的本次合并例外见“后果与限制”；实施六项不代表全部漏洞已修。

## 决定

在 [workspace](../../../../pnpm-workspace.yaml) 增加有版本范围的 override，由 pnpm 11.7.0 重新生成[锁文件](../../../../pnpm-lock.yaml)。保留 Pi 0.85.1、Expo 57、根脚本、发布时间限制、安装脚本策略及原有 html2canvas/expo-camera patch；根 package.json 与开工快照逐字节相同。

| 实际路径 | 锁定变化 | 选择原因 |
| --- | --- | --- |
| MCP → express → proxy-addr | 2.0.7 → 2.0.8 | 同主版本修复信任子网判断 |
| React Native → react-devtools-core → shell-quote | 1.10.0 → 1.11.0 | 已发布的通告修复下界 |
| Vite/Expo → postcss → source-map-js | 1.2.1 → 1.2.2 | 同主版本修复索引偏移资源耗尽 |
| API/Agent → sharp | 0.35.4 → 0.35.5 | 连同平台包及 @img/sharp-libvips 1.3.4 更新 librsvg |
| Agent/Google GenAI → MCP SDK | 1.30.0 → 1.31.0 | 定向修复 OAuth 客户端信任，不整体升级 Pi/模型 SDK |
| remark-math → micromark-extension-math 3.1.0 → KaTeX | 0.16.47 → 0.18.7 | 只替换该父路径，复用应用已采用的渲染器版本 |

KaTeX 路径跨次版本：实际消费者只调用 `renderToString(value, options)`，需验证公式输出与 trust 约束；MCP、sharp 和其余补丁同样由[实际消费方回归](../../../../tests/unit/dependency-compat.test.ts)及完整构建验证，不以根目录 import 代替。

## 两项阻断的证据

- [node-forge 通告](https://github.com/advisories/GHSA-86w9-cpqp-85rv)影响 `<=1.4.0`，GitHub 当前 `first_patched_version` 为 null。注册表 latest 仍为 1.4.0，精确查询 1.4.1 退出1。实际父包为 Expo 57.0.23 → CLI 57.0.28 → node-forge，以及 CLI → code-signing-certificates 0.0.6 → node-forge；SQLite 经 drizzle-orm 可选 peer 也引入同一 Expo 链。CLI 的 iOS 证书读取使用 forge 证书对象；code-signing 库还使用 RSA/PEM、CSR、X.509 扩展和签名核验。
- [braces 通告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)影响 `<=3.0.3`，GitHub 页面标记 Patched versions: None。注册表 latest 仍为 3.0.3，精确查询 3.0.4 退出1。全部实际底层路径为 metro-file-map 0.84.5/0.84.6 → micromatch 4.0.8 → braces；分别由 Expo 的 @expo/metro 56.0.2（Metro 0.84.5）和 React Native CLI 的 Metro 0.84.6 引入。两份 watcher 调用 micromatch.some，micromatch 自身还导入 braces 并提供独立展开 API。

审计中的建议下界 `>=1.4.1` / `>=3.0.4` 与可发布版本不同。完整树、循环/去重关系保存在本机 `.runtime/merge-repair-2026-10-20/dependencies/remaining-paths.json`，原始审计也保留，未手工删减上报路径。

## 放弃的方案

查询最新父包元数据：CLI 58.1.13 和 code-signing-certificates 0.0.7 仍依赖 node-forge `^1.4.0`；metro-file-map 0.87.1 仍依赖 micromatch `^4.0.4`，micromatch latest 4.0.8 仍依赖 braces `^3.0.3`。因此上述父包升级本身不移除通告，未为此迁移 Expo/Metro。

旧版本也落入通告范围，降版没有修复依据。替换密码学库会改变 forge 对象/CSR/证书生成与验证接口，替换 glob 库会改变 watcher 与 micromatch API；这属于维护父库适配或 fork 的额外工作，不在本轮伪装为现成兼容更新。未修改这些接口、删除功能或制造改名包装。也未添加审计忽略项、降低级别、修改注册表响应或伪造版本。

进一步核对上游：[forge 修复 PR 1152](https://github.com/digitalbazaar/forge/pull/1152)仍为 Open，尚非已合并发布修复；[braces issue 70](https://github.com/micromatch/braces/issues/70)仍为 Open 且没有关联修复分支/PR。未把第三方回补或维护者对风险的争议作为审计通过依据。

## 后果与限制

两项未发布补丁原先阻断合并；完整复验后，用户在确认卡明确选择仅本次本地合并接受这两项high。它们继续列为修复待办，审计和CI不放宽，也不代表生产放行。未来替换需保留证书和glob功能并评审来源、接口及维护成本；本轮仅实施六项更新，不承诺上游日期。

## 验证

Node 24.19.0 下，`pnpm install` 退出0；随后 `pnpm install --offline --frozen-lockfile` 退出0。首轮出现旧 peer 路径的 Expo bin 警告，冻结安装无警告，随后真实 Expo/MCP/sharp 解析及数据库 Expo bin 存在性检查通过。

`pnpm audit --json` 和原样 `pnpm deps:audit` 均退出1：从2 critical、5 high、1 low降到两项high。该事实不因本次合并例外而改变。原始查询、日志和开工快照保留于 `.runtime/merge-repair-2026-10-20/dependencies/`；部分GitHub API请求遇到403，通告正文另由公开HTML核对，不将请求失败视为无漏洞。

全量类型、消费方/离线回归、三端导出和浏览器由主任务统一执行，实际成绩及用户确认归[本轮验收报告](../../../../docs/postmortem/2026-10-20-merge-repair.md)。依赖子任务只完成六项实施，另外两项尚未修复；未执行真实模型或原生二进制验收，本地合并不包含推送/部署。

2026-10-29补充：部分版本锁定和未发布状态由[本轮安全更新](2026-10-29-dependency-hardening.md)替代；其他原决策与当时验收范围保留。

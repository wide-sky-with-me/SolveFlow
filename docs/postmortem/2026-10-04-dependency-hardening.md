# 间接依赖安全更新与兼容验收

日期：2026-10-04。

范围：锁文件、构建工具与保留服务路径，承接 [页面发布复核](2026-10-03-ui-production.md) 的依赖缺口；环境使用 Node 24.19.0 / pnpm 11.7.0，无付费模型调用。

结论：五项间接依赖更新消除 17 条通告，兼容回归通过；当次审计仍有两条 high，退出 1，未达到安全审计通过条件。

后续 APK 与真机证据单列在 [0.1.73 安装验收](2026-10-04-android-install.md)，不计入本报告成绩。

## 变更与处理

原始审计为 19 条通告：6 high、10 moderate、3 low。通过 [workspace overrides](../../pnpm-workspace.yaml) 更新五个间接依赖，复审剩余 2 high、0 moderate、0 low。`pnpm deps:audit` 退出 1，不能声明安全审计通过。

| 消费路径 | 版本变化 | 消除通告数 |
| --- | --- | --- |
| Pi coding-agent → undici | 8.9.0 → 8.10.2 | 10 |
| Expo config-plugins → xcode → uuid | 7.0.3 → 11.1.1 | 1 |
| MCP / Ajv → fast-uri | 3.1.7 → 3.1.8 | 1 |
| MCP / express-rate-limit → ip-address | 10.7.0 → 10.7.1 | 2 |
| Expo / minimatch → brace-expansion | 5.0.9 → 5.0.12 | 3 |

Pi 0.85.1、Expo 57.0.22、React Native 0.86.3 及相机补丁保持。包记录比较只出现上述五项替换，其余 package 记录不变；pnpm 重新计算了部分可选 peer 路径。没有新增依赖种类，fast-uri 保持 BSD-3-Clause，其余升级包保持 MIT。保留最小发布时间和禁用安装脚本策略。

uuid 跨主版本只覆盖 xcode 3.0.1 的消费边；11.1.1 保留 CommonJS，实际 xcode 连续生成 100 个不同的 24 位大写 ID 通过。其他 override 限制在现有主版本或锁定父包。取舍见 [决策](../../.agents/notes/implemented/security/2026-10-04-dependency-overrides.md)。

## 验证结果

| 命令/检查 | 结果 |
| --- | --- |
| 新增 `dependency-compat.test.ts` 升级前 | 3 项均按预期失败：UUID 越界未拒绝、URI 大小写归一化、跨地址族判断；首次受限环境的 EPERM 单独保留，不计入复现 |
| 同一回归升级后 | 3 项通过，同时覆盖 xcode CommonJS 和正常 UUID/IP 行为 |
| `pnpm install --offline --frozen-lockfile` | 退出 0，锁文件可冻结安装 |
| `pnpm typecheck` | 退出 0，含共享包构建 |
| `pnpm exec vitest run --maxWorkers=2` | 99 文件 / 842 项通过，退出 0；允许本机回环和测试子进程，无真实模型 |
| `pnpm deps:audit` | 退出 1，准确保留两条 high |
| `pnpm --filter @solveflow/mobile build --source-maps` + `node scripts/check-build.mjs` | 退出 0，Android/iOS Hermes、Web 与本地答案资源通过；未编译原生包 |
| 默认 `pnpm --filter @solveflow/mobile build` + `node scripts/check-build.mjs` | 退出 0；源码映射导出归档到证据目录后，重新生成不含调试映射的常规产物 |
| `pnpm lint` / `pnpm docs:test` | 退出 0，边界检查与文档检查通过，14 项管理回归通过；管理回归首次受限执行失败，允许测试子进程后通过 |

新增独立 CI 审计作业，冻结安装后执行完整审计，任何通告或请求失败都不放行。隔离目录首次尝试跳过安装触发 pnpm 自动安装失败，已改为显式冻结安装；失败记录保留。本地验收不能替代 GitHub 远端执行记录。

7 份源码映射覆盖 Android/iOS、Web 入口及三个答案文档，未包含本次审计的七个 npm 包。首次按目录名搜索命中 Expo 自带的 `src/uuid`，核对后确认它不是 xcode 的 npm uuid 依赖；报告保存原始命中和按包路径判断的结果，不把同名目录当成依赖版本证据。此结论只覆盖这些包的装载范围，不是对全部内嵌代码的漏洞扫描。

设备 Agent 的 1,028 个构建输入同样无上述依赖，生成文件 SHA-256 在升级前后完全相同：`0e499bf904a166e14be0c7b4ba6118983ea25e5fd00ed23101fc2262d032ff7a`。本轮只更新 Node/构建依赖，没有改手机运行源码；未重新打包或安装 APK，报告对应阶段的手机包为 0.1.72，验收以 [存储报告](2026-10-03-android-storage.md) 为准。

原始审计 JSON、注册表查询、锁文件差异、回归及构建日志位于忽略目录 `.runtime/dependency-hardening-2026-10-04/`，源码映射产物在其 `source-map-export/` 下。

## 未验证项与剩余风险

以下版本可用性来自 2026-10-04 的注册表与通告查询，后续处理需重新核对：

- **node-forge 1.4.0**：RSA PKCS#1 v1.5 验签缺陷，来自 Expo CLI 与代码签名工具。审计建议范围 `>=1.4.1`，但当时查询注册表该版本不存在；[通告](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 标记无补丁版。它与 Android APK 的原生签名不是同一个实现，不能据此认定现有 APK 签名失效。
- **braces 3.0.3**：深层花括号模式可耗尽调用栈，来自 Metro 文件监控 → micromatch。`3.0.4` 当时同样未发布，[通告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 标记无补丁版。该调用方处理项目构建/监控模式，未发现题目输入到该解析器的链路；这属于范围判断，不是上游漏洞已修复。

两项继续列为正式发布待办。构建输入应来自已审项目，不把任意用户 glob/证书交给开发工具。待发布修复后替换锁定版本、重跑消费方与审计；本次没有自行修改密码学代码、使用未发布版本或设漏洞忽略名单。

未运行新 APK 安装、真机动画复测、实际模型或公网服务验收；剩余发布工作见 [发布状态](../project-status.md)。

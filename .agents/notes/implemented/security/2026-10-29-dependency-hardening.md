# 已发布安全更新与未发布合并库补丁

日期：2026-10-29。状态：implemented。范围：运行与开发依赖、Expo 消费方兼容、deepmerge 本地补丁。

## 背景

[提交前检查](../../../../docs/postmortem/2026-10-29-repository-consolidation.md)发现 35 项通告。沿用[限定依赖更新](2026-10-04-dependency-overrides.md)，部分替代旧笔记的 undici、fast-uri、ip-address 和[预合并修复](2026-10-20-premerge-dependencies.md)的 MCP 锁定；其余原约束继续有效。npm 注册表现已提供 node-forge 1.4.1，但 deepmerge 4.3.2 仍不存在。

## 决定

- 更新直接 Zod 4、Hono、MCP 与 Vitest 的修复版本；在 [workspace](../../../../pnpm-workspace.yaml) 对间接依赖按父包或原主版本限定覆盖，保持 Pi、Expo、React Native、jsPDF 本体及原补丁不变。实际解析由[锁文件](../../../../pnpm-lock.yaml)拥有。
- 仅将 Expo CLI 57.0.28 的 Zod 3 路径切至已采用的 Zod 4 修复版本。源码消费点为插件配置与工具 schema，实际解析合法数据、拒绝错误类型/额外字段由[消费方回归](../../../../tests/unit/dependency-compat.test.ts)验证，避免把全部 Zod 3 依赖强制升级。
- deepmerge 保留 4.3.1 和 MIT 许可，用[固定补丁](../../../../patches/deepmerge@4.3.1.patch)同步保护源码、CommonJS 与 UMD：拒绝 `__proto__`，复制第一个输入也经过危险键检查。保留普通递归、数组拼接、Symbol 与不修改输入语义；真实 Expo 消费方的两个发布入口均做回归。
- 保留 1440 分钟发布时间限制、安装脚本白名单、完整审计及原有图片/HTML 补丁。冻结离线安装必须能重现锁文件和补丁。

## 放弃的方案

不使用全量自动 fix 或升级整个 Pi/Expo 框架；不把通告建议但尚未发布的 deepmerge 4.3.2 写进锁文件，不降至通告范围外的旧版来回避问题。替换合并库会改变数组、自定义合并与模块接口，本次已有小范围可验证补丁，未引入另一套依赖或伪造包名/版本。

不为审计全绿忽略低危、排除开发依赖或降低 CI 门槛。补丁后的真实版本仍是 4.3.1，原始审计保留该低危通告，不能标成零漏洞。

## 后果与限制

deepmerge 补丁由仓库维护；上游发布后须核对修复并替换，审计门禁在此之前仍失败。Zod 3 到 4 的例外只适用于当前 CLI 消费点，父包更新后须重新评估。两条 Expo router-server peer 不匹配在升级前已存在，没有为本次安全更新扩大原生框架范围。

## 验证

升级前 Zod 集合检查与 deepmerge 原型污染两项失败，原有八项兼容通过；修复后新增消费方检查共十二项通过，类型检查与离线冻结安装通过。审计降至一项低危。全量、构建及浏览器结果和未验范围统一见[本轮报告](../../../../docs/postmortem/2026-10-29-dependency-hardening.md)，不以定向成绩代替设备或真实模型验证。

# Web授权失效与设备累计时间修复

日期：2026-10-08。范围：未提交源码、Web静态产物和原生共享代码。

## 实际问题

用户报告CAPABILITY_DENIED后，只读复制应用对应的IndexedDB目录到隔离位置，禁止该浏览器加载应用脚本或发模型请求。4条记录均通过现有读契约；最新批次创建于09:54:23 UTC，第三题运行09:54:34 UTC。解题HTTP401，约90毫秒进入失败，服务重启后的日志没有本轮上游派发。原网页持有重启前临时令牌；此次并非答题模型未回答。

[令牌更新](../../.agents/notes/implemented/architecture/2026-10-08-web-token-renewal.md)在模型请求前读取当前令牌，仅接受三组配置与原快照一致；读取5秒有界、可取消，不自动重放401或历史任务。用户旧页面需刷新一次加载新产物。

按用户明确授权，设备[累计时间不限](../../.agents/notes/implemented/agent/2026-10-08-unlimited-device-time.md)，校验和一次修正不再受先前180秒累计期限挤压。阶段、尝试、取消及响应字节限制仍保持有界；Android任务守卫与阶段期限分开生成。原生客户端源码共享该语义，本轮不改用户手机数据。

## 验证

- `pnpm build:workspace`：0，共享契约与各包构建通过。
- 首次全量`vitest run --maxWorkers=2`：1，117文件中116通过，1051项通过、1项失败。新夹具期望独立选择90秒但输入未指定brief，实际合法走普通45秒；修正为brief且空教学字段，保留超时、候选和220秒累计耗时断言。
- 定向`vitest run packages/agent/src/pi/mobile.test.ts apps/mobile/src/local/web-env.web.test.ts --maxWorkers=2`：0，2文件、68项通过；三角色令牌刷新、三组参数变化拒绝、取消与5秒读取上限均覆盖。
- 根`tsc --noEmit`：0；移动端首次2，由新测试RequestInit中显式undefined违反exactOptionalPropertyTypes导致，改为null后复测0，不放宽类型约束。
- `pnpm build:web`：0；3100静态目录已更新，无需重启用户服务。
- 最终`vitest run --maxWorkers=2`：0，117文件、1052项通过，包含超过180秒仍修正及完整核验、220秒累计时阶段超时保留候选、次数与取消边界。
- `playwright test --config playwright.functional.config.ts web-environment.spec.ts verification-feedback.spec.ts`：0，12项通过；独立3131服务、桌面与390px移动视口，三角色轮换后不刷新即可解题及校验，真实上游请求为零，重载不重放，临时令牌不持久化。测试服务已关闭。
- `pnpm lint`：首次长度2247、第二次2218均退出1；精简重复句和链接、不改2200门槛，第三次0，98当前文档、27决策、46源码锚点、108冻结文档。`git diff --check`：0。
- 用户3100页面与bootstrap均HTTP200，三组角色配置可读；仅GET检查、不输出令牌，没有重启服务。隔离只读应用数据副本已删除。
- `SOLVEFLOW_KOTLIN_IN_PROCESS=1 SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`（复用本机Temurin21）：0，Gradle 4m 39s。APK 0.1.76 / code77，17,341,790字节，SHA-256为`b68f7c9c612cbec2e85280d7089e5789cffce78ef4c2112abadcecf2e5b7256e`。签名、前包证书一致、内部资源与私密值扫描通过；产物`.runtime/artifacts/solveflow-arm64-local.apk`，未安装。生成的原生阶段上限180000ms，任务泄漏守卫3240000ms；构建不证明真机后台时序。
- `EXPO_NO_DOTENV=1 expo export --platform ios --output-dir ../../.runtime/ui-maintenance-2026-10-08/ios-unlimited-export`：0，共享Agent的Hermes和3个DOM文档导出通过；不是Xcode原生构建、安装或签名验收。

证据位于忽略目录`.runtime/ui-maintenance-2026-10-08/`。报告不保存临时令牌、密钥、题图或模型正文。

## 未验范围

没有执行本轮真实模型或准确率评测；浏览器移动视口不是手机后台验收。APK未安装；Mac此前SSH认证失败，未重新连接或构建iOS原生包。读取令牌与POST之间若再次重启仍可失败，保留人工重试。

# 批量独立队列与并发设置修复

日期：2026-10-09。范围：设备共享核心、设置界面、Android后台保护；浏览器使用合成题图与假模型，不重新计算生物准确率。

结论：修复前52张阻塞回归只解到11张；修改后52张与满额100张均可在校验暂停时完成解题，校验等待不占答题位。两组并发分别可调，配置、取消和浏览器交互已验证；Android测试APK构建与包检查通过，未安装手机。

## 变更与处理

两组并发由共享契约定义，默认答题5路、校验3路，每组1–8路。批量队列与引擎按同一设置派发，校验容量覆盖整批；接受任务总数仍有界。纠错与复核共用核验执行位，停止取消两条队列，不重放已保存答案。

设置页增加独立输入，旧设置缺字段使用默认值。原生/普通Web沿原设置保存；环境Web考试和并发以单一偏好写入，兼容旧考试键。保存失败保持原配置，保存期间与凭据准备期间的配置切换均阻止旧快照派发。

Android原先的Headless保持器、服务、启动请求和定时器分别有固定小容量，现统一从契约生成保护容量；等待校验的输入不占原生保护名额。长期取舍见[决策](../../.agents/notes/implemented/architecture/2026-10-09-independent-batch-concurrency.md)。

## 验证结果

首轮阻塞回归退出1，证据保留于`.runtime/queue-settings-2026-10-09/before.log`。调整默认并发后存储故障测试仍按旧三路断言，修正为按当前设置保留待解题并验证不会自动重放；延迟凭据夹具首次在等待后读取已清除的旧槽，改为模拟已读取但延迟返回，保留两轮记录。

最终定向Vitest命令为 `pnpm exec vitest run --project unit`，选取client的local-batch、local-engine、local-history、storage-recovery，contracts的local-settings，以及mobile的runtime、background-lifetime测试，`--maxWorkers=2`，97项通过，退出0。原生保护新常量首次复测未先构建dist导致失败，按项目入口构建后通过，首次日志保留。

`pnpm typecheck`退出0；`pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/queue-settings-2026-10-09/web`退出0。最终Web导出上，以独立回环服务45701运行Playwright的exam-flow、settings-role-validation和web-environment，桌面/窄屏16项通过，退出0。包含14题校验暂停、秒表、补图、默认/手调并发、非法值拒绝、刷新保持、令牌轮换与零自动重放。假供应商不代表真实模型准确率提升。

`pnpm lint`退出0，包含源码边界与文档检查；首次文档检查发现长度超一单位与决策反链缺失，精简并补链接后通过，未放宽策略。最终记录位于`.runtime/queue-settings-2026-10-09/`。

Web新入口在资产齐备后替换，保留旧哈希资产供已打开页面继续使用。确认3100当时未监听后恢复原本地服务，首页HTTP 200且与新产物哈希一致；新隐私浏览器在真实环境桥接下保存6/4、刷新保持，零模型POST，退出0。用户题目与原浏览器偏好未读取或覆盖；测试45701服务已关闭，3100服务保留供使用。

Android使用已有JDK17与SDK，`JAVA_HOME=/home/yhr/.sdkman/candidates/java/current SOLVEFLOW_KOTLIN_IN_PROCESS=1 pnpm mobile:apk`退出0，含Kotlin编译、内部签名、Hermes/本地资源和私密值检查。首轮卡在失效Kotlin守护进程的回环连接，线程栈留存；核实父子归属后停止本轮Gradle wrapper，首次退出1，重试用项目既有进程内编译选项，未改变源码或检查标准。包为0.1.77/code78，生成文件`.runtime/artifacts/solveflow-arm64-local.apk`，SHA-256为`fa1caa0e19f5abcb8bc38206c0a656a1771f78b84ab1655b7f062a80a4bdf390`。构建报告与本轮日志保留于忽略目录。

## 未验证项与剩余风险

本轮不修改模型校验判断；[生物批测](2026-10-09-biology-batch-acceptance.md)中的错答PASS、裁片质量误判和模型超时仍待修复。等待输入最多一个批次，内存上界高于旧小窗口，低内存设备满额未验。两条队列共享存储与供应商额度；存储故障仍一起停止。iOS原生、手机安装与真机后台验收单列，不以浏览器窄屏替代。

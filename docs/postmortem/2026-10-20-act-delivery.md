# ACT 收尾、真实核验复测与 Android 新包

日期：2026-10-20，Asia/Shanghai。基线：main `4f7f8d7` 及既有未提交 ACT 改动；本轮不提交、推送或部署。

结论：ACT 实现/资源的298份指纹与[前轮验收](2026-10-20-act-completeness.md)一致，沿用其成绩，不计为重新执行。Android 0.1.79/code80 已构建并通过包内文档检查，未安装。六例真实核验两轮共12次请求；修正测试入口后仍有错答PASS和截断，质量验收未通过。

## 变更与离线验证

`app.config.ts` 升至0.1.79/code80。核验回归脚本此前遗漏 `answerMode`，简答可能被要求补齐详细知识点；现在清单省略时用brief，可显式指定detailed，并在报告保存模式。两项隔离CLI回归用合成图片、临时.env和fake fetch，修复前2项失败，修复后2项通过，均有实际退出码1/0。

新夹具最初遗漏opt-in和脚本需要的只读产物路径，先修正夹具再取得上述产品缺陷复现；这些夹具失败不算模式缺陷。收集列表确认169文件：unit118、offline51，零交集；新增文件只归offline，其他分组规则不变。收集声明数不作为参数化用例执行数。

实际命令在仓库根目录、Node24.19.0/pnpm11.7.0执行，日志留 `.runtime/act-closeout-2026-10-20/`。

| 检查 | 结果 |
| --- | --- |
| `pnpm mobile:doctor` | 沙箱内子进程EPERM导致误报；正常进程权限下退出0，JDK/Android SDK齐备；本机无Xcode |
| `pnpm mobile:apk` | 首轮退出1，Maven Central TLS握手失败；经现有HTTPS代理、进程内Kotlin与单次Gradle重试退出0，证书校验保持 |
| `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.79.apk` | 首轮退出1，历史列表断言过时；按源码分别检查数字、读屏序号与移位后的时间，复验退出0，保留原断言语义 |
| `pnpm exec vitest run --project offline tests/unit/verifier-regression.test.ts --maxWorkers=1` | 修复后2项通过，退出0；真实CLI、fake供应商，无费用 |
| `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck` | 均退出0；共享产物由本轮APK构建准备 |
| `pnpm lint`、`git diff --check` | 均退出0，源码边界与文档检查通过 |
| `pnpm docs:test` | 沙箱内Node测试子进程退出1；正常进程权限下20项通过，退出0；两次日志保留 |

APK为ARM64内部测试签名，17,372,726字节；同前包证书，版本、Hermes、三份DOM文档、私密配置及播放器排除检查通过。SHA-256为 `8d3e664e9829d9a6bdca5d4db160afae71a366979be09abbacf8d63bed337c70`。包内Chromium检查涵盖公式、桥接、绘制就绪、240px布局和写作/化学/经济呈现，不代表Android原生合成器或真机。

## 真实核验与输入复核

用户明确授权同六例、最多12次请求。使用既有核验脚本、根.env解题配置deepseek-flash-guan，4096 token、非流式、供应商默认思考；不是Web已保存的校验组。网络守卫限定固定端点及累计12次；合成检查确认第13次和外部目的地被拒绝。实际两轮各6次，未增额。

原拍照路径不可用，改用已保存的同题官方清晰截图，六份哈希一致、27题真值与人工记录相符。首轮保留历史候选；第二轮显式brief并移除属于旧照片的裁框，不修改答案/选项。题21选项A正确，但D/E被转录为280而官方图为260，故完整候选应FAIL；保留首轮错误的正对照假设，不将两轮得分直接比较。

| 题号 | 第一轮 | 修正入口及输入后的第二轮 |
| --- | --- | --- |
| 7 | FAIL | FAIL，符合预期 |
| 12 | 截断 | FAIL，符合预期 |
| 15 | 截断 | 截断，无有效结论 |
| 18 | 截断 | PASS，错误候选仍被放行 |
| 21 | FAIL | FAIL，转录错误应被拒绝 |
| 23 | 截断 | 截断，正确对照未完成 |

第二轮3/6符合复核预期；两例截断均耗尽4096 token且无正文。不能视为新题准确率、原照片复现或ACT全科质量。清单、两份完整报告、计数和脱敏摘要留忽略目录；脚本两轮均因残余失败退出1，不重放。

## 设备与剩余范围

Linux ADB查询退出124；Windows ADB退出0、设备列表为空，未覆盖升级，查询启动的服务已清理。iOS已备排除凭据、题图和生成工程的本地源码快照；用户明确本轮先不推进Mac，未远程执行。

尚需Android升级/相机/分享/后台、iOS原生与真机、独立题集和实际Web校验组复核。未重跑全量Vitest/浏览器或依赖审计；前轮两项high继续列为待办。历史ACT成绩、内部签名与清晰图测试均不构成生产放行。

# TMUA / ESAT 跨科检查与 Android 安装

日期：2026-10-06。

范围：TMUA 两卷、ESAT 五个模块的学生方法及设备链路；Android 0.1.76 / code 77，iQOO Neo9（V2338A，Android 16）。模型测试均使用假供应商，没有发起真实付费请求。

结论：跨科规则冲突已修正，394 项离线回归通过；新版同签名覆盖安装，手机版本和 APK 哈希匹配，安装前后均为 177 道题。该包同时包含此前[生物、题号与题图修复](2026-10-06-biology-reliability-fixes.md)，不能据此宣称真实准确率提升或超时解决。

## 变更与处理

- [数学方法](../../packages/agent/resources/skills/math/SKILL.md)不再强制所有代数题额外读取参考；已加载考试规则覆盖时直接使用，未覆盖方法仍按需读取。定性读原图不强制计算或新增配图，决定答案的数值运算保留验算。
- [物理方法](../../packages/agent/resources/skills/physics/SKILL.md)移除“有数值就计算”的要求，并纠正“不支持箭头”的过时描述：当前线段支持 `arrow=true`，仍不支持专用电路元件。化学定性题也明确不强制计算。
- [ESAT 参考](../../packages/agent/resources/skills/exams/references/esat.md)补充下表易错检查；这些规则随考试上下文传给 Solver 和独立 Verifier，不复制为五套 Skill，不新增工具权限或模型路由。
- ESAT 与 [TMUA 参考](../../packages/agent/resources/skills/exams/references/tmua.md)统一服从系统选项规则：保留可见标签，完全无标签且文本/顺序清晰时才使用有说明的应用索引，局部模糊仍澄清。

| 检查范围 | 核对重点与结果 |
| --- | --- |
| TMUA Paper 1 | 定义域、合法变形、全部根、精确比较与数值枚举不能证明全称结论；已有规则保留 |
| TMUA Paper 2 | if/only if、必要充分、量词否定、反例和证明合法性；已有规则保留，统一选项规则 |
| ESAT Mathematics 1 | 补充连续/逆向百分比、加权均值、放回与独立性；保留单位和面积/体积倍率检查 |
| ESAT Mathematics 2 | 补充驻点不必为极值、闭区间最值比较端点；保留定义域、零值及丢根/增根检查 |
| ESAT Chemistry | 补充限制反应物、原子/离子的三种粒子数、速率与最终产量区分；保留条件和守恒检查 |
| ESAT Biology | 此前机制范围、风筝图、净变化和单/双链规则进入新包；保留看不清则澄清/UNKNOWN |
| ESAT Physics | 补充电路真实节点、开关前后与位移/路程；保留轴变量、SI 前缀、方向和模型条件 |

当前资源加载语义见 [Agent](../subsystems/agent.md)；本轮不延长总时限，也不自动换模型或重试。

## 验证结果

实际使用 Node 24.19.0、pnpm 11.7.0。

- 首轮新增回归报告 8 项失败：1 项复现物理 Skill 否认契约已支持箭头；另外 7 项误用了不属于该输出层的 `verificationStatus` 断言，改为既有 `verification.verdict` 后复测，没有改变 UNKNOWN 语义。首次日志外层 tail 命令退出 0，不作为 Vitest 通过证据。
- `pnpm build:workspace` 退出 0，重新生成学生资源并构建非移动包。
- `pnpm exec vitest run --project offline --maxWorkers=2` 退出 0：35 文件、394 项通过。新增七个组合各验证 PASS/UNKNOWN 两种分支，实际走受限 read 加载正文及参考，检查原图两端传递、模块快照、乱序原标签保留和数字题号无需额外格式修复；另补箭头说明与契约一致性。44 项考试文件测试属于 394 项，不重复累加。假输出不证明学科推理正确。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint` 退出 0；源码/文档检查通过。图片浏览器字节回归证据保留在此前修复报告，本轮未重复执行。
- `pnpm mobile:doctor` 退出 0。`pnpm mobile:apk` 使用已确认的进程内 Kotlin 编译及单次 Gradle，保留原 `GRADLE_OPTS`，退出 0，Gradle 用时 3 分 44 秒。签名连续性、版本、私密值和外部播放器排除检查通过。
- `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.76.apk` 退出 0：实际包内离线页面、公式、结构化学科显示、未验证状态、桥接及安全布局通过；这是 Chromium 检查。
- `python3 .runtime/exam-install-2026-10-06/check-skill-artifact.py .runtime/artifacts/solveflow-arm64-local-0.1.76.apk` 退出 0，直接在包内 Hermes 字符串中核对当前完整 SYSTEM、VERIFIER、ESAT/TMUA 参考及数学/物理/化学/生物 Skill 八份内容，确认并非旧资源。

### 本地备份与覆盖安装

手机本地“下载/SolveFlowReview”已有新两卷备份，大小分别 133,100,172 与 80,214,728 字节，末尾完成标记分别为 110、67 道题，总计 177；应用显示两卷导出完成。备份不包含模型设置或密钥，没有传到网络，也未读取其题目正文。

实际执行 `adb install --no-streaming -r`，日志返回 `Success`。安装界面助手在系统完成后切换前台时触发保护并退出 1，没有继续点击未知界面；未重复安装。随后独立只读核对手机版本、code 和 base APK 哈希，确认覆盖安装已成功；应用已启动，题目数量仍为 177，历史列表保留 1 道单题与 7 个批次（176 张题图），最近生物批次仍为 27 题。设置中 ESAT/TMUA/TARA 入口可见，没有编辑或保存设置，没有卸载或清库。

产物：`.runtime/artifacts/solveflow-arm64-local-0.1.76.apk`，17,297,326 字节；SHA-256：`283e53f2a34387d3373d97e82c1b7c3d1830813c2fc622d3aaf3478321f341c2`。构建、备份元数据、安装日志和脱敏 UI 证据保留在忽略目录 `.runtime/exam-install-2026-10-06/`。报告和发布状态更新后 `pnpm docs:check`、`git diff --check` 退出 0；清理本轮临时工具包装器和手机 UI 文件，未遗留测试服务。

## 未验证项与剩余风险

未执行真实模型复测、各科整套准确率或校验误放行率测量；不能把资源/协议回归当作真实答题成绩。原生 JPEG 编码字节、相机、分享、键盘、后台和全量备份恢复未在此包重测。此前约 40 秒的独立核验超时根因尚未解决，减少重复读取和格式修复只是减少可避免的耗时；第 3 题及其他题的超时仍需真实流进度证据。

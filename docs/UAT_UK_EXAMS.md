# ESAT / TMUA / TARA 考试增强

2026-10-02，按用户指定的 [UAT-UK Prepare](https://esat-tmua.ac.uk/prepare/) 研究并接入现有考试类型。实施决策见 [ADR 0022](adr/0022-uat-uk-exams.md)。

后续记录：[真实主机付费评测](UAT_UK_LIVE_EVAL_2026_10_02.md)、[0.1.65 前后端交叉审阅与修复](CROSS_REVIEW_0_1_65.md)。下方测试数量为首次接入时的历史记录。Pearson 仅为外部拍照题源，不属于应用或安装包。

## 三门考试的差异

| 考试 | 官方结构与特点 | 本项目增强重点 |
| --- | --- | --- |
| ESAT | 五个可考模块；Maths 1必考，多数课程另考两模块。每模块27道选择题、40分钟 | 数理知识在新情境中的应用；按题识别模块，检查单位、数量级、科学图表与选项，不把所有题都套成纯数学 |
| TMUA | 两卷各20道选择题、75分钟；分别考数学应用、数学推理，最终一个总成绩 | 必要/充分、if/only if、量词与否定、反例、证明有效性；精确代数和定义域，不能以数值试验代替证明 |
| TARA | 论证分析、问题求解各22道单选题；写作三选一、最多750词。三个模块各40分钟；作文不由UAT-UK评分 | 找结论/假设、评估证据与论证错误；基础数值和空间约束；完整写作覆盖命题、反对理由与立场，不生成假官方分数 |

以上结构分别依据 [ESAT概述](https://esat-tmua.ac.uk/about-the-tests/esat-test/)、[TMUA概述](https://esat-tmua.ac.uk/about-the-tests/tmua-test/)、[TARA概述](https://esat-tmua.ac.uk/about-the-tests/tara/)。三者均不允许计算器或词典，选择题答错不倒扣；这些规则不能让模型对看不清的题猜答案。项目可用受限calculate作学习验算，公开解法仍须适合手算。

## 核对的官方资料

- [ESAT Content Specification](https://uat-wp.s3.eu-west-2.amazonaws.com/wp-content/uploads/2024/05/03165424/ESAT_Content_Specification.pdf)：封面适用2026年10月与2027年1月；模块、Maths 1基础、科学单位及各科知识范围。URL中的2024不是当前文件版本。
- [TMUA Content Specification](https://uat-wp.s3.eu-west-2.amazonaws.com/wp-content/uploads/2024/05/03165619/TMUA_Content_Specification.pdf)：同一适用期；Paper 1/2、无公式册及Section 2逻辑、证明和证明错误。
- [TARA Content Specification](https://uat-wp.s3.eu-west-2.amazonaws.com/wp-content/uploads/2026/06/08142350/TARA_Content_Specification.pdf)：同一适用期；模块、基本数学范围和写作限制。
- [TARA Question Guide](https://uat-wp.s3.eu-west-2.amazonaws.com/wp-content/uploads/2026/06/08142344/TARA_Question_Guide.pdf)：七类论证题及选题式写作方法；仅提炼方法，没有复制官方例题。
- [Pearson官方练习入口](https://www.pearsonvue.com/us/en/uatuk.html)：核实三门样题入口。当前浏览工具无法进入跳转后的交互播放器；未声称完成其样题或获得官方成绩。TMUA单独Logic and Proof链接也未能成功读取，逻辑范围依据已读规范Section 2。

参考文件只保留必要的规则摘要，并加入项目自己的解题/核验检查方法；不内置历年题库、院校报名要求或日程，不按练习正确率换算官方成绩，不承诺准确率提升。

## 应用行为与文件

- `packages/contracts/src/exam.ts`、`local.ts`：新枚举、标签与设置说明；公开协议结构不变。
- `apps/mobile/src/components/settings.tsx`、`app.tsx`：首次配置、设置与使用说明支持新考试；按钮窄屏换行。
- `packages/agent/resources/skills/exams/`、`SYSTEM.md`、`VERIFIER.md`：三份方法和独立核验注意事项。
- `scripts/prepare-mobile-agent.mjs`、`packages/agent/src/pi/approved-skills.ts`：显式受审文件清单；自动生成的mobile-resources随源码同步。
- 沿用已有 `LocalEngine`：新题保存exam，批次保存同一考试；重开、追问、校验及导出保留原题快照。默认考试是背景，明确题面/用户更正优先；仅凭英文不能猜考试。

本轮没有扩大模型、工具、总预算或单题题数上限。旧设置/题目继续兼容；写入新枚举后不保证旧客户端可读。此前历史/备份优化的未提交改动保留，本次不据此宣称其额外真机验收完成。

## 验证记录

- 新考试回归先在旧实现上出现6项预期失败：枚举不接受新考试，预加载/解题输入无法进入新路径；实现后通过。
- `pnpm typecheck`、`pnpm lint`、`git diff --check`通过。
- 完整 `pnpm exec vitest run`：93个文件、795项通过，使用允许本机测试端口的执行环境。一次新增工具回归将指数写为`^`，与项目计算器协议不符；改为既有`**`后全量通过，没有更改工具实现或降低断言。
- `pnpm build`通过：服务端包、Web、Android/iOS Hermes及本地DOM/字体资源验证通过；该命令不是APK/IPA编译。
- `pnpm exec playwright test tests/mobile-e2e/exam-settings.spec.ts tests/mobile-e2e/batch-solving.spec.ts tests/mobile-e2e/manual-verification.spec.ts`：桌面/窄屏共20项通过。覆盖SAT既有路径、三门新考试的配置/重开/旧题追问、新题快照、批量与手动校验。
- 首次 `pnpm mobile:apk` 卡在Kotlin的旧守护进程回环连接；线程栈确认后只结束本轮Gradle进程。环境变量方式未生效；最终在忽略的生成工程 `apps/mobile/android/gradle.properties` 临时设置 `kotlin.compiler.execution.strategy=in-process` 后以 `pnpm mobile:apk` 重试，未改受版本控制的构建配置。最终构建通过：0.1.64 / versionCode 65，17,201,958字节，SHA256 `e845a8d6c70ab7d1a8ea46d8d3518111fa6c81bb869a8da4903d6174deb540e8`。签名一致、私密配置扫描、Hermes及本地DOM检查通过；另核对APK内含三份新考试参考。临时编译属性已在构建后移除。
- 用户明确当前不便手机测试，本轮不连接、不覆盖安装或操作手机。

上述测试使用模拟模型响应，验证资源加载与数据链路，不构成真实模型或官方题目准确率评测。没有付费模型调用，没有重跑服务端数据库集成（无服务端持久化改动），没有编译暂停的原生iOS。

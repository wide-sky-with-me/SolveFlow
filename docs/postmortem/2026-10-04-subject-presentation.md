# 写作、化学与图形的学科呈现验收

日期：2026-10-04 至 2026-10-05。

范围：共享答案契约、学生 Skill、设备追问与 Web 阅读界面；合成图片、离线模型夹具和真实模型小样本。宿主 Node 24.21.0、缓存中的 pnpm 11.7.0；仓库要求 Node 24.19.0，本轮未改版本约束，尚须在锁定 Node 环境复核。

结论：分层呈现和局部结构检查已落地，浏览器与离线回归通过。真实数学和经济样本通过独立模型核验，化学和写作有完整结果但核验超时；不代表整科准确率或手机安装验收。

## 变更与处理

| 层级 | 职责与修改 |
| --- | --- |
| 考试 | 继续由 exams 及对应参考限定题型、课程、语言和上限，不复制整套学科方法 |
| 学科方法 | 新增受审 writing Skill，组合现有 chemistry、diagram 等资源；设备仍只有 read/calculate |
| 作答结构 | writing 分离正文与点评；chemistry 表达最终反应式；figures 声明关键点、交点、区域面积 |
| 展示与检查 | 作文阅读区域、修订稿与点评分开；mhchem 排版、虚线和方向箭头；原子/电荷及图内数值关系由共享契约检查 |

作文点评后的修改沿实际引用链寻找原稿，限制十层，避免误用同题其他分支或后来版本；多题字段随题号投影。旧记录可缺少新增字段。正文词数和局部检查使用中性说明，不改变 verified；只有有效独立 PASS 才能标整题通过。

当前运行说明见 [阅读与绘制](../subsystems/rendering.md)、[解题资源](../subsystems/agent.md) 和 [答案版本](../subsystems/local-run-lifecycle.md)。方案取舍、兼容限制见 [决策](../../.agents/notes/implemented/agent/2026-10-04-subject-presentation.md)。

## 验证结果

命令从仓库根目录执行。默认 pnpm 启动器曾因用户目录只读锁失败；改用已缓存的指定版本，通过忽略目录中的 PATH 包装调用，没有安装或修改依赖。

| 实际检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 第一轮通过；新增测试曾因相对导入路径错误失败，修正后根 `tsc --noEmit`、移动端 typecheck 和共享包构建均为 0 |
| `pnpm exec vitest run --maxWorkers=2` | 103 文件、871 项通过，退出 0；后续新增结晶水渲染及原稿分支修正分别定向复测 |
| `node node_modules/vitest/vitest.mjs run packages/contracts/src/subject-presentation.test.ts apps/mobile/src/dom/math-render.test.ts --maxWorkers=2` | 9 项通过；包括未启用 mhchem 的故障复现、反应守恒和自交区域拒绝 |
| `node node_modules/vitest/vitest.mjs run packages/client/src/exam-context.test.ts --maxWorkers=2` | 3 项通过；完整原稿、同题版本分支与多题隔离 |
| `pnpm --filter @solveflow/mobile build:web` | 退出 0；只代表 Web 导出 |
| Playwright：subject-presentation、exam-materials、math-rendering、learning-content | 桌面/390 px 手机视口共 12 项通过；最终样式和版本链变更重跑 subject-presentation 的 4 项，不重复累计样本 |
| writing Skill 的 `quick_validate.py` | 通过；只代表资源格式有效，加载与协议行为另有测试 |
| `pnpm lint` / `pnpm docs:check`、`git diff --check` | 退出 0；初次文档检查发现决策相对链接多一层，修正后通过 |

回归还覆盖有界格式修复、模型工具数量不变、旧记录读取、完整材料、Markdown/公式和局部检查不冒充独立校验。

### 真实模型与实际显示

沿用已有付费授权，配置中的 qwen3.8-flash 执行四道自制图片题；不是官方试卷、真实拍照或手机运行。首轮 16 次 HTTP 请求，数学人工复测 4 次，共 20 次派发；未从请求数推算费用。

| 样本 | 实际结果 |
| --- | --- |
| 数学 | 首轮流式网络中断，MODEL_UNAVAILABLE；复测 47.8 秒，点 (2,4)、斜率 4、两项图内检查及独立 PASS，数值与解析真值一致 |
| 化学 | 40.4 秒；Fe³⁺ + e⁻ → Fe²⁺，物种、原子和电荷正确，独立核验 MODEL_TIMEOUT，verified=false |
| 经济 | 60.9 秒；Q=5、P=5、消费者剩余 12.5 美元，三项图内检查和独立 PASS；说明文字提到的供给线颜色与实际灰色不一致，局部检查不覆盖自然语言颜色描述 |
| 写作 | 66.9 秒；完整英文正文 206 个英文词，无夹杂中文或自报词数，writing=composition；独立核验 MODEL_TIMEOUT，没有人工评分或官方评分成绩 |

四份真实答案通过隔离 IndexedDB 在 390 px 浏览器展示：公式无源码回退、无页面横向溢出、无 pageerror；实际检查了正文、反应式、函数图与深色经济图。初次截图有开屏遮罩，后改为等待排版和字体就绪再截图；不能把 DOM 可见断言等同于最终画面已经稳定。

原始结果、请求诊断、命令日志、截图及本次服务 PID/URL 保存在忽略目录 `.runtime/subject-presentation-2026-10-04/`，未进入版本控制。记录失败和复测分开保存。

临时服务记录为 PID 3406156、端口 45027；结束后进程与监听口均已不存在。HTTP 超时不作为关闭证据。

## 未验证项与剩余风险

- 化学/写作的独立核验超时仍存在，不能用展示通过代替校验通过；数学网络失败也保留。
- 结构检查只覆盖声明内容；不证明模型读题正确、化学反应可行、图文全部一致或论证正确。写作流畅不等于事实可靠。
- 不包含符号 CAS、单位推理引擎、复杂分子结构绘制、任意图形执行或官方作文评分。
- 未新打包 APK、未安装或做真机长文性能测试；移动视口不是 Android WebView 验收。旧包不保证识别新字段，降级须使用匹配版本备份。

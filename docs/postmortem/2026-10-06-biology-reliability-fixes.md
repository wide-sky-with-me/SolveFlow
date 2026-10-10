# 生物 Skill、题号格式和题图处理修复

日期：2026-10-06。

范围：当前工作区的学生资源、共享生成结果边界、设备/保留服务适配，以及单题裁切图保存。依据[生物复核](2026-10-06-biology-batch-review.md)，使用假供应商、合成图片和隔离浏览器验证；没有真实模型调用。

结论：修复手机 Skill 引用路径不匹配、可选题号元数据导致多余格式修复请求、裁切后的单题保存再次压缩 JPEG；补齐生物机制、图表及无标签选项规则。离线行为通过不代表真实正确率提升，独立校验超时根因尚未修复。

## 变更与处理

- [手机资源生成](../../scripts/prepare-mobile-agent.mjs)把受审正文中的固定服务 Skill 前缀转换为设备白名单前缀，服务器源资源保留原路径。没有新增 Skill、依赖或工具权限。
- [生成题号兼容](../../packages/contracts/src/model-output.ts)只将非负安全整数转为字符串、null/空白省略，最多四题；在[设备](../../packages/agent/src/pi/mobile.ts)和[服务](../../packages/agent/src/pi/phase-runner.ts)的严格候选检查前使用，保存及历史读取契约不变。不能推断原失败值的类型，因为原始响应未保存；复现覆盖几种常见格式。
- [生物 Skill](../../packages/agent/resources/skills/biology/SKILL.md)、[ESAT 方法](../../packages/agent/resources/skills/exams/references/esat.md)及[Verifier](../../packages/agent/resources/VERIFIER.md)补充机制范围、风筝图两个维度、丰富度/密度、种群净变化及 DNA 单双链分母检查，没有写入原题答案。各课程 Skill 的选择题结论、简洁输出和批量校验时机服从系统规则，定性比较不强求计算。
- [系统提示](../../packages/agent/resources/SYSTEM.md)明确 `sourceNumber` 是字符串或省略。无可见标签但全部文本/顺序清晰的题使用有说明的应用索引；可见标签不可重编号，部分信息模糊仍须澄清。
- [图片平台](../../apps/mobile/src/platform.types.ts)仅给已规范化图像内存标记；[保存操作](../../apps/mobile/src/workspace/use-workspace-actions.ts)复用裁切预览的 JPEG，保留其所有权至状态释放，避免重复压缩及保存失败后预览失效。未经处理输入仍裁切/缩放、去除 EXIF，并检查尺寸与字节。既有补图两端传递保持。

长期取舍见[题号与路径决策](../../.agents/notes/implemented/agent/2026-10-06-skill-paths-and-source-number.md)，当前行为见[Agent](../subsystems/agent.md)和[图片交互](../subsystems/rendering.md)。

## 验证结果

### 修复前复现

- `pnpm exec vitest run --project offline packages/agent/src/pi/mobile.test.ts -t 'normalizes optional generated sourceNumber' --maxWorkers=2` 退出 1：五种可选元数据值均使模型调用从一次增至两次。
- `pnpm exec vitest run --project offline packages/agent/src/pi/mobile-exams.test.ts -t 'embedded course references' --maxWorkers=2` 退出 1：手机正文仍含服务路径。
- 既有 Web 产物的桌面隔离浏览器中，裁切预览和保存题图的 JPEG 摘要不一致，新增回归退出 1。测试最初尝试 fetch Blob 被既有 CSP 阻止；改为测试内记录本地编码 Blob 后才复现字节变化，没有修改产品 CSP 或放宽断言。

### 修复后检查

实际使用 Node 24.19.0、pnpm 11.7.0。

- `pnpm build:workspace` 退出 0，重新生成资源并构建全部非移动包。
- `pnpm exec vitest run --project unit packages/contracts/src --maxWorkers=2` 退出 0：10 文件、115 项通过，含题号不可变性、多题、类型边界、实质答案错误和严格持久化契约。
- `pnpm exec vitest run --project offline --maxWorkers=2` 退出 0：35 文件、379 项通过，含两种协议、服务消费方、受审资源、补图传递、预算、取消、核验覆盖、格式修复和权限。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` 退出 0。

- `pnpm --filter @solveflow/mobile build:web` 退出 0；这是 Web 构建，不是 APK。
- 最后两处学生规则措辞调整后重新生成、构建 Agent，定向运行 `mobile.test.ts`、`mobile-exams.test.ts`、`course-skills.test.ts`、`phase-runner.test.ts`，4 文件、120 项通过，退出 0；这些项包含于既有离线范围，不与 379 项相加。
- `pnpm docs:test` 受限环境首次退出 1，只报告文件级失败；同命令允许本地测试子进程后复测退出 0，20 项通过。
- `pnpm lint` 退出 0，包含源码边界和文档检查；`git diff --check` 退出 0。

浏览器使用本轮独立静态服务的随机回环端口，桌面及窄屏隔离存储，命令 `pnpm exec playwright test tests/mobile-e2e/workspace.spec.ts tests/mobile-e2e/exam-materials.spec.ts --reporter=line` 退出 0，12 项通过；含裁切后保存/重载的 JPEG 字节摘要相等、相册拒绝伪图片、旋转、补图保存无请求、追问及重载。复跑不累计为新样本；测试图片仅为自编合成图。结束后释放本轮服务和临时工具包装器。

## 未验证项与剩余风险

没有真实模型复测、整卷准确率/校验误放行率、新 APK、覆盖安装或真机原生图片处理复测。Android/Web 共用照片标记和提交生命周期，但浏览器字节检查不能证明原生 JPEG 编码器行为。需在新包和固定授权题集上独立验证，不使用离线通过推断第 8、16 题已被模型答对。

本轮没有延长期限、自动重试、切换模型或增加图像上限；此前校验跑满约 40 秒的原因仍需流进度诊断及真实测试。其余错题、网站提交映射差异也未由本轮规则变化自动解释。

后续 0.1.76 的打包、覆盖安装和 TMUA / ESAT 跨科核对见[跨科与安装验收](2026-10-06-exam-skills-and-android-install.md)；本报告保留此次修复时的验证范围。

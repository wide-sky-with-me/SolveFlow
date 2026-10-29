# 多考试视觉疑点局部复读验收

日期：2026-10-26。

范围：设备自动核验后的既有纠错流程，Web实际裁片、原生实现的类型核对；全部模型响应为合成夹具，没有新增真实付费请求或远程Mac部署。

结论：通用、ACT、SAT、AP、ESAT、TMUA、TARA共用视觉区域协议。578项扩大回归与40项桌面/手机视口浏览器检查通过；真实识别改善、原生真机及保留服务局部裁片未验。

## 变更与处理

[核验issue](../../packages/contracts/src/agent.ts)新增可选原图区域。[设备适配](../../packages/agent/src/pi/mobile.ts)在一次纠错中生成至多两个局部放大图，最终独立复验复用，不新增模型阶段或重试。完整原图及所有补图保持顺序和字节；局部位置不清、来源不存在、没有坐标或裁片不可用时仍使用完整原图。取消优先，准备10秒上限计入纠错窗口，仍保留既有8MiB图片预算。

Web用本地Canvas、原生用现有图像处理SDK，无新增依赖或OCR供应商。裁片仅辅助辨认单元格/行列、标点、高亮、符号、图例与单位；不改变核验门槛，不自动认可核验建议的文字。裁片生成失败有脱敏诊断。诊断图片数计入最多8张原始材料及2张辅助图，原始材料数量上限未变。

运行语义及兼容见[局部复读](../subsystems/image-review.md)，取舍见[决策](../../.agents/notes/implemented/agent/2026-10-26-local-image-review.md)。本功能回应[前次实图诊断](2026-10-26-act-material-diagnosis.md)的视觉误读风险，不能以本次合成成绩证明真实准确率提高。

## 验证结果

Node24.19.0、pnpm11.7；命令在仓库根执行。日志、基线源码快照与完整参数保存在忽略目录`.runtime/local-image-review-2026-10-26/`。

| 实际命令 / 检查 | 结果 / 退出码 |
| --- | --- |
| 修复前`pnpm exec vitest run packages/contracts/src/agent.test.ts packages/agent/src/pi/mobile-image-review.test.ts` | 8失败、64通过 / 1 |
| `pnpm build:shared` | 共享构建通过 / 0 |
| `pnpm exec vitest run`限定Pi、编排、契约、材料/历史及裁片测试；完整参数见`verification.json` | 43文件、578通过 / 0 |
| `pnpm typecheck`及新增边界测试后的`pnpm exec tsc --noEmit` | 共享、API、移动端与测试类型通过 / 0 |
| `pnpm --filter @solveflow/mobile build:web` | Web构建通过 / 0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45184 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/act-flow.spec.ts tests/mobile-e2e/batch-materials.spec.ts` | 桌面/手机视口40项通过 / 0 |
| `pnpm lint`，包含`pnpm docs:check` | 边界、文档与冻结资料检查通过 / 0 |

离线覆盖七种考试、主图/补图来源与全部原图保留、两区域和字节预算、8原始材料加2辅助图的真实图片数诊断、10秒准备期限、取消、生成失败回退、UNKNOWN与历史校验不自动修正，以及最终仍FAIL时不增加重试。

新浏览器场景通过真实补图界面触发自动重答，检查指定补图裁片的颜色和放大尺寸、纠错/复验使用相同JPEG字节、四次模型请求而无额外调用。裁片不作为新增材料保存，旧答案与原图仍保留。其他ACT原文、选项、批量复用、导出与样式场景保持通过。

扩大回归首次在沙箱中因本地socket/子进程权限产生30失败、547通过；获准环境复测后通过，未修改对应断言。开发期发现浮点边界多取一像素并修复；另将夹具中的全文字符串检查改为准确检查结构化辅助图字段。首次失败日志保留。

## 未验证项与剩余风险

真实模型能否准确给出坐标、对这批屏摄照片的识别改善及耗时变化未实测。裁片不恢复原图缺失、反光或失焦信息；没有坐标仍走原有路径。ACT转录错误仍输出完整可见转录，未实现按字段增量补丁。

原生裁片实现已通过类型检查，未进行Android/iOS真机、后台取消与SDK缓存释放验收；不能将浏览器手机视口成绩当原生成绩。保留服务未接入本地裁片回调；主动校验另建备用重答尚不复用上次核验定位。未部署远程Mac，未更改用户模型配置和历史。

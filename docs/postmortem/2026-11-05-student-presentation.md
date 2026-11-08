# 手机拍题界面与题目状态细化验收

日期：2026-11-05。

范围：`feat/public-photo-web`本地未提交改动，基于[前轮逐题流程](2026-11-05-student-manual-flow.md)继续调整。使用隔离PostgreSQL 17.11、合成题/图片、假模型及Chrome/Linux WebKit。

结论：已实施确认后的布局、状态、公式及原图操作；各分组最终160项通过，公式单元6项通过。WebKit结束状态仍有一次失败记录，不能以复测通过宣称已修复。没有提交、推送或部署，腾讯云与main未更新。

## 变更与原因

- 移除学生常驻全场统计卡、跳过本题按钮；题目总览从常驻答案表收进右上弹窗。拍摄区底部为上下题，处理中在中间显示停止作答；相册/补图居中。当前答案与稳定题位一致，节末入口沿前轮规则。
- 原导航只按`completedOnce/skipped`着色，已排队题和重拍后的题可能看起来未拍或已完成。学生总览、教师导航改用共同的当前run/presentation映射，问题标记独立保留；教师已答按当前有效答案计数。
- 中心富文本未接入完整版的公式定界符处理，Markdown会把模型的行内公式当普通文本。将纯规范化函数提升到contracts公共辅助入口，客户端原入口重导出，默认语义不变；中心题干/选项/答案统一规范化，额外支持带已知TeX运算符的简单算式。金额、代码和原始保存内容不改，非法公式不猜补。
- 原图移除大工具栏，保留手势/滚轮/键盘缩放、角落重置和全屏。重置同时归位大小与滚动位置；原图升级显示小图标，失败仍可重试，权限缓存及渐进替换不改。

当前语义归[学生流程](../subsystems/managed-student-flow.md)及[图片/公式展示](../subsystems/managed-exam-answers.md)，取舍归[决策](../../.agents/notes/implemented/rendering/2026-11-05-managed-student-presentation.md)。

## 验证结果

证据位于忽略目录`.runtime/student-refinement-20261105/`。

- 新增浏览器初检4项失败：布局2项复现冗余统计；另2项因合成详情漏subject而未读到题干，已修正夹具，不能把这两项记为公式缺陷的有效复现。规范化抽取时出现正则转义错误，构建和单元未通过；修正并重建后恢复。
- `pnpm --filter @solveflow/contracts build`退出0；`pnpm exec vitest run --project unit packages/contracts/src/math-text.test.ts packages/client/src/math-delimiters.test.ts`6/6、退出0（`math-unit-2.log`），覆盖保留客户端行为、定界符、算式、金额、代码和文件路径。
- `pnpm --filter @solveflow/exam-web build`和包类型检查退出0（`build-4.log`、`typecheck.log`）。定向隔离Chrome/WebKit新增4/4、9.05秒、退出0（`targeted.log`），验证处理中状态优先、只取消所选题、金额及5处公式实际生成KaTeX。
- 完整分组首次基础44/44、交互69/69、边界16/16、临时拍题5/5通过（`full.log`）；计时17通过、WebKit主动结束后“考试已结束”未显示1项失败，脚本退出1并未执行分配组。服务端已确认结束，未改断言或扩大等待，不能声称端到端稳定。
- 人工截图发现横向原图居中仍有大空白。新增手机图片距视口顶部不超过20px断言，四个角色/浏览器原图用例均失败（`image-top-red.log`）；改顶部对齐并修正缩放锚点/滚动区域，重置与全屏放进标题栏，不遮图片。最终相关18/18、30.39秒、退出0（`final-ui-2.log`），含比例、拖动、重置两轴、全屏、授权、错误重试、当前题及公式。
- 最终分配8/8、9.94秒及计时18/18、36.68秒、退出0（`final-groups.log`）。计时仅补诊断、保留原断言；本次WebKit主动结束显示失败原因仍未定位。各组44+69+16+5+8+18共160个不同用例，重复复测不累计。
- 旧测试按确认布局改为总览、手动翻题和键盘缩放，保留语义断言。客户端包、最终中心构建及类型、移动端类型均退出0（`client-build.log`、`build-final-2.log`、`typecheck-final.log`、`mobile-typecheck.log`）。本轮未产APK/iOS包，未做真机验收。
- 截图覆盖320/390/768/1440主页面及总览、双主题和两种浏览器，自动检查无横向溢出；另补处理中/失败状态和320/390/1280数学页面，对应4项复测退出0（`visual.log`）。人工复核手机主页面、混合状态总览、公式及原图标题栏。证据在`screens/`及`.runtime/silent-refresh/original-*-mobile.png`，不声称逐像素检查全部页面。
- `pnpm --filter @solveflow/exam-web typecheck`及`pnpm lint`退出0（`typecheck-complete.log`、`lint-complete.log`），含类型、源码边界和文档检查；`git diff --check`退出0。收尾统一活动任务对旧跳过标记的优先级，“已跳过”提示也不计活动题；构建退出0（`build-complete.log`），对应4/4、10.41秒、退出0（`complete.log`）。

## 未验证项与风险

未调用付费模型、上传真实学生题图或修改生产数据。WebKit移动视口不代替iPhone真机拍照与手势。本轮复现WebKit主动结束后状态显示不同步，与[已有截止提醒偶发延迟](2026-11-04-exam-allocations.md)均待定位；复测不等于修复。复杂无定界符或已损坏公式保留安全回退，不修改原答案。

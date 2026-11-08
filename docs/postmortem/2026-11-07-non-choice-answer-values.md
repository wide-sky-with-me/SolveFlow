# 填空答案高亮与总览预览验收

日期：2026-11-07。

范围：`feat/public-photo-web`本地工作区，隔离PostgreSQL 17.11、Chrome/WebKit，合成图和假模型。保留其他未提交改动，未部署腾讯云或修改账号。

结论：5项新增隔离/浏览器、37项原答题交互、21项单元通过，已检查手机/桌面明暗截图；构建、类型与文档检查通过。无真实模型调用、真机或公网性能验收。

## 原因与处理

原始模型结果已有结构化短值，但考试快照只带答案解释，总览把解释开头截断，造成填空题出现“数据已…”等文字。当前答案卡也只对选择题字母高亮。

快照按显式能力头投影当前发布run的短值，默认旧字段集不变；人工答案与模拟答案不继承原始值。学生页和总览共用摘要，优先结构化值，兼容旧文本明确结论；不从计算步骤猜答案。普通文字按纯文本显示，公式单独渲染，不在导航格里嵌套链接。无迁移、第三方依赖或新增模型调用。

## 验证结果

证据位于忽略目录`.runtime/nonchoice-answer-20261107/`。两次早期夹具缺少既有契约必填的warning或selectedOptions，均在初始化阶段失败，不计为产品复现。修正夹具后，旧构建的5项均按预期失败，见`integration-repro-valid.log`；新构建首轮5/5通过。

覆盖结构化数值29、文字chlorophyll、负分数、旧文本公式、人工把7改为41、重拍从7变42、非填空长文回退、旧客户端字段兼容、跨学生拒绝，以及导航按钮内不生成链接。Chrome/WebKit均采集320/390/1280宽、明暗主题截图，检查页面横向溢出、浅绿/浅黄、总览当前题蓝色和原有问题状态。

`pnpm build:exam-web`及最终Web构建退出0；首次构建遇到exactOptionalPropertyTypes不兼容，已在辅助入参明确允许缺省undefined，未放宽编译选项。最终`node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23 --suite=answers`为5/5，`--suite=core-flow`为37/37，见`final-regression.log`。定向Vitest两个文件21/21，`pnpm exec tsc --noEmit`退出0。`pnpm lint`包含源码边界与文档检查，退出0；`pnpm docs:test`20/20。新增answers组保留原180秒限额，所有数据库与服务均为自建临时资源，退出清理。

## 产物与限制

截图在证据目录`screens/`，运行行为归[答案预览](../subsystems/managed-answer-previews.md)。无法可靠提取的旧文本继续保留全文，总览提示查看；不制造答案或核验通过标记。WebKit不是iPhone真机。远程仍为原版本，本轮未发布。

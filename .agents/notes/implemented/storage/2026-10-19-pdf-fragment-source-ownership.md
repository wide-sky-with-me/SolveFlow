# 冻结正文在来源文档创建片段

日期：2026-10-19。状态：implemented。范围：Web逐题帧片段创建者，保留完整来源与深克隆；仅源码候选，未部署，整体流畅性尚未验收。

## 背景

[逐题接入](../../proposed/storage/2026-10-18-pdf-frame-question-materialization.md)保留全部页壳与冻结正文。原先在iframe文档创建片段，冻结时会迁移所有未来正文，首题又回填来源树后接入帧。[私包阶段诊断](../../../../docs/postmortem/2026-10-19-pdf-fragment-ownership-probe.md)显示单改创建者可缩短冻结与首段同步区间，但接入成本上升，建帧前等待未建立改善，不当作整体流畅性结论。

## 决定

[建帧](../../../../apps/mobile/src/local/print-batch.web.ts)改用clone的ownerDocument创建片段；所有题在资源等待前冻结。首题/后页接入时只迁移当前正文，保留页壳、正文及页脚身份。消费后的空DocumentFragment仍属于创建文档，迁移的是展开子树；离线Chrome154对append和appendChild的观察校准了测试模型，不沿用“片段本体也迁移”的审查假设。

## 放弃的方案

保留iframe创建者是完整对照，提前迁移未来正文、结构简单；选择来源创建者仅延后迁移，不声称减少全部工作。按题新建iframe或改React来源接口会改变位置或扩大数据/回调契约，本次不实施；既有完整来源与深克隆成本仍在。

## 后果与限制

字体及images仍读取iframe文档；每次接入后等待，再检查存活并适配。维持[资源绝对截止](2026-10-18-pdf-resource-handoff.md)、单份期限、取消优先、后页错误使整份失败及晚结果隔离。Host字体不决定frame结果，零decode不证明零网络请求。释放断引用不承诺物理回收所有外部持有片段。

## 验证

[题页回归](../../../../apps/mobile/src/local/print-frame-pages.test.ts)补双文档、递归子树adoption、树派生图片与独立decode身份、字体隔离、初始/后页取消及释放后的晚资源组合。旧实现先记录创建者契约红期，再单改创建者。当前源码全量、类型检查、完整构建及原生字体等待/失败/取消重导出与保真见[源码复核](../../../../docs/postmortem/2026-10-19-pdf-fragment-source-ownership.md)；只支持该归属边界，不替代未加诊断交互、初始字体、图片网络/URL、跨浏览器或生产验收。

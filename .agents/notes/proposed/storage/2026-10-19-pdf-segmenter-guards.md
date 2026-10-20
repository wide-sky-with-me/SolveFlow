# PDF 分词复用的环境门禁

日期：2026-10-19。状态：proposed。范围：Web PDF 的隔离原生分词器后继，不是已实施功能。

## 背景

[单次作用域提案](2026-10-19-pdf-native-segmenters.md)的固定环境保真成立，但构造器/locale变化有反例，整批时延方向混合。旧文与证据冻结；本提案仅推进失效与清理设计，不覆盖旧成绩或确认收益。

## 决定

隔离生成入口的历史路径为 `.runtime/pdf-production-2026-10-16/make-segmenter-guard-r90-v2.mjs`（2026-10-20核对时已缺失）。显式开关true后，用own-data描述符与原生函数形式保守筛选；构造器、segment方法、辅助能力或默认locale改变时退回/失效。新建原生NumberFormat取得默认locale，每Context最多保留两个Segmenter，另有逐调用临时Intl对象。

继承localeMatcher或改写segment时保持fresh构造与自身错误；辅助探针异常后当前Context锁停。发布缓存前再查封闭状态；实际onDispose/finally清空字段并封闭，不跨任务共享实例或迭代器。

## 放弃的方案

- 只比较构造器identity：遗漏固定包装器内部变化和原生默认locale热变。
- 直接复用或把Segmenter options换成空原型：会跳过继承getter，改变原有异常行为。
- 把原生toString当作可移植品牌检测：规范不保证Proxy必须匿名；仅保留目标Chrome已验边界。
- 用旧微基准或固定环境保真接入：新探针新增临时构造与反射成本，必须重测，仍需新整批证据。

## 验证

三入口环境矩阵、CDP真实locale转换、实际回调字段清理及重入helper后继均通过；局部合成成本改善不等于整批吞吐或UI流畅。详见[本次报告](../../../../docs/postmortem/2026-10-19-pdf-segmenter-guards.md)。

## 后果与限制

采样非原子，任意改写的内建与跨引擎形态尚未建立等价。候选不进入产品补丁/锁文件，不更新当前服务；正式采用前需可信原生环境契约、完整产物/整批/交互/跨浏览器验收，稳定收益不足则转回主线程热点。

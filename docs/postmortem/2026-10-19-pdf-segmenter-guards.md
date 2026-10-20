# PDF 分词复用的环境失效与实际清理

日期：2026-10-19。

范围：html2canvas 1.4.1 隔离后继；Chrome 154，合成多语料与 Canvas，UMD/原生ESM/min；无应用、原始QA档案、付费调用或新PDF。

结论：修正版覆盖已测构造环境、原生locale热变及实际缓存字段清理；局部成本仍较低，但未建立新整批收益。候选未接入源码、补丁、锁文件或现有页面，生产验收继续开放。[前次整批证据](2026-10-19-pdf-native-segmenters.md)保持冻结，成绩不外推。

## 变更与处理

仅显式开启后探索复用。Context独占缓存，比较构造器/方法及逐调用新建 NumberFormat 的默认locale；环境变化清空两个粒度。属性访问器、非原生形式、继承的localeMatcher或改写的segment方法退回原构造表达式，保留构造器自身的异常。原生字符串筛选是启发式，不是跨引擎品牌认证。

只读审查提出重入封闭后晚发布风险；先生成v2并完整复测，再用同一helper反例复现v1晚填缓存、验证v2发布前复查关闭状态。v2还在辅助探针异常后锁停当前Context探针，实际dispose/finally清空缓存、元数据与锁停标记。两次生成及后继派生均有精确逆变换；未修改安装依赖。

## 验证结果

证据均在 `.runtime/pdf-production-2026-10-16/`，v1结果独立保留。v2的生成、下列四阶段与补充测试退出码均为0：

- `check-segmenter-guard-r90-v2.py --phase matrix`：14场景×3入口，42组双臂比较通过，包含删除/抛错替换、固定包装器、真实Proxy/bound/revocable、构造器与辅助能力getter、options继承getter、接收者敏感方法及关闭路径。Getter次数、错误对象哨兵及输出分别比较。前次名为stable-proxy的用例实际是普通function；本次才独立覆盖真实Proxy。
- `--phase locale`：每入口同页/同Realm/同Context，经CDP依次en_US→th_TH→ja_JP→恢复。原生构造器/方法身份不变，fresh与缓存两粒度的resolved locale一致；3次转换均清两缓存，阶段内复用保持。navigator.language仍en-US；不声称它发生变化。
- `--phase render`：三入口各双臂成功/取消，12次合成实际渲染调用。3组成功Canvas像素SHA一致；候选取消前两个粒度均已缓存，真实注册的onDispose回调清空并封闭，成功finally也清空；框架与画布登记归零，原始取消哨兵保持。取消由测试回调触发，非可信用户指针，不证明原生对象已被GC。
- `--phase bench`：CPU4、12条合成语料，每块2400调用，交错各4块。word对照/候选中位164.20/117.95 ms，grapheme118.30/108.50 ms，分别下降28.17%/8.28%。包含分词、数组、校验与探针，非构造器独占或PDF提速；每调用仍新增临时NumberFormat/结果对象。
- `check-segmenter-edges-r90.py`：三入口均复现v1 helper重入晚填反例并通过v2；辅助探针失败后不再缓存、缺省/false/封闭零辅助能力描述符访问、同Realm双Context隔离通过。重入是修改反射函数的helper模拟，不替代上一项的实际回调测试。

## 未验证项与剩余风险

默认locale哨兵有[共享DefaultLocale规范依据](https://tc39.es/ecma402/2026/#sec-defaultlocale)，但采样与命中不是原子事务；未证明任意改写的全局对象/反射内建、所有跨Realm或Proxy形态等价。[toString规范](https://tc39.es/ecma262/2026/multipage/fundamental-objects.html#sec-function.prototype.tostring)不保证所有引擎的Proxy均匿名。

未执行新整批PDF、完整Expo构建、全量产品回归、Firefox/Safari、真机、长负载或UI验收。首次文档门禁因笔记章节名缺失失败，已补齐既定章节，不放宽规则；最终结果见本轮final-gate。下一步以新候选整批保真、干净交叉时延及输入尾延迟决定是否继续接入；局部成绩不替代生产证据。取舍见[后继提案](../../.agents/notes/proposed/storage/2026-10-19-pdf-segmenter-guards.md)。

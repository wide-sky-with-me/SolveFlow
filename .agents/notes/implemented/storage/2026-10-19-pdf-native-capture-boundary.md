# 原生捕获的完整输入边界

日期：2026-10-19。状态：implemented。范围：保留 Web 完整输入原生捕获并补反例回归；字符串旁表未接入。

## 背景

[阶段观测](../../../../docs/postmortem/2026-10-19-pdf-export-stage-boundaries.md)仍见原生捕获同步窗。初始化前的[惰性预检](2026-10-19-pdf-preflight-validation.md)只承诺采集 snapshot 的来源，不证明整个 copies/prepared 图都由普通容器构成。

## 决定

[现有适配](../../../../apps/mobile/src/local/web-export-tasks.ts)继续在计量原输入、容量门槛之后一次原生捕获完整输入；成功后才预留容量，随后独立复核。普通 submit 和 submitCollected 都保留这一行为。[准入回归](../../../../apps/mobile/src/local/web-export-admission.test.ts)补齐两入口中 prepared 的 Proxy 克隆失败、足额重试，以及改成普通原型的 Date/TypedArray 仍按内部品牌克隆并隔离。

## 放弃的方案

隔离旁表原型复制容器图，将长字符串槽放 null；闭包保存字符串、所属容器和键；一次原生克隆图及 owner 引用，再覆盖原位数据槽。受限样本显示局部收益，但它不是通用 structuredClone：透明 Proxy 会被展开为普通对象；原型伪装的原生对象会丢内部品牌。检测到异类再回退也覆盖不了这两类输入。[结构化克隆规范](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)按内部品牌和序列化记忆表处理，不以可变原型代替。

不直接复用现有 snapshot 资格作为全输入资格；不据原型白名单宣称已识别全部对象品牌。后续接入须另有可证明的完整输入纯数据生产边界，并验证正式计量、所有权、失败释放、取消及整批成品。尚未决定采用新的入口或生产实现。

## 后果与限制

本轮保留原同步停顿，换取兼容和错误阶段不变。JSON 可见循环先在计量失败；数组扩展属性中的循环仍可能进入捕获。不会把解析、JSON 往返、浅复制或提前建图当作原生等价实现。[原准入决定](2026-10-16-pdf-admission-yield.md)继续有效，本笔记不替代其容量及生命周期约束。

## 验证

[本轮复盘](../../../../docs/postmortem/2026-10-19-pdf-string-sidecar.md)拥有局部比较、反例、实际检查和失败重试证据；这些证据不构成旁表生产接入或整批流畅验收。

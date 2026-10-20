# 逐题打印帧纯题目保真

日期：2026-10-18。环境：Linux、Chrome 154.0.8037.97。范围：同一份既有27题照片批次，纯题目、整理后的试卷、单份、CPU1冷启动。当前完整构建的单开关对照来源见[完整构建对照](2026-10-18-pdf-full-frame-comparison.md)，提案仍为[proposed](../../.agents/notes/proposed/storage/2026-10-18-pdf-frame-question-materialization.md)。

结论：纯题目模式新增一组同版本原生配对，27组JPEG/绘制流及RGBA哈希一致；每端27题均有题干、纯题页脚且无作答区。此为单语料冷启动保真，不是取消、吞吐或生产流畅验收；没有采用或部署候选。

## 恢复与来源

跨时段恢复后，原服务任务已退出且3100端口未监听，旧任务ID已不在当前任务表。先核对原默认静态目录，再以原配置恢复服务；主包仍为 `c6742e0434dcc981b7ba5eec81f6cc033f8c2a0bb0bacea797dee95ad58d0bdf`。没有将候选替换到该目录。启动前核对60项冻结源码，实际页面再次核对原主包，证据为 `.runtime/pdf-production-2026-10-16/r68-recovery-preflight.json`、`r68-service-restored.json`。

浏览器仍以原CSP、同源隔离路由选择[上次完整产物](2026-10-18-pdf-frame-question-materialization.md#完整构建原生复测)及仅关闭逐题接入的私有对照，不产生第二构建变量。真实VM主包、SDK及缓存身份均另验。html2canvas依赖仍为1.4.1，本地候选编号不是依赖版本。

## 方法与首次失败

从既有完整构建回放器派生纯题专用驱动：通过真实弹窗点击“纯题目”，确认份数输入消失；仅允许CPU1、单周期、冷启动及原始像素捕获。保留原生保存、文件持久化、资源释放、缓存、VM来源及模型调用门禁。附加只读frame观察器，记录题号、题干存在、作答区数量、纯题页脚及选项数量，不保存正文。

作答版的旧基准不能用作纯题oracle。整份帧先生成明确标注的待配对参考：`referenceOnly:true`、`runtimeChecksPassed:true`、`accepted:false`。候选再读取该参考逐页核对；最后独立验证器重新读两份PDF、原始捕获与语义观察后才给出配对通过。

首次整份帧已生成PDF并通过语义检查，但工具在后续主包哈希核对中把Path传给原有 `sha(bytes)` 函数，抛TypeError退出1。保留该次目录与 `r68-pure-control.log`；修正为读取字节，两处变更有精确反向证明。之后从新的干净浏览器上下文重跑两端，未修改失败记录或产品实现，首次留下的PDF不计通过页数。

## 独立验证

证据目录为 `.runtime/pdf-production-2026-10-16/`。有效上下文为 `integrated-r51-r68-questions-control-cold-v2` 和 `integrated-r51-r68-questions-candidate-cold-v2`。各运行 `inspect-pure-frame-r68-v2.py --mode integrated --scenario cold --cpu 1 --capture --cycles 1`，候选额外指定该整份帧参考；两次进程均退出0。整份帧的accepted仍保留待配对含义，不将它单独解释为验收成功。

`verify-pure-frame-r68.py` 对两端另行核验，退出0，输出 `r68-pure-verification.json`：

- 两份完整PDF，共54页JPEG/绘制流，按页27组JPEG和绘制流完全一致，27组RGBA哈希、尺寸及字节数一致。
- 每端题号1–27完整；题干存在、作答区数量0、页脚为纯题，选项数量相同。整份帧同时连接全部题，候选始终仅连接当前题。
- 持久化的完整文件与实际下载字节数和哈希一致；任务成功、单份27题；frame、编码画布及Blob/字节等待释放，观察器退出。
- 两端输入及整理缓存前后相同，业务模型调用、外部请求及浏览器错误均为0；主包仅有既定单开关差异，SDK相同。

驱动两轮派生均精确反向验证，记录在 `r68-pure-tools-generation.json`、`r68-pure-v2-generation.json`。此次原始像素读取和语义观察只服务保真，不引用耗时或长任务作为性能成绩。

上轮封存也在恢复后补齐：冻结首份失败与v2源码快照、原始回放及校验，合计342项文件，清单为 `r67-evidence-manifest.json`，SHA `2c3ae70f2e09297b2ece2c7e2ab1f7d4569cefb7a8122613cc05d4757546ebb8`。浏览器profile不在清单内；PDF相关源码快照不是全仓镜像，历史证据不覆盖后续改动。

## 未验范围

纯题的取消恢复及受控资源失败仍须原生补证；原始记录、当前完整构建多份、冷/晚字体及首次点击至取消入口反馈继续验收。更多语料、多浏览器、真机、实体打印及持续负载也未在本次关闭。本轮只新增隔离测试工具和文档，产品TS/CSS与测试源码均未再改动；既有单元与类型检查不重复记为本轮新跑。

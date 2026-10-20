# 采集数据的分片预检

日期：2026-10-19。状态：implemented。范围：Web PDF初始化前采集数据预检；整体流畅及部署另验。

## 背景

[捕获后分片](2026-10-19-pdf-captured-validation.md)仍留下初始化前整份同步校验。浅复制会混合caller版本；schema输出为普通数据，不代表所有unknown输入没有访问器、继承字段或Proxy。

## 决定

为collectBatchPrint输出的惰性普通数据新增显式submitCollected入口，普通submit保持同步全检。[Web适配](../../../../apps/mobile/src/local/web-export-tasks.ts)保留首个让出/取消检查，在原预检时点先完整复制snapshot容器，字符串原值引用，不扫描或原生克隆图片。视图建好后[契约](../../../../packages/contracts/src/local.ts)复用逐记录完整校验，失败也只对私有视图回退；[投影](../../../../packages/client/src/batch-print-variants.ts)保留源错误、输出schema、页数门槛先于初始化。[UI调用方](../../../../apps/mobile/src/components/batch-pdf-export.web.tsx)快照由useBatchPdfExport采集，未把普通未知对象暗标为已验证。

复制器有界，保留自有可枚举数据键及别名；预算耗尽或遇访问器、异类原型、非枚举字段、稀疏/扩展数组、循环等回原同步全检，不抛新业务限制。Proxy缺少通用识别，惰性输入契约仍为前提，不宣称适配任意JS对象。

私有视图只计预检题数，随后丢弃；正式计量/128MiB门槛/原生捕获仍在初始化后同一同步段，之后保留独立捕获复核。原标题、copies/prepared原生值和别名不换成解析结果；reading独立、取消优先、提交锁与资源收尾不变。

## 放弃的方案

未浅复制或按身份缓存：材料及运行记录仍会变化。未提前原生克隆：会增加整图复制并前移异常。未用薄图片schema：先trim/default会增加错误等价证明。未删除普通unknown路径，也未提前按累计题数退出。

## 后果与限制

增加短命元数据容器与内部入口；预算只选旧路径，不是新容量。复制、单记录解析及回退仍同步，无严格毫秒上界。视图不得移到submit首个让出之前，否则改变初检观察时点；正式捕获可能合法不同，必须再完整复核。

## 验证

[契约回归](../../../../packages/client/src/batch-print-captured.test.ts)覆盖深层修改、别名、完整issues、异类回退及无原生克隆；[准入回归](../../../../apps/mobile/src/local/web-export-admission.test.ts)验证首个观察时点、取消不初始化/计量、原始标题及足额重试。性能及全量检查以当次验收为准，代码实现不等同生产流畅完成。

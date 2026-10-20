# 私有捕获逐记录复核

日期：2026-10-19。状态：implemented。范围：Web PDF准入捕获后的题数复核，不改存储格式、画质或容量。

## 背景

[定位器校准](../../../../docs/postmortem/2026-10-19-pdf-locator-calibration.md)未消除早段等待；独立CPU样本指向准入计数的整份快照校验。[既有让出决定](2026-10-16-pdf-admission-yield.md)保留两次复核，因为初始化等待期间输入可能变化；本次不复用旧题数。

## 决定

只切开原生structuredClone之后的复核。此时captured尚未交给队列或其它调用者，提交方独占所有可变容器，可以跨浏览器任务读取。初始化前的unknown完整预检保持原样；容量计量、上限与原生克隆仍同一同步段，不提前捕获，不把解析结果换成正式捕获。

[共享契约](../../../../packages/contracts/src/local.ts)同源维护根字段、记录数组边界及归属/唯一性检查。新入口仍接收unknown：先验封套，再逐记录调用原LocalRecordSchema，最后检查归属；只在有效成功路径避免再次扫描所有图片记录。任一封套、记录或归属失败时对同一私有输入回退原完整schema，保留完整issues、路径、顺序和正则元数据。无对象或图片缓存。

[纯投影](../../../../packages/client/src/batch-print-variants.ts)继续复用sourceProblems及输出schema，所有源错误及输出数量错误均先于300页门槛，不按早期累计题数提前退出。[Web适配](../../../../apps/mobile/src/local/web-export-tasks.ts)在每记录之前注入既有MessageChannel让出并复核signal，最后复核已观察到的取消。提交锁、容量释放与订阅仍由原try/finally边界持有；reading和原始任务标题不变。

本次仅局部替代既有让出决定中“捕获后一次整份同步复核”的范围。初检、捕获、入队取消交接及[单次渲染投影决定](2026-10-16-export-snapshot-projection.md)继续有效。新接口明确要求调用方独占已隔离输入，不是省略验证的typed/trusted快路。

## 后果与限制

记录级不是固定时长：单记录仍可含原图、63份历史材料及运行记录。坏输入回退仍同步且可能重复已验记录；选择完整错误兼容而非拼接或缩减issues。初始化前预检及容量/原生克隆下界仍在，不宣称全链路可抢占。

## 放弃的方案

未分片读取可变caller：跨等待会形成混合视图。未额外克隆预检输入：会新增同步捕获、内存及异常顺序变化。未只替换为parseAsync/微任务，也未替换图片正则或按身份缓存。更细图片级拆分另需完整契约与时延证据，不在本次扩大。

## 验证

[真实契约回归](../../../../packages/client/src/batch-print-captured.test.ts)覆盖逐记录让出、取消、独立捕获、完整错误、归属和输出数量顺序；[准入回归](../../../../apps/mobile/src/local/web-export-admission.test.ts)保持阶段、锁、原生值、容量和reading约束。准入替身测试不替代真实契约或浏览器验收，命令、失败修正、成品及限制由[当次报告](../../../../docs/postmortem/2026-10-19-pdf-captured-validation.md)记录。

## 后续局部替代

[采集数据预检](2026-10-19-pdf-preflight-validation.md)仅改变UI采集入口的初始化前预检；普通submit同步路径及本笔记的正式捕获后复核继续有效。

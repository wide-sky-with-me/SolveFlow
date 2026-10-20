# 题图加工取消、活事务回滚与补存验收

日期：2026-10-17。

范围：3100 当前 Web 包、本机 Chrome；1440×1000 实图回放沿用[前次校样](2026-10-17-pdf-canonical-geometry.md)的同一批 27 题、29 个图示，不是新增识别样本。合成界面回归另覆盖桌面和 390×844 窄屏，不代表真机。

结论：加工提交前取消、图像提交后保存取消、补存取消及成功恢复通过；恢复后实际下载的 PDF 与前次校样逐页绘制 JPEG 相同。本轮未发现需要修改产品实现的新取消缺陷，仅补强测试和证据，不代表完整生产验收完成。

## 变更与处理

[界面回归](../../tests/mobile-e2e/paper-preparation.spec.ts)新增两种提交边界。像素门在真实 getImageData 后挂起加工让步，取消后仍等待原任务结算，不提前解锁；存储门先执行真实 entries.put，再用同一事务的原生 metadata.get 请求链续活。取消通过公开按钮触发，不以延迟回调伪造活事务，不把 put 尝试当成提交。

缓存快照在浏览器内 JSON 序列化，并在同一只读事务获取键、entries 和 metadata。静态交叉复核发现两个测试缺口：仅验 abort 会混淆超时兜底；后续成功应用会掩盖取消后的内存预览污染。已补充 AbortController.abort 同步调用链中的目标 tx.abort 因果断言，并在下一次应用前锁定旧预览。每次门控重新 arm，避免复用陈旧阶段。

当前取消、待补存及忙碌语义统一见[题图处理](../subsystems/print-images.md)。产品、持久化契约和处理算法未改；测试原有 838 行前缀保持字节一致，未修改旧校样或放宽图像门槛。

## 验证结果

实图探针保留四次退出 1：首轮夹具指纹不符；第二轮确认导出 JSON 中唯一可选 sourceNumber 从 undefined 变成 null，契约不接受，导致一题未恢复；三次误把失焦后正常去尾零视为草稿改变；四次字符串轮询触发站点 CSP 的 eval 限制。只在加载的夹具上省略该可选字段后，27 行契约校验及原 `638f9f98…e4473e` 指纹同时恢复；改用函数谓词，保留原 CSP。冻结缓存文件 SHA256 仍为 `0ca46b1962231b2e4c1b263351dc56d4e03a008bb58c955a66b8390de54a7459`，不把探针错误当成产品缺陷。

最终在线及独立离线核验均退出 0：

- 像素取消命中纸面 normalize 的真实让步点，旧预览、草稿及完整缓存保持，未写 prepared entry。门释放后观察到加工画布尺寸归零。
- 图像提交后的保存取消保留新预览及待保存提示，阻断导出；实际 entry 与 metadata 原子回滚。再次取消补存也回滚，成功补存不重画、不调用模型，并保留此后尚未应用的草稿。
- 三次取消后的 metadata 全量在线比较通过；离线核验只检查其记录的哈希见证，不冒称离线重算元数据。八个阶段原题完整哈希相同；取消、恢复、重载与导出共六个阶段的完整派生缓存与校样一致。成功补存只变一个 entry。
- 普通重载并打开弹窗，整理 draw 和 prepared put 均零。实图业务模型尝试、非本机外联及页面异常均零；合成测试使用模型夹具，补存未新增夹具请求。
- 恢复成品 27 页 A4、6,596,098 字节，SHA256 为 `48830589590aed57abf592e68312a44fe8faf127a3da2393f298947dbcf0a60f`。按实际绘制 xref 提取的每页唯一 JPEG 与前次校样逐字节一致；不宣称整份 PDF 二进制相同或逐字、答案、打印正确。

实际命令：

```sh
python3 .runtime/pdf-production-2026-10-16/inspect-image-cancel-r39.py --name image-cancel-r39-current-v5 --export
python3 .runtime/pdf-production-2026-10-16/verify-image-cancel-r39.py
pnpm exec tsc --noEmit
SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3100 SOLVEFLOW_TEST_CHROME=/usr/bin/google-chrome pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts -g 'image (geometry drafts|adjustment cancellation)' --reporter=line
```

补强后类型检查退出 0；草稿及取消相关 16 项界面回归通过、退出 0，包含新加的两场景双视口，不是全量回归重新通过。原始日志、阶段缓存、实跑探针和成品留在 `.runtime/pdf-production-2026-10-16/`，成功目录为其 `image-cancel-r39-current-v5/`，离线结果为 `verification.json`。

另做隔离反例对照，不改产品：直接忽略信号触发的原生 abort、保留产品 5s 超时，弱强两份均在 5s 等空闲断言处超时，未复现旧假通过。随后在独立夹具增加 500ms 异源定时中止，弱断言误通过，强化因果断言因来源为 false 按预期失败。后者浏览器退出 1 为预期，结果核对退出 0；不当成当前产品故障或真实 5s 超时误通过的复现。两次 JSON 及截图分别保留在 `r39-mutation-*`、`r39-race-mutation-*`；新控制命令为 `pnpm exec playwright test --config=.runtime/pdf-production-2026-10-16/r39-race-mutant.config.ts -g 'image adjustment cancellation.*storage' --reporter=json`。

## 未验证项与剩余风险

安静窗仅 400ms，证明该窗内已观测计数稳定、所跟踪加工画布尺寸归零，不证明 GC、原生解码或任意迟到工作完全停止。该合成 pixel 门未独立区分 warp/sharpen 阶段；实际存储提交完成但通知尚未送达、多条 dirty 的部分成功、跨生命周期替换仍待验证。本批无其它 prepared entry，“无关项保留”为空集检查，不推广成跨批次数据隔离验收。

本轮未运行应用构建、全量回归、付费模型、持续负载、Mac/原生或实体打印。主线程长任务、PDF 原生编码/解码取消、并发持续降速和实际纸张清晰度继续验收；不据此次恢复导出宣称生产完成。

# 提高批量并发上限与Mac实例配置

日期：2026-10-24。范围：共享并发契约、本地队列及Web代理；远程Mac仅调整3131实例环境。Linux Node24.19.0、pnpm11.7.0，Chrome桌面/窄屏；测试均使用合成图片与假模型。

结论：本地两组可配置上限从32提高到64，旧默认及自定义值保持。Mac按用户选择从16/16提高到32/32，已通过外部HTTPS及隔离浏览器设置页核对；未部署本地新应用，没有真实付费压力测试。其他模型配置延续[DMX更新](2026-10-24-dmx-sol-model-upgrade.md)。

## 变更与处理

[共享契约](../../packages/contracts/src/local.ts)拥有每组范围及派生执行总量。[队列](../../packages/client/src/local-batch.ts)继续独立控制两阶段，[代理](../../scripts/web-model-proxy.mjs)总门禁随契约派生为131，整个Web实例共享；超限拒绝、取消释放、图片字节及100题批次边界仍存在。Android后台任务预算同样从契约生成，但本轮没有构建或安装原生包。取舍与降级要求见[并发决定](../../.agents/notes/implemented/architecture/2026-10-24-higher-batch-concurrency.md)，当前设置规则见[设备运行](../subsystems/device-runtime.md#模型组与并发)。

Mac先确认3131无已建立连接，备份权限600的`shared/compose.env`，仅将答题/校验值改为32并重建`solveflow-web-preview-web-1`，失败路径可恢复原环境。活动发布仍为`20261023-act-numeric-2150`，镜像ID、入口内容、模型/密钥文件和预设字节不变；其他容器ID及启动时间未变。不重载网关，不部署本地64上限、批量补图界面或其他未发布代码。

新浏览器直接读取32/32；原浏览器已保存的自定义偏好仍优先，若仍显示16，须在模型设置中手动改到32并保存。重建生成新的角色访问令牌，既有页面后续请求前应刷新；不自动重放旧任务。

## 验证结果

私有证据位于忽略目录`.runtime/concurrency-64-2026-10-24/`，包含改前快照、失败/复测日志、远程安全回执及设置页截图。所有新增HTTP模型请求均发往隔离假服务或被拦截，真实模型请求0。

- 改前`pnpm exec vitest run packages/contracts/src/local-settings.test.ts packages/client/src/local-batch.test.ts --project unit --maxWorkers=2`：5项失败、25项通过，退出1；33/48/64契约及新增高并发队列均被旧上限拒绝。
- `pnpm build:workspace`退出0后，`pnpm exec vitest run packages/contracts/src/local-settings.test.ts packages/client/src/local-batch.test.ts packages/client/src/local-engine.test.ts packages/client/src/storage-recovery.test.ts --project unit --maxWorkers=2`：79项通过，退出0。包括48/16、64/64真实队列准入，活动期间拒改、停止释放及存储失败。
- `pnpm exec vitest run tests/unit/web-model-proxy.test.ts tests/unit/web-model-settings.test.ts --project offline --maxWorkers=2`：19项通过，退出0。新增131个同时保持的假SSE流、第132个请求被拒、全部完成后恢复名额；原上传超时和断线取消仍通过。
- `pnpm test:web-container`：17项通过，退出0；64/64接受、65拒绝、部署配置保留及来源隔离。
- `SOLVEFLOW_TEST_WEB_URL=<本轮隔离服务> pnpm exec playwright test tests/mobile-e2e/web-settings-editor.spec.ts --grep 'higher concurrency|Web settings edit' --project=desktop --project=mobile`首次2项通过、2项失败，退出1。新增夹具误以为只改并发也会写服务器模型；实际按现有规则只保存浏览器偏好。保留失败证据，修正为断言不写服务器，再用`--grep 'higher concurrency'`复测桌面/窄屏2项通过，退出0；64/64刷新保留、两组65均拒绝、模型调用0。原设置编辑2项已通过，没有重复累计。
- `pnpm build:web`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`均退出0。
- 用户明确选择32/32后，受控SSH调整脚本退出0；模型与预设文件校验一致，旧应用/其他容器保留。外部HTTPS校验证书及启动配置，隔离Chrome显示32/32、校验/备用仍为`gpt-6.1-sol`，页面异常和意外写入均0；验证脚本退出0。
- `pnpm lint`退出0，含源码边界及文档检查：363份当前文档、109份决策、184个源码锚点、108份冻结文档；`git diff --check`退出0。首次检查因决策缺标准小节、当前设备文档2223单位超过2200失败，修正小节并精简说明后通过，没有改变门槛。本轮独立服务PID4156587已停止，进程退出0；Mac实例继续运行供用户使用。

## 未验证项与剩余风险

未进行DMX真实吞吐、429率、延迟或多用户大图内存压力测试，不能宣称提高并发必然等比例提速。DMX的自定义令牌限流没有管理凭据可查；[官方说明](https://doc.dmxapi.cn/lingpai.html)仍区分令牌限流与共享上游拥堵。本地64上限没有部署到Mac；旧浏览器配置、Firefox/Safari、Android/iOS新包及Mac整机重启另验。

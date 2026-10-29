# UI与后端检查

日期：2026-10-21。范围：桌面/窄屏/短横屏、深浅主题、设置与批量待解题；本地Web模型代理；保留API的隔离数据库/对象存储集成。不调用付费模型，不改用户题目，不提交/推送；本机冒烟曾误写模型配置，恢复情况单列。

## 发现与处理

- [设置](../../apps/mobile/src/components/settings.tsx)的原生默认开关呈绿色，未沿应用蓝色主题；改由[主题基础组件](../../apps/mobile/src/theme/primitives.tsx)适配开关，覆盖开/关、禁用与深浅主题，保留原生语义和Web键盘操作。
- [批量待解题](../../apps/mobile/src/components/batch-question.tsx)图片占满浏览器宽度，提示贴左，材料入口却居中；使用同宽容器，桌面[布局](../../apps/mobile/src/workspace/desktop.web.css)与材料入口共用宽度和边距。
- [模型代理](../../scripts/web-model-proxy.mjs)读取半截配置没有独立期限，长期占锁并阻塞派发；正文10秒截止，408后关连接并释放锁/名额，不保存残缺配置、不派发上游。响应阶段沿原预算，见[决定](../../.agents/notes/implemented/architecture/2026-10-21-web-request-body-deadline.md)。
- [服务集成配置](../../vitest.integration.config.ts)误收集`.runtime/`旧源码副本，34项当前API测试虽通过，命令仍因旧副本缺依赖退出1；保留Vitest默认排除并额外排除临时目录，不删除历史产物或减少正式用例。
- 维护界面旧断言漏掉既有`answerStateVersion`缓存字段，更新为共享版本常量，仍逐字验证原记录/题图不变；新增各主题/宽度图片、提示和材料入口边界断言。

当前行为归[阅读界面](../subsystems/rendering.md)和[模型传输](../subsystems/model-transport.md)；没有协议、数据库迁移、新依赖或自动重试变更。

## 复现与验证

Node24.19.0、pnpm11.7.0、Chrome154。私有证据目录`.runtime/ui-backend-review-2026-10-21/`（权限700），测试Web端口45399/PID3267940。截图均为合成图片、独立浏览器库；没有读取原浏览器数据库。

服务测试使用本次新建项目`solveflow-ui-backend-audit-20261021`的PostgreSQL17.9和MinIO缓存镜像，数据位于tmpfs，无现有卷；测试再创建随机库/桶并自行删除。仅基础设施凭据由既有环境读取，模型固定为demo/本地fake。

- `ui-baseline.log`：8文件48项，46通过/2失败，退出1；两处失败均为旧缓存版本断言。人工查看桌面设置及窄屏/短横屏导出截图，发现上述开关和待解题布局。
- `ui-before.log`：新增桌面复现2项均失败，退出1；原开关轨道非蓝色，待解题图片/提示与材料入口边界不一致。
- `proxy-before.log`：旧代理的半截设置请求在虚拟时间超过10秒后仍无响应，新增断言失败，退出1。
- `proxy-after.log`：2文件14项通过，退出0。后补并发用例首次错误假定上限为8；改读契约常量后又暴露夹具探针可抢先保存配置的竞态，失败日志保留在`proxy-final.log`和`proxy-verified.log`。改为等待服务器实际收到全部半截请求，再检查锁/名额，不延长断言时间。
- `proxy-confirmed.log`：3文件17项通过，退出0（1.96秒），包括全部名额超时后释放、半截配置断连、原配置与令牌不变、超时前零上游派发及随后正常调用；原固定转发/授权/响应上限/断连取消与Web资源访问回归通过。
- `api-baseline.log`：`pnpm test:integration`构建通过；34项当前用例通过，误收集的2个旧副本失败，退出1。`api-final.log`：修正收集范围后`pnpm exec vitest run --config vitest.integration.config.ts`只收集当前文件，34项全部通过，退出0（23.03秒），涵盖真实事务、跨owner拒绝、幂等冲突、取消迟到、租约失效、SSE、上传/删除和原生身份；模型为fake。
- `ui-after.log`：新增布局/开关4项桌面和移动视口通过，退出0（11.1秒）。根与移动端类型检查、Web构建退出0。

- `ui-final.log`：最终8文件50项桌面/移动视口全部通过，退出0（1.8分钟）；与先前重复轮次不累加。`web-container.log`：`pnpm test:web-container`13项通过，退出0。
- `lint-verified.log`：边界与文档检查通过，退出0；首次文档超长后精简说明，未提高门槛。受限环境的`docs:test`因CLI子进程`spawnSync EPERM`失败；`docs-test-unsandboxed.log`在正常进程权限下20项通过，退出0，未修改检查器或断言。
- `typecheck-final.log`：最终根类型检查退出0。没有因本次静态/局部UI修复重跑上一轮1499项单元测试，不能将旧成绩计入本轮。

## 本机交付与测试误写恢复

`publication.json`：追加2个不可变资源并原子更新3100入口，12个入口资源和新增资源HEAD200；入口SHA256为`0319a31e1fe3ae64836b7e14b4e8fb127299c9b1d9ea85df19a593f20275bebd`。为应用代理修复，确认无连接后沿原命令/目录/环境重启服务，原配置文件指纹一致。

随后`live.log`的设置冒烟错误地复用了需要保存模型参数的夹具，没有屏蔽真实环境入口，导致解题组被写成合成配置；该轮失败，不能声称配置始终未变。发现后停止测试，只恢复本次改动的解题组：从已有预设中筛选出唯一满足“未改动的解题参数、校验/备用完整参数及其凭据均一致”的DMXAPI配置；未改校验/备用或预设文件。`.env`及题目库未改动，没有调用模型。

`configuration-restoration.json`保存脱敏恢复结果。恢复后再次重启，逐组核对运行bootstrap与持久设置一致。`live-verified.log`在屏蔽环境端点、拒绝所有写请求的独立浏览器中1项通过（3.9秒），退出0。通用[模型夹具](../../tests/mobile-e2e/local-fixture.ts)另加环境状态保护：不是明确404的非受管服务时，在打开设置/写入前拒绝；该保护有模拟受管环境的零写入回归。`fixture-guard.log`：相关设置/窄屏/主题及夹具保护14项通过，退出0（25.7秒），不累计进50项旧轮次；`live-final.log`最终2项本机保护/开关冒烟通过，退出0。

`infra-cleanup.json`：按标签核对2个本次容器且没有挂载既有卷，再删除容器/网络，剩余0。`cleanup.json`：只停止45399测试服务；3100由PID3392702继续运行，HTTP200且入口哈希一致，恢复后的设置、.env和预设指纹不变。`scope-check.json`：142个既有改动文件中140个字节不变，仅本轮编辑的桌面样式和阅读说明改变；13个额外路径均为本轮明确范围，未发现意外源码改动。`typecheck-delivery.log`、`git diff --check`退出0；最终文档检查见`lint-delivery.log`。

本轮不代表Android/iOS真机、真实模型准确性、生产负载或公网多人部署验收；默认网页版依赖本地库与模型代理，保留API的通过成绩单独报告。

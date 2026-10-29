# 批量补图分配与自动重答验收

日期：2026-10-24。范围：通用客户端补图分配、共享本地存储/队列与Web实际交互。环境：Node24.19.0、pnpm11.7.0、Linux Chrome桌面及窄屏，合成图片/模型。

结论：已实现多图多题分配、一张补图复用于多个接收者、保存后按题去重自动重答，保留旧答案及图片证据。同图多小题沿原对话依次重答，不新增题目根节点。跨记录保存失败不留下前缀，取消不提前派发模型。新Web构建本地验证，不包含远程应用部署或原生包交付。当前交互与边界见[批量补图](../subsystems/batch-materials.md)。

## 变更与处理

[分配界面](../../apps/mobile/src/components/batch-materials.tsx)提供批次菜单入口，沿[原多图预览](../../apps/mobile/src/components/material-import.tsx)裁剪/旋转/移除；每图单独打开虚拟题图列表，勾选、全选或输入序号范围，可查看原图。未完成分配无法提交。入口文案明确补图后自动解答并核验，使用说明同步补充。

[契约](../../packages/contracts/src/local.ts)和[范围解析](../../apps/mobile/src/batch-material-selection.ts)保留数量、ID与展开字节上限。[仓库](../../packages/client/src/local-repository.ts)给每个接收者独立材料ID，以单次事务写材料、记录和摘要；[引擎](../../packages/client/src/local-engine.ts)及[队列](../../packages/client/src/local-batch.ts)保证先完整保存，再按原顺序各派发一次。v1记录沿现有格式事务转为v2；旧答案/图片不覆盖。停止期间已接受事务可完整保存，但不继续派发。取舍见[决策](../../.agents/notes/implemented/storage/2026-10-24-batch-material-assignments.md)。

模型名称更新是用户中途追加的独立配置操作，远程Mac只更新该配置，没有部署本次应用，详见[模型记录](2026-10-24-dmx-sol-model-upgrade.md)。

## 验证结果

私有目录`.runtime/batch-materials-2026-10-24/`保存改前快照、首次失败、复测日志、浅深色截图及PDF。隔离服务动态分配回环端口，测试上下文独立；模型域名仅为假服务，其他外部请求拦截，未发起真实付费推理。

- 修复前`pnpm exec vitest run packages/client/src/local-batch-materials.test.ts --project unit`八项失败、退出1，保留缺失行为的回归。
- `pnpm exec vitest run packages/contracts/src/batch-materials.test.ts packages/client/src/local-batch-materials.test.ts packages/client/src/local-batch.test.ts packages/client/src/local-image-edit.test.ts packages/client/src/local-engine.test.ts packages/client/src/local-history.test.ts packages/client/src/local-history-import.test.ts apps/mobile/src/batch-material-selection.test.ts --project unit`：最初156项通过，退出0；补齐同图多小题顺序、停止后续小题及合计次数预检后159项通过，退出0。另包含共享/重叠分配、旧证据、失败/未答题重答、原子回滚、容量/归属/重复/JPEG拒绝、取消及无事务拒绝。
- 新浏览器文件桌面/窄屏6项通过：两张图分别分给1–2题及第2题，两个接收者各自动解答和独立核验一次，第3题原记录字节不变；共享像素一致而材料ID不同；保存失败后重试不重复材料；草稿取消不写库/调用模型；最后下载补图批次的快速PDF。
- 分组修复前的构建补跑旧补图回归10项通过，退出0；最终构建`pnpm exec playwright test tests/mobile-e2e/batch-materials.spec.ts tests/mobile-e2e/materials-multi.spec.ts --grep 'reuses assigned|cancelling a reusable|failed shared-image|grouped recipient|selects several supplements once|supplemented correction downloads a complete PDF in 快速原文' --project=desktop --project=mobile`：12项通过，退出0。包含新增同图多小题重答及导出，原有单题多图编辑、更正后导出保持通过；重复回归不累计新场景。
- `pnpm exec playwright test tests/mobile-e2e/batch-materials.spec.ts --grep 'fifty recipients' --project=desktop`：1项通过，退出0。一张图片分给50个接收者，各仅有一份新材料和一轮新增解答，50次解答及50次独立核验均为假服务；整例7.4秒，不代表手机照片处理或真实模型延迟。
- 最终浏览器产物6份PDF全部可打开、书签目标在页数范围内；同图两小题及另外两张题图导出各5个书签（答案表与4题），没有重复新增题号。
- 根类型检查、移动端类型检查及`pnpm build:web`退出0。浏览器移动视口不是原生真机结论。
- `pnpm lint`退出0，含源码边界及文档检查：360份当前文档、108份决策、183个源码锚点、108份冻结文档；`git diff --check`退出0。发布状态增加本次入口后触及长度门槛，已精简原摘要而未提高上限。测试服务按记录的PID清理，不影响Mac3131。

## 首次失败与复测

第一次移动端类型检查发现旧更正回调第二参数表示替换材料ID，不能传行数组；已新增独立行回调，旧单题回调继续只接收照片。根类型检查同时纠正契约测试参数表的数组展开，确保真正测试重复ID数组。

第一次浏览器三项超时：夹具在页面刷新前配置了只存内存的密钥，刷新后按钮按真实未配置状态禁用；改为刷新后配置假服务。接着发现两个独立问题：旧v1记录尚未保存完成时被测试立即按v2解析，已等待“新增一轮且完成”；新复选控件未向Web暴露checked，已在产品代码补充`aria-checked`并保留状态断言。桌面/窄屏6项通过，重复复测不累计为新场景。

随后源码复核发现同图多题不能引用不带题号的group根节点重答；增加按原小题上下文顺序执行的有界计划，停止只保留已经开始/保存的部分，不继续派发其余小题。该处理避免创建新的整图group根节点而重复题号，未放宽原有单题enqueue上下文约束。

## 未验证项与剩余风险

没有真实模型质量评测、Windows/Safari/Firefox、Android/iOS新包或远程新UI验收。分配单位是一张原题图，同图小题会分别重答，尚未支持仅为其中单道小题独立分配。复用图片按接收者分别保存，不做物理去重；超大分配受展开字节上限约束。跨进程直接写库仍沿既有边界。

# 批量相册导入上限提高至500MB

日期：2026-10-22。范围：用户明确要求一次选图总量由100MB提高至500MB；更新现有Web入口，不改题目、模型配置或并发，不提交/推送。

## 改动

[共享契约](../../packages/contracts/src/local.ts)新增 `MAX_BATCH_IMPORT_BYTES`，沿原1024计量取500MiB（524288000字节），[Web](../../apps/mobile/src/platform.web.ts)与[原生](../../apps/mobile/src/platform.native.ts)共用。按选图原文件总量检查，刚好上限可接受、超过才拒绝，错误文案从同一常量生成。

每批100张、剩余容量、Web单图10MiB、规范化后的图片容量与尺寸限制继续生效。原生缺少fileSize时继续读取文件大小；拒绝后继续释放临时文件。排序、确认后逐张保存与入队、停止及失败续导入不变；当前说明更新到[设备运行](../subsystems/device-runtime.md#批量图片顺序)。

## 验证

Node24.19.0、pnpm11.7.0。私有证据目录 `.runtime/batch-import-500mb-2026-10-22/`（权限700），使用合成JPEG和模拟文件大小；验证脚本未派发真实模型请求。

| 命令或检查 | 实际结果 |
| --- | --- |
| 修改前运行新增 `platform-batch-import.test.ts` | 7失败、2通过，退出1；旧100MB挡住101/500MiB或返回旧提示 |
| `pnpm --filter @solveflow/contracts build` | 退出0 |
| `pnpm exec vitest run --project unit apps/mobile/src/platform-batch-import.test.ts apps/mobile/src/platform-image.test.ts` | 修正夹具后14项通过，退出0；包含500MiB及多1字节、原生大小回读/释放、单图和张数边界、既有变换回归 |
| 根 `pnpm exec tsc --noEmit` 与移动端 `pnpm --filter @solveflow/mobile typecheck` | 均退出0 |
| `pnpm build:web` | 共享包和Web导出成功，退出0 |
| 隔离服务运行 `batch-import.spec.ts` | 桌面/移动视口16项通过，1.2分钟，退出0；大小边界、排序、取消、部分保存失败续导入、批次追加和放弃 |
| 本地3100部署后定向运行 `-g 'batch import byte limit'` | 桌面3项通过，9.2秒，退出0；环境端点由夹具404响应，配置仅在隔离浏览器保存 |
| Mac3131部署后定向运行同组浏览器测试 | 桌面/移动视口6项通过，39秒，退出0；使用同一大小边界与零模型调用断言 |
| 新部署只读HTTPS冒烟 | 退出0；证书、入口摘要、安全上下文、来源拒绝边界、界面16/16通过，模型调用0 |
| `pnpm lint` | 修正文档后退出0；源码边界及330份当前文档、99份决策、165个锚点、108份冻结文档通过 |

首次修改后单元执行因夹具将101MiB均分成非整数File.size，触发Node对象URL的Uint32断言，工作进程SIGABRT；改为按整数字节分配余数后通过。没有改变业务断言或生产图片校验。

首次lint的源码边界通过，设备运行文档超过长度上限15单位；仅精简本轮新增句子，未改变检查门槛。工作区1186份基线文件中1181份不变，5份修改和2份新增均属本轮范围。

## 发布

`node scripts/package-web-container.mjs .runtime/batch-import-500mb-2026-10-22/release` 退出0，生成独立发布包，包含当前未提交工作树。新入口SHA256：`a3bb22f0e4b81cdb57497e9de1c970069ce03fec9bb3da99a69c90d4b1c68841`。

本地3100仅追加一个不可变JS资源并原子切换index，12个入口资源及新增资源HEAD200，不重启代理。Mac在原3131实例升级：先备份模型及预设，构建独立镜像，再用必定校验失败的空设置请求核对请求准入空闲；不保存模型或派发请求。保留原state、证书、网关进程与Origin，只替换该实例容器，原3130和8000服务继续运行。

SSH首次超时，通过已有Tailscale客户端确认设备可达后，原Linux密钥重试成功。Windows备用密钥未被接受，未更改任何密钥或信任记录。

最终比对旧容器身份/健康及模型配置指纹均未变，私有配置仍600。运行实例有1条模型诊断，不将其归为本轮测试；夹具及只读冒烟独立统计为0。已停止本轮46165端口测试服务（PID3764443），本地3100返回200且摘要一致；保留用户3131实例运行。

## 限制

500MiB测试模拟浏览器/原生选择器的大小元数据，图片内容为小型合成JPEG，验证的是准入边界与交互，不代表实际500MiB文件的内存峰值测试。未运行Android/iOS真机或生成新原生安装包。

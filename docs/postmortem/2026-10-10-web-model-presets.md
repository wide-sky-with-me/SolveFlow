# Web整组模型预设验收

日期：2026-10-10。范围：本地Web桥接、三组模型预设、设置界面和凭据保护。

结论：预设载入、另存、启用和确认移除已实现；离线回归与浏览器交互通过。已私下保存当前DMXAPI及TokenPlus配置，未自动切换生效模型。运行语义见[配置预设](../subsystems/model-presets.md)，操作见[Web指南](../cookbook/local-web.md#配置预设)。

## 验证结果

Node24.19.0、pnpm11.7.0，使用假模型、临时配置文件、随机回环端口和新浏览器存储；未操作用户IndexedDB或原生题目库。

| 命令 | 结果/退出码 |
| --- | --- |
| `pnpm build:shared` | 通过/0 |
| `pnpm exec vitest run --project offline tests/unit/web-model-settings.test.ts --maxWorkers=2` | 7项通过/0 |
| `pnpm exec vitest run --project unit apps/mobile/src/local/web-env.web.test.ts apps/mobile/src/runtime.test.ts --maxWorkers=2` | 28项通过/0 |
| `pnpm exec tsc --noEmit` | 通过/0 |
| `pnpm --filter @solveflow/mobile typecheck` | 修正RequestInit可选body及fetch mock签名后通过/0；首轮失败保留在本地执行记录 |
| `pnpm --filter @solveflow/mobile exec expo export --platform web --output-dir ../../.runtime/model-presets-2026-10-10/web-final` | Web导出通过/0 |
| `SOLVEFLOW_TEST_WEB_URL=<隔离URL> pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/model-presets.spec.ts tests/mobile-e2e/web-settings-editor.spec.ts tests/mobile-e2e/thinking-settings.spec.ts tests/mobile-e2e/backup-model.spec.ts` | 桌面/移动视口共14项通过/0 |
| 预设浏览器定向复测（`model-presets.spec.ts`） | 增加减少动态效果和740×390短横屏后2项通过/0；不累计为新场景 |
| `pnpm lint`、`git diff --check` | 边界、文档及空白检查通过/0；文档首轮超限，拆分所属子系统说明并精简，未调高门槛 |

覆盖目的地绑定、服务端密钥保留、三组令牌轮换、活动互斥、无自动重放、重启恢复、删除来源不影响生效配置、写失败、损坏文件、名称/数量/输入大小限制，以及草稿连接测试、另存不启用、确认移除。浏览器截图包括390/1280/1920视口与深浅主题；移动视口不是原生手机验收。证据在被忽略的`.runtime/model-presets-2026-10-10/`。

官方[TokenPlus接口说明](https://www.tokenplus.cn/docs)确认当前Base URL；经显式授权使用提供的凭据调用模型列表筛选图片和工具支持，HTTP200返回`qwen/qwen-3.8-max`、上下文1000000。此次只有GET元数据，无生成调用；备用角色保留既有服务，避免全组依赖同一渠道。种子配置文件0600且被Git忽略，生效文件字节与模型参数均核对未变，临时凭据文件已清理。不记录真实密钥或令牌。

用户确认无活动任务后更新3100服务，发布前保留旧入口与资源，核对登记进程、运行目录和新旧模型参数；更新后HTTP200、构建入口哈希一致，仍使用原三组模型。独立浏览器连接更新后的真实本地服务，拦截写请求，只载入TokenPlus草稿：显示两组预设，字段可编辑、密钥为空，生效配置未变；bootstrap与JS产物无供应商密钥，私有文件URL返回404。该检查没有生成调用。随后停止本轮随机端口测试服务，保留3100供用户试用。

## 未验证项与剩余风险

TokenPlus真实图片解题、工具调用、准确率、并发和超时尚未实测，模型列表支持参数不等于生成成功。Android/iOS没有此Web预设存储；未重新构建或安装原生包。多标签页切换后仍需刷新；变更超时先核对结果，不自动重试。私有预设文件含凭据，不属于题目备份。

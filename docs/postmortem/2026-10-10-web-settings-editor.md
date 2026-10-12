# Web设置编辑与布局验收

日期：2026-10-10。

范围：本地回环Web、环境配置、通用设置与个人页；Node24.19.0、锁定依赖、Chrome隔离存储及合成模型。

结论：三组模型可编辑、草稿连接测试与保存独立，配置重启恢复；当前3100服务已更新。真实供应商、APK及iOS未在本轮验收。

## 变更与处理

环境模式原先锁定全部模型字段；宽屏设置页两列加巨大备用区域，说明占据常驻空间。本次统一三组卡片、考试/并发置顶、高级参数与说明折叠，保存及失败反馈固定底部。“我的”和“设置与数据”两个重复标题删除。

模型修改保存到Node独立文件，不覆盖.env或手工浏览器设置。留空只保留同目标的已存密钥，换目标须新密钥；成功后轮换角色令牌，活动请求期间拒绝切换。旧服务无编辑标识时仍只读。语义见[设备运行](../subsystems/device-runtime.md)，持久化与恢复见[Web指南](../cookbook/local-web.md)，原因见[决策](../../.agents/notes/implemented/architecture/2026-10-10-web-model-settings-editor.md)。

## 验证结果

实际日志、截图和进程记录保存在被忽略的`.runtime/settings-editor-2026-10-10/`；复测不重复累计样本。

| 命令或检查 | 最终结果 / 退出码 |
| --- | --- |
| `pnpm build:shared`；根`pnpm exec tsc --noEmit`；移动端`pnpm --filter @solveflow/mobile typecheck` | 全部0 |
| `pnpm exec vitest run --project unit`，限定runtime、web-env.web、web-env-dispatch、web-env测试文件 | 32项通过 / 0 |
| `pnpm exec vitest run --project offline`，限定web-model-settings、web-model-proxy、mobile-web-server文件 | 12项通过 / 0 |
| `pnpm exec vitest list --filesOnly --project unit --project offline` | 新服务测试仅在offline收集 / 0 |
| `pnpm --filter @solveflow/mobile exec expo export --platform web --output-dir ../../.runtime/settings-editor-2026-10-10/web-final` | Web导出 / 0 |
| Playwright功能配置，隔离随机回环端口，限定设置编辑、角色校验、仪表盘及宽屏设置场景 | 最终20项通过 / 0；18项前轮包含旧环境与thinking兼容，不另累加 |
| 设置编辑截图等待弹窗完成后的复测 | 4项通过 / 0；390/1280/1920与深浅色截图 |
| `pnpm lint`、`pnpm docs:check`、`pnpm docs:test`、`git diff --check` | 全部0；文档管理20项通过 |

最初回环测试及文档子进程在沙箱失败，授权隔离执行后通过。新测试首次发现测试夹具的角色令牌/模型不一致、根包导入路径错误与故障目录缺少父目录，修正夹具后通过；误用旧测试收集参数的命令退出1，改用实际CLI的`list --filesOnly`后通过。失败日志保留。

发布保留旧哈希资源、原子切换索引；用户确认空闲后核对原PID/入口重启。3100的bootstrap返回可编辑标识，索引与导出一致；只读冒烟验证三组可编辑、密钥输入空白、保存按钮可见、零外部请求。没有向用户服务提交测试配置或调用真实模型。隔离测试服务已停止。

## 未验证项与剩余风险

浏览器移动视口不等于原生真机。独立配置文件含真实密钥，需安全备份，不提交或加入题目导出。保存响应丢失可能产生未确认状态，应刷新核对，不自动重试。公网多人鉴权不在本次范围。

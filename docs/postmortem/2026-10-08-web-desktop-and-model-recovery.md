# Web宽屏重排、备用解题与批量图片排序验收

日期：2026-10-08。

范围：当前工作区源码及本地Web导出；Node 24.19.0、pnpm 11.7.0、隔离Chromium桌面/移动视口；合成题图与假模型。已有未提交修改保留。

结论：宽屏页面已重排，增加可选第三组备用模型和批量多图确认排序。完整unit/offline通过；浏览器最终合并验收与Android打包检查见下表。没有真实模型或新APK安装证据，不据此声称准确率提升或已生产部署。

## 变更与处理

桌面此前呈现放大的移动空页面，内容层次与留白不适合宽屏。参考[Figma官方仪表盘模板](https://www.figma.com/templates/dashboard-designs/)及[Untitled UI公开组件说明](https://www.untitledui.com/components/dashboards)的导航、页头和卡片布局。Community抓取受限，插件不能读取第三方文件内部节点，因此未声称完整读取设计稿，也未复制第三方资产。

Web新增顶部品牌与横向导航、统一内容宽度、页头和考试摘要、拍题横向卡片及三条操作提示；历史/收藏空状态、个人页与设置间距同步。桌面边界仍为1100×600 px；短横屏/窄屏回原布局，缩放不重新挂载题目与草稿。实际截图复查还修正了原生样式优先级和原始HTML字体继承。

备用默认关闭，设置入口为“我的→设置→备用解题模型”。预填`gpt-6.1-sol`、官方地址、Responses和高思考强度，密钥由用户填写；[官方模型说明](https://developers.openai.com/api/docs/models/gpt-6.1-sol)要求工具调用使用Responses。独立校验组可主动选择Sol预设；已有主/校验配置不自动覆盖。接手范围、共享预算、独立核验和历史版本边界见[当前Agent说明](../subsystems/agent.md#预算和验证)及[决策](../../.agents/notes/implemented/agent/2026-10-08-explicit-backup-solver.md)。

批量相册多选先预览，文件名自然排序、时间与上下移动可在调用前调整。时间来源、保存/入队分界、失败重试和资源释放见[设备运行](../subsystems/device-runtime.md#任务)。既有连续拍照和逐题阅读保留。

## 验证结果

命令均从仓库根运行，Android导出命令在`apps/mobile`运行；统一使用以上锁定Node/pnpm。日志与截图保存于忽略目录`.runtime/web-redesign-2026-10-08/`，不包含真实题图或密钥。

| 检查 | 实际结果与退出码 | 证据 |
| --- | --- | --- |
| `pnpm build:web` | 收尾导出通过，退出0 | `build-final-lifecycle.log` |
| `pnpm test`（工作区构建+unit/offline） | 113文件、1019项通过，退出0 | `all-unit-offline.log` |
| `pnpm typecheck` | 通过，退出0 | `typecheck-delivery.log` |
| Playwright九个相关文件，桌面/移动视口 | 合并62项通过，退出0 | `delivery-e2e.log` |
| Playwright收尾五文件 | 34通过/6定位失败，退出1；其中非批量32项全部通过，修正批量夹具后8项全部通过，退出0；含重复回归，不累计新样本 | `final-stable-tests.log`、`batch-lifecycle-tests.log` |
| Android `pnpm exec expo export --platform android --source-maps --output-dir ../../.runtime/web-redesign-2026-10-08/android-export` | 最终导出通过，退出0；主HBC map不含桌面CSS或新增`.web`组件，使用原生空组件，检查退出0 | `android-export-lifecycle.log`、`android-isolation.log` |
| `pnpm lint`（源码边界+文档） | 通过，退出0 | `lint-delivery.log` |

浏览器覆盖桌面1280/1600/1920、深色、缩放保留草稿、导航动效与减少动态效果、设置控制、批量保存/队列和取消。额外手查1100×600、1099×900、1600×599、2560×1440入口可操作且无水平溢出；截图位于同一证据目录。

合并命令为 `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3128 pnpm exec playwright test tests/mobile-e2e/{desktop-layout,responsive-ui,ui-consistency,style-controls,style-regressions,navigation,backup-model,batch-import,batch-solving}.spec.ts`。收尾五文件为`desktop-layout`、`backup-model`、`settings-role-validation`、`exam-settings`、`batch-import`；之后仅重跑`batch-import`。使用锁定Node执行Playwright CLI，与`pnpm exec`调用同一已安装入口；测试服务在最终验证后关闭。

本轮测试服务PID897482、端口3128已关闭。为用户保留仓库自带本地预览`http://127.0.0.1:3100`，PID2260952，HTTP200；仅绑定回环地址，不是外网部署。

备用回归检查主模型不可用与阶段超时、自动FAIL接手、备用再次失败不循环、取消/预算拒绝、准确端点与独立密钥、Sol Responses参数、设置回滚、手动FAIL新版本及刷新不重放。批量回归使用不同颜色合成图，直接读取隔离IndexedDB严格契约及图像像素，确认保存顺序；注入第二次创建的容量异常后仅重试剩余项，位置唯一且无重复请求。

收尾新增已有批次的追加位置与离开再返回检查：延迟规范化期间离开预览，返回后释放延迟结果；只落盘当前一张，未开始模型请求，其余预览图片不保存。视图代数在保存后与列表刷新后复查，避免旧预览接手新视图。最终Root和mobile类型检查分别退出0，日志`root-types-lifecycle.log`、`mobile-types-lifecycle.log`。

初始桌面新增验收在旧页面失败；样式首轮43通过、1失败，原因是旧测试假定桌面图标居中，但新导航图标与文字横排。更新桌面断言为图标/文字在点击区内，窄屏仍保留原居中断言，定向2项通过。备用编排修复前3失败、7通过，修复后32项通过。追加导入测试首次因模块引用路径未运行，随后修正；Sol预设断言曾错误读取`aria-selected`导致4失败、6通过，改为按钮已有的`aria-pressed`，保留实际选择检查。

末次设置检查曾31通过、1失败：测试同时导出到被服务的目录，刷新得到`Not found`。构建完成且产物稳定后原断言通过。新增批量共享夹具曾把相册按钮定位扩大到整个页面，背景与弹窗同名控件触发严格定位错误，收尾40项为34通过/6失败；限定到实际弹窗后定向8项通过。没有放宽产品断言，也没有把失败轮记作通过。

## 未验证项与剩余风险

真实Sol连接、供应商CORS、真实考试准确率、Firefox/Safari、正式HTTPS部署未执行；默认配置不是可用密钥或正确率保证。独立校验仍可能误判，时间与调用预算不足仍失败或未验证。

Android检查仅验证通用JS打包与桌面模块隔离，不是APK构建/安装或真机相册验收。iOS也未为本次新功能重新构建。用户手机仍是先前版本；Web移动视口不能替代原生授权、文件时间、缓存释放及后台行为。

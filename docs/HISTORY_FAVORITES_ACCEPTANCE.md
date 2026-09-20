# 历史题目公式、收藏和移除（2026-09-16）

## 问题与修复

手机历史页将含 `$x^{2}+2=6$` 的题干直接作为RN Text显示，并在80个字符处切片，因此会显示公式源码、截断数学结构。新增浏览器回归先在旧版复现失败，再改为复用KaTeX/Markdown渲染。

- 历史列表共用一个本地DOM页面，不为每条记录创建WebView。保留完整题干，以CSS限制摘要三行；打开记录读取原解答，不调用模型。
- 列表内部不再重复“历史题目”标题，顶部标签保持唯一入口。
- 向左滑动显示收藏/取消收藏与移除；只展开一行，纵向滚动不触发横向操作。鼠标可拖动，键盘左方向键或“题目操作”按钮也可打开操作区。
- 收藏显示星标；个人中心增加“收藏的题目”及数量。收藏页支持打开、取消收藏和移除。
- 移除先弹确认框，说明题图、解答与收藏会从本机永久删除且无法撤销。取消保留记录；确认只删除选中的ID，不误删当前正在查看的另一题。删除活动题目由既有engine取消并等待保存后执行。

## 数据与安全

收藏是设备本地元数据，键为 `favorite.<sessionId>`，结构 `{schemaVersion:1,favorite:true}`，共用 `LocalFavoriteSchema` 验证。旧记录没有该键则视为未收藏，取消收藏删除该键；不改变现有题目JSON或数据库表，无需破坏性迁移。元数据与解题记录分开写，正在运行的Agent用旧快照保存结果也不会覆盖收藏。

`LocalRepository.list()`返回本地扩展类型LocalSessionView，收藏不进入服务端HTTP协议。只允许收藏现有题目，删除题目同时删除收藏元数据。已有最多100题上限保持不变。

历史DOM仅接收编码后的题目摘要，不携带密钥、图片或完整对话；协议限制100条，每条沿用题干8000字符上限。继续复用本地字体、KaTeX trust=false、禁止raw HTML及外部图片/导航的渲染边界。桥接回调检查目标仍在当前列表中，禁用状态不执行操作。

## 验证

- `pnpm lint`、`pnpm typecheck`、Web构建与原生APK构建通过。
- `pnpm exec vitest run`：63文件、594项通过，包含公式内容跨Android模板字面量桥接、非法载荷、旧记录兼容、收藏不被Agent旧快照覆盖、取消收藏和删除清理。
- 针对性桌面/移动Playwright16项通过；完整62项中先60项通过、2项因新增历史容器导致旧测试选择器重复匹配而失败。将排序断言限定为正文article后，两项定向重跑通过。所有62项最终均有通过记录，未删除断言或放宽内容要求。
- 浏览器实际触屏/鼠标滑动、星标、重载后收藏、个人中心收藏页、取消收藏、取消删除、确认删除及删除非当前题目隔离检查通过；这些使用合成题目，没有实际模型调用。
- `node scripts/test-android-document.mjs`通过：实际APK中的两份本地DOM启动、公式、历史打开/收藏/移除动作桥接、动态高度、离线字体资源与注入安全。
- 初次安装被手机系统拒绝；用户解锁后重试成功。iQOO Neo9/Android16真机通过历史公式显示、实际左滑、收藏星标、个人中心收藏页、移除确认、取消删除及取消收藏。真实题目保留，测试收藏已撤销，不做真实记录删除。
- 0.1.6 / versionCode7，APK 43,224,648字节，SHA-256 `b2da5caf98cac58dd6da3ce6d41631464204b51b5162683d88d7a5ca0f0b006f`。签名与旧包一致，未包含服务器.env或配置密钥。
- 原云盘文件已更新为 `solveflow-0.1.6-arm64.apk`，名称和大小已回读确认：[下载安装包](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。

没有更改模型提示词、Agent循环、供应商配置或服务端数据库；本轮不执行新的付费解题，iOS原生构建仍暂停。

主要文件：`packages/client/src/history-payload.ts`、`local-repository.ts`、`packages/contracts/src/local.ts`、`apps/mobile/src/components/history-panel.tsx`、`dom/history-document.tsx`、`dom/history.css`、`app.tsx`和`components/profile.tsx`。

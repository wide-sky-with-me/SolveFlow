# 本地历史导出

2026-09-20 用户授权：先增加本地导出，以完整核对设备上的套卷作答，再处理历史清理、手势和性能问题。

入口为“我的 → 导出本地记录”。安卓通过系统目录选择器保存到用户选择的位置；Web通过浏览器下载。不启用WebView调试、不添加存储全盘权限、不增加依赖、不发送网络请求，也不导出模型设置、安全存储、密钥或孤立的其他文档。

导出包含原题图、完整会话内各次作答及用户提问、收藏状态、与本题runId对应的脱敏诊断。原记录不变；当前未实现导入功能。导出需等待所有解题/按需任务结束。文件包含个人学习资料，由用户自行保管。

## 格式与失败行为

文件为UTF-8 NDJSON，每行一个JSON对象，统一schemaVersion=1：

1. header：format=`solveflow-history`、createdAt、count。
2. question：record（现有LocalRecord契约）、favorite、diagnostics；逐题写入，最多100条，不把全部原图串在一个内存字符串中。
3. complete：count。读取者须检查首尾计数、实际题数、唯一会话ID和每行契约；没有完整尾标记的文件不可当作完整导出。

仅扫描`record.*`键，再按已验证会话读取关联收藏和诊断；拒绝键/会话ID错配或诊断跨run归属。导出总上限768MB；Web因Blob下载需要聚合内容，另限128MB。

安卓使用锁定expo-file-system 57.0.7的Directory.pickDirectoryAsync/createFile和file.write(bytes, { append: true })，每次最多64KiB，写完立即关闭底层流，再让出JS线程并检查取消。避免长期持有该版本未保留ParcelFileDescriptor的SAF FileHandle；Android回收描述符后会使后续写入失效。取消或失败尝试删除本次新建的部分文件；清理失败明确提示，不把部分文件称为成功。取消系统目录选择不创建文件。

## 验证与故障修复

`pnpm lint`、`pnpm typecheck`通过；10项聚焦导出测试覆盖白名单、首尾完整性、取消、失败清理、诊断归属、大图分块及原生AbortSignal兼容。浏览器桌面和手机导出测试通过：下载文件完整、原记录不变、无模型请求。当前全量回归另见[历史管理](LOCAL_HISTORY_MANAGEMENT.md)。

真机：0.1.32长句柄写入在2/99失败，0.1.33分块但仍持有长句柄在39/99失败。0.1.34改为每块独立追加后，普通APK安装成功并核实versionCode35；99/99全部导出，76,805,918字节，含99条题目与101次运行。逐行契约、首尾计数、唯一会话ID及与此前99个历史ID匹配均通过；手机与电脑SHA256一致。实际APK图文资源回归通过。原图、真实作答及分析仅保存在被Git忽略的私有目录，未写入仓库。

Windows ADB37.0.1默认USB后端在本设备大文件传输时挂起；按官方平台工具说明，为本任务ADB服务进程设置ADB_USB_LEGACY=1，server-status确认NATIVE后端后，非流式安装与完整导出传输成功。未修改全局环境、未清空手机应用数据。依据：[Android平台工具发布说明](https://developer.android.com/tools/releases/platform-tools)。

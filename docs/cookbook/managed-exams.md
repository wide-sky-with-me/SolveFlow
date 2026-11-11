# 中心考试平台启动与部署

独立入口，见[运行语义](../subsystems/managed-exams.md)。切换旧站须验收并保留回退。

## 本地开发

1. 使用根`package.json`锁定的Node/pnpm，执行`pnpm install --frozen-lockfile`、`pnpm build:exam-web`。
2. 准备独立PostgreSQL17数据库。复制[配置例](../../infra/exam-web/config.example.json)到忽略目录，权限0600；`origin`用`http://127.0.0.1:3190`，`databaseUrl`指向新库，`storage`改为`{"type":"local","root":"/absolute/private/images"}`。本地不必配置Redis。
3. 设置`SOLVEFLOW_EXAM_CONFIG`为绝对路径，先以`SOLVEFLOW_EXAM_ROLE=migrate pnpm start:exam-web`新增迁移，再以`SOLVEFLOW_EXAM_ROLE=bootstrap pnpm start:exam-web`初始化管理员、SAT模板和执行名额。初始化不会覆盖已有管理员密码。
4. `pnpm start:exam-web`在回环3190启动API。`liveCalls=false`时可以管理用户/考试，提交解题会明确报未配置。
5. 真实答题在私有配置加入`WebStoredModelsSchema`格式的`models`（solver/verifier、HTTPS端点），设置`liveCalls=true`。密钥只存服务端；两套方案见[服务配置](../subsystems/managed-model-services.md)。

登录后创建学生及老师账号（老师使用“老师/技术支持”身份），添加所需版本的考试模板。在“考试安排 → 场次”新建父场次，填写名称并选择类型与模板；进入“查看考试”，再“新建具体考试”设置名称、时间、学生、多位老师及答案模式。场次人员从下级分配自动汇总。

两级“编辑”均可改名；具体考试“人员与错题配置”可追加学生、逐人改老师及入场前的错题配置。删除须确认，进行中的考试须先结束。规则见[场次分层](../subsystems/managed-exam-events.md)及[分配](../subsystems/managed-exam-allocations.md)。限定时间按浏览器时区填写、UTC保存；不限时间由学生点击开始，双方结束规则归[计时](../subsystems/managed-exam-timing.md)。错题模拟不承诺精确分数。

## 看板与统计

按具体考试筛选看板，“查看全部”进入跟踪，待处理数进入问题队列。趋势卡片的“发布明细”查看分时段统计；图表及刷新口径见[控制台](../subsystems/managed-exam-dashboard.md)，分页见[列表](../subsystems/managed-exam-lists.md)。

## 跳题与老师跟踪

学生拍照、核验后查看本题答案，再主动点“下一题”。右上“总览”查看本节；“重新解答”复用原图/补图。头像菜单进入考试记录，Logo回首页；顶栏“考试状态”内确认结束。规则见[逐题流程](../subsystems/managed-student-flow.md)。切走不停止任务，“停止作答”只取消本题。

老师在实时跟踪查看模块/题号和统计；详情导航默认展开，选题查看，标题栏居中计时；操作记录用弹窗。WS通知位置和结果，断开由HTTP轮询同步，不重做题。

## 老师作答

打开学生，从题目导航选已拍题；切到“AI 答题”再点“开始 AI 答题”，或选“手动作答”，已核验题也支持。切换不发起请求。左侧保留选项全文，右侧选编号，自动生成答案。简答/作文、未识别或选项不全时填写答案。补充处理意见，点“保存并通知学生”发布。

再次手动作答会带入学生当前答案。已有人工答案时，“重新核验”不可用，须“AI 答题”重新生成并核验。学生补图、另一位老师修改或任务结果更新后，旧草稿报“本题已更新”，应取消旧草稿、同步后再处理。未拍题须先由学生上传题图。

只需文字沟通时切到“发消息”，在右侧填写后发送，无须填答案；学生从“老师消息”查看并定位本题。这不会更改答案或解除红色问题，见[独立消息](../subsystems/managed-exam-messages.md)。

## 处理红色问题

1. 老师打开“待处理题”，按学生或问题类型筛选，点“查询”后点对应行进入题目，查看原图、补图和AI核验意见；也可沿用看板红色入口。
2. 在“AI 答题”面板，已有完整答案可“重新核验”；识别或答案有问题可“开始 AI 答题”。提交按钮明确发起一次计费任务，切换面板和刷新不会重放。
3. 选择题直接改选项；未识别、简答/作文填写答案。补充处理意见后点“保存并通知学生”发布，两端该题红色提醒解除，学生收到“已解决”通知。改选项和取消草稿都不自动写入。
4. 报“本题已更新”时先同步新图和新结果再判断，不把旧表单直接套到新版本；网络失败保留草稿，先检查当前状态再重试。

学生点击“已解决”可定位题位并打开最新答案，成功读取后通知标为已读；读取失败可重试。通知没有自动跳题或重做题。规则见[问题总览与通知](../subsystems/managed-exam-attention.md)。

## 保存失败与过期场次

提示保存未确认时，点“同步并重试”或“返回题目”，见[提交恢复](../subsystems/managed-exam-submissions.md)。

答案保存失败只重试保存，不重调模型；取消和新版本优先。持续中断先查数据库，不自动重做；不保证进程崩溃后的内存结果恢复。

过期及单场互斥规则见[考试计时](../subsystems/managed-exam-timing.md)。

## 隔离验证

`pnpm test:exam-web --image=postgres:17.11-alpine3.23`先构建，再用随机临时容器执行回归，各组180秒，失败即停止。分组由[测试入口](../../scripts/test-managed-exams.mjs)维护，可用`--suite=management`单跑场次与消息，其他选择见脚本。须预先准备17系镜像，测试不自动下载。

Chrome须安装到`/usr/bin/google-chrome`；`SOLVEFLOW_TEST_CHROME`仅部分夹具支持。只用合成题和假模型；容器仅映射回环随机端口，内存盘，结束删除。截图位于忽略的`.runtime/`，具体目录看测试源码或验收报告。

## 计时升级与回退

新应用启动要求迁移12，新增图片索引且不重写旧数据。先备份、暂停新任务并等待活动请求收尾，运行全部migrate，再同步替换API、worker、events及前端。保留题图、答案和运行，不使用reset/drop升级。迁移7的不限时与结束语义仍适用，已有不限时数据不能回退到不支持NULL截止时间的版本。

迁移9新增校验期草稿和答案变更通知；迁移10新增独立教师消息；迁移11把每条原考试包装为同名父场次，不合并同名记录、不改变原考试或分配ID。升级后检查旧学生记录、成员汇总及两级改名。旧接口新增考试仍自动建立默认父场次；回退应用会失去新分层及消息界面，数据库增量表应保留，不反向删除。失败保留备份与卷，在隔离库验证恢复。

## 容器入口

[Compose](../../infra/exam-web/compose.yaml)分别编排gateway、api、worker、events、postgres、redis和一次性migrate/bootstrap。默认连接独立私有S3/COS桶；需要同机存储时使用[单机Docker指南](managed-exam-single-host.md)。数据库/Redis不映射宿主端口；S3启动检查ACL，COS兼容仍须单独联调。

1. 准备私有S3/COS桶和域名、配置JSON及[部署环境文件](../../infra/exam-web/env.example)。JSON里的数据库密码须与环境文件一致；`trustedProxyCidrs`只填写实际网关所在的可信网段，配置例为常见Docker地址池，部署前按真实网络收窄；直连开发留空，禁止信任公网全网段。配置文件由容器UID1000读取，设置正确所有者和0600权限。
2. 确认新入口端口没有被已有网站占用。生产`origin`必须HTTPS，模型端点必须HTTPS；首次配置包含私有bootstrap密码，初始化后可移除bootstrap字段。
3. 在仓库根执行`infra/exam-web/deploy.sh /absolute/private/deploy.env`。脚本校验、构建镜像、启动独立PG/Redis、导出逻辑备份、新增迁移、幂等初始化，最后启动应用和网关。
4. 上线前检查HTTPS登录、对象桶私有性、真实答题、弱网恢复和备份可恢复；确认后才切正式路由。现有服务不会被脚本停止来抢端口。

镜像、私有S3及公网证据见单机指南。失败保留卷和备份，禁止`down -v`、reset/drop。应用回退须兼容schema；恢复先在隔离库演练。

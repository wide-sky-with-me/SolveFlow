# 公网手机拍题部署

精简入口为[apps/photo-web](../../apps/photo-web/README.md)，与原生及Mac完整版分开构建/部署。浏览器仅显示密钥登录、考试、拍照/相册和历史；单题简答不自动校验。SAT、ACT、AP、ESAT、TMUA、TARA及未指定考试沿用共享枚举，不新增题库。

## 构建和检查

使用根清单锁定的Node/pnpm：`pnpm build:photo-web`、`pnpm test:photo-web`。类型另用`pnpm --filter @solveflow/photo-web typecheck`；服务集成属于offline组。密钥/图片/成品及日志留忽略目录，真实模型测试另需明确授权。

`pnpm package:photo-web`生成`.runtime/photo-public-release`，包含浏览器静态资源、服务端打包代码、当前Node及当前安装树的Sharp运行依赖；清单记录锁文件/逐文件SHA256。它是Linux同架构产物，上传前核对目标架构及Node启动，不用源仓库环境或未知最新依赖替代。

打包目标必须为空，更新时先构建，再运行`node apps/photo-web/package-release.mjs .runtime/<新版本目录>`；不覆盖旧包。已授权收费验收可临时设置`SOLVEFLOW_PHOTO_DISPATCH_LIMIT=8`，它限制本进程实际模型传输次数（失败也计数），日志只有计数；验收后移除并重启，普通服务不设置此项。

## 私有配置

`SOLVEFLOW_PHOTO_CONFIG`指定0600 JSON：`origin`为精确HTTPS来源，`secret`为至少32字符随机会话签名秘密，`accessKeys`为`[{id,hash}]`，`models`遵循共享`WebStoredModelsSchema`。`hash`为高熵访问密钥的SHA256，不用短口令；模型配置只复制到私有服务器文件，不提交Git或返回浏览器。服务端没有公开配置或模型代理接口。

`SOLVEFLOW_PHOTO_STATE`保存额度账本；默认每个访问身份每天100次提交、全局4项、同身份2项，UTC日切换。提交包含重新尝试，次数在模型派发前落盘；取消后也不回退已登记提交。模型阶段及实际请求次数仍由Agent预算控制，不能把提交数当API计费次数。服务重启保留账本与浏览器历史，但会话失效，需重新登录。

历史按访问身份保存在当前浏览器，不跨手机同步。退出不删历史；清理网站数据会丢失，精简版没有备份导出入口。新增访问身份使用不同稳定`id`，更换密钥但保留`id`可继续读取该浏览器旧历史。

## HTTPS与服务

公网使用有效HTTPS；HTTP仅供本机开发。可在现有服务器使用Node直接终止TLS：`SOLVEFLOW_PHOTO_TLS_KEY`/`SOLVEFLOW_PHOTO_TLS_CERT`指定私有证书，`SOLVEFLOW_PHOTO_PORT`默认为443。服务以普通用户运行，只有绑定低端口所需能力，并限制资源；不要重启或覆盖其他容器。

`SOLVEFLOW_PHOTO_ACME`可指定独立webroot，在80端口只提供严格匹配的ACME挑战，其余请求跳转固定HTTPS入口。Let's Encrypt IP证书有效期短，必须有定时续期：建议每天两次运行固定版本Certbot的webroot续期，成功后把证书复制到服务私有TLS目录，再向本服务发送SIGHUP热加载。续期失败保留现有证书并记录错误，不能用忽略TLS校验冒充部署成功。

Ubuntu现有服务器可使用[安装脚本](../../apps/photo-web/deploy/install.sh)：上传并校验后，在`/home/<用户>/.local/share/solveflow-photo`建立`current`指向版本目录、`shared/config.json`和首次签发的`certbot`目录；以root执行`bash current/deploy/install.sh <服务根目录> <用户>`。只创建`solveflow-photo.service`和`solveflow-photo-renew.timer`；续期脚本固定Certbot镜像摘要。上线后执行`sudo /usr/local/sbin/solveflow-photo-renew <服务根目录> <用户> --dry-run`检查挑战与续期，检查定时器下一次运行时间。更新包后切换`current`并明确重启本服务，重复安装不会隐式中断活跃题目。

首次上线先验证未登录接口401、跨站403、错误密钥限制、静态构建不含真实密钥、照片解码/取消/重复请求保护，再验证移动页面和真实模型；只有明确授权才发付费请求。源IP定位不能代替手机运营商的实际速度验收。

GitHub Pages只能托管静态资源，不能单独承担本服务。EdgeOne Pages可托管函数，但需对应账号、配额和地区/域名条件；免费额度不能当作模型调用免费。平台选型与本轮公网地址、服务名称、续期验收及命令结果见当次发布报告。

## 更新与恢复

新包放独立版本目录，清单校验后原子切换`current`并仅重启本服务；私有配置、账本与TLS目录置于共享位置。失败切回旧版本，不删除账本或浏览器历史，不自动重放付费请求。清理测试服务只按本次PID/单元名称，不停止用户其他应用。

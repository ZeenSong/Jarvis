# M3：CasaOS 原生接入

实施顺序：CasaOS 宿主部署与真实 API → 应用安装/启停的双端闭环 →
Grafana/Portainer/Immich → 完整 Shell/Dynamic UI → Core/Memory/Search/Schedule → Gitea 自动学习。
目前仅准备宿主安装入口，**尚未安装 CasaOS，尚未通过真实 API 验收**。

## 当前主机安装

针对当前 Ubuntu 20.04 amd64、Docker 26/API 1.24、尚未安装 CasaOS 的主机。
Jarvis 保留 K3s，第三方应用由原生 CasaOS 管理宿主 Docker。

```bash
node deploy/m3/casaos-host.mjs prepare
diff -u .local/m3-casaos/upstream.sh .local/m3-casaos/install-reviewed.sh
sudo "$(command -v node)" deploy/m3/casaos-host.mjs install
```

`prepare` 不修改宿主服务，仅在 `.local/m3-casaos` 写预检和待执行脚本。
脚本固定官方 `https://get.casaos.io/v0.4.15` 的 SHA-256；URL 内容变化会拒绝执行。
此上游脚本中各组件版本不相同，不能把安装器 URL 当作所有组件的版本。
发布前还需锁定组件归档校验和与 App Store 快照。

官方脚本会调用 Docker API override，覆盖 `/etc/systemd/system/docker.service.d/override.conf`
并重启 Docker。本机已支持 API 1.24，适配版仅删除该调用，另将临时目录改为唯一目录。
其余原生安装行为保留：安装系统依赖及 CasaOS 服务、配置 Samba/udevil/devmon、安装 rclone。
存在既有 CasaOS 或 rclone 时预检拒绝安装，避免覆盖已有安装。
预检也会模拟 APT 依赖修复；若提议安装、移除或配置任何包，会停止并在报告中列出，
不会自动修复与 CasaOS 无关的系统依赖。当前机器发现 APT 残留 NVIDIA 570 包依赖，
而实际运行手工安装的 595.84；不得直接执行 fix-broken 覆盖当前驱动库。
执行前在 root 专属 `/var/tmp/jarvis-before-casaos-*` 备份相关宿主配置和容器清单。
此备份不是完整系统备份；安装失败不得自动覆盖当前配置或删除应用数据。

当前 agent 无免密 sudo，需要用户在终端输入密码执行上面的 install 命令。
Node 通过 nvm 安装时不在 sudo 的默认 PATH 中，因此安装命令使用当前 Node 的绝对路径。
当前主机路径为 `/home/root2023/.nvm/versions/node/v22.17.0/bin/node`。
不要把 sudo 密码发到聊天中。该步骤是一次性环境部署，不是 Demo 中的手工补步骤。

## 安装之后的阶段关口

### 本机绕过 APT 安装流程

```bash
node deploy/m3/casaos-host.mjs prepare --without-apt
sudo "$(command -v node)" deploy/m3/casaos-host.mjs install --without-apt
```

该模式仍使用 APT 的本地元数据、只读模拟和 `apt-get download` 下载包，但不运行
`apt-get install/update/fix-broken`，不修改宿主 dpkg 状态库以欺骗依赖检查。
仅在临时的依赖规划副本中排除已知残留的 `xserver-xorg-video-nvidia-570` 记录；
Samba 使用与现有 samba-libs 一致的版本，拒绝任何升级、移除和显卡/Docker/内核包。
下载包按仓库 SHA-256 校验，清单位于 `.local/m3-casaos/dependencies.json`。
实际安装使用 `dpkg --install` 明确列出的 deb 文件，不使用 force-depends 或 configure -a。
根权限安装前核对包数据库未改变、校验归档、复制到 root 专属备份目录后执行。
原有 NVIDIA 依赖问题仍然存在，但不参与这批独立依赖的安装。

首次在当前机器准备出的清单为 12 个新包：python3-dnspython、python3-crypto、
python3-tdb、python3-samba、samba-common、samba-common-bin、tdb-tools、samba、
cifs-utils、mergerfs、smartmontools、udevil。安装前准备步骤可重复执行。
若 dpkg 安装中断，先重新 prepare 根据实际包状态检查，不能强制跳过错误。

1. 检查 CasaOS 服务实际运行、监听地址与现有 Jarvis 健康情况。
2. 完成 CasaOS 管理身份初始化，凭据仅由服务端保存；限制对外暴露范围。
3. 经 `/v2/app_management` 验证商店、已安装应用、metadata、日志、健康、更新状态。
4. 在 Jarvis 的应用任务链中接通真实 install/start/stop；不得以 Docker CLI 替代。
5. 记录服务版本、归档/镜像 digest、存储目录、认证方式与重启恢复证据。

后续部署采用管理员+家庭成员；照片使用独立 Immich 演示图库；Brave Search
凭据通过私有配置提供；新应用学习对象为 CasaOS 商店中的 Gitea。

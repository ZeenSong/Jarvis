# 单机部署与 Android 安装

需要 Linux、systemd、Docker 和 sudo。先按 README 构建 `jarvis-server:0.1.0`，并拉取 `postgres:17-alpine`。从仓库根目录运行：

```bash
sudo --preserve-env=HTTP_PROXY,HTTPS_PROXY,NO_PROXY,http_proxy,https_proxy,no_proxy bash deploy/bootstrap-host.sh
```

脚本安装 Tailscale/K3s、导入镜像、创建独立 PostgreSQL 数据卷和随机凭据，最后输出 App 地址与一次性配对码。Tailscale 登录链接需要使用者在浏览器中授权。不要把密码、Token 或完整 Secret 输出发到公开 issue。

K3s 使用独立 containerd，API 绑定 Tailscale 私网地址。既有 Docker 工作负载不迁移；生产数据库不复制测试数据。默认价格表为空，需要按供应商实际报价配置。

Tailscale 使用校验过的官方 amd64 静态包及其 systemd unit，不依赖 APT；这种安装方式需要单独维护版本。其他架构请参考 [官方安装文档](https://tailscale.com/docs/install/linux)。

## cgroup 检查

如果系统处于混合 cgroup 模式，而内核未编译 v1 memory/cpuset 控制器，K3s 会拒绝启动。先根据 [Kubernetes cgroup 文档](https://kubernetes.io/docs/concepts/architecture/cgroups/)评估系统兼容性；建议通过 GRUB 临时参数做一次启动验证，再决定是否永久设置。

仓库提供 `sudo bash deploy/enable-cgroup-v2.sh` 用于添加独立 GRUB 配置。该脚本不会自动重启；重启会中断其他应用与容器，应在维护时间执行。撤销方式：将 `/etc/default/grub.d/90-jarvis-cgroup-v2.cfg` 移出该目录，运行 `sudo update-grub`，然后重启。

## Android

1. 从 GitHub Release 下载 Jarvis APK，并安装 [Tailscale Android](https://tailscale.com/download/android)。
2. 手机登录与服务器相同的 Tailnet，开启 VPN。
3. 在 Jarvis 输入部署输出的 `http://100.x.x.x:8080` 与配对码。
4. 显示 ONLINE 后检查 Server、Agents 和 AI。Home 可开启带常驻通知的后台连接服务。

M1 APK 为调试签名的测试版本，文件名带 `debug`，适用于个人测试；它不含服务器地址或设备 Token，首次安装需要自行配对。升级应使用同一签名。

配对码过期时可在服务器生成新的码：

```bash
sudo k3s kubectl --server="https://$(tailscale ip -4):6443" -n jarvis exec deployment/jarvis-server -- node dist/apps/server/src/pair.js
```

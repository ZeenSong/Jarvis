# 四台摄像头后台连接与 Tailscale 转发

> 机密记录：本文件包含摄像头账号密码，仅保存在本机，权限应为 `0600`，并已加入本地 Git 排除。不要提交、上传或截图分享。

更新时间：2026-09-30（Asia/Shanghai）

## 当前结论

- 四台设备均为 Yi Dome + `yi-hack-v5`，摄像头局域网地址在 `192.168.3.0/24`。
- 管理后台和 ONVIF 使用 TCP `80`；RTSP 使用 TCP `554`。
- 每台摄像头当前的 ONVIF/HTTP/RTSP 使用同一组本机账号密码；账号来自 Home Assistant 的 ONVIF 条目，RTSP 账号密码同时来自 Frigate 的本地秘密文件。
- 已部署本地 HTTP/RTSP 转发服务，监听地址仅为本机 Tailscale 地址 `100.77.157.73`，不会监听 `192.168.3.135` 或公网地址；HTTP 层会兼容 yi-hack 的 `.gz` 静态网页资源。
- 已验证：四台管理接口返回 HTTP `200`；四台主码流/子码流均可通过转发读取，均为 H.264，主码流 `1280x720@20fps`，子码流 `640x360@20fps`。

## 摄像头连接信息与保存的密码

### 客厅 / 192.168.3.199

- 型号：`yi_dome`；yi-hack：`yi-hack-v5 0.4.1`；硬件：`43CN`
- MAC：`b0:d5:9d:ac:0f:bc`；序列号：`YD9GR3KP7Z170508`
- HTTP 管理：`192.168.3.199:80`，鉴权：Basic；ONVIF 同端口使用 WS-Security UsernameToken/PasswordDigest
- RTSP：`192.168.3.199:554`，鉴权：Basic；主码流：`/ch0_0.h264`；子码流：`/ch0_1.h264`
- 用户名：<code>jarvis_cam</code>
- 已保存密码：<code>6ff5bb6d2807b5f076b88b43722cb723</code>
- HA ONVIF 条目：`01M2G6Z01KNBCCBA7GPKC2TWKS`；yi-hack 条目：`01M2WK1V5MXCYMA0ZXAR1QET6A`
- Frigate 秘密变量：`FRIGATE_RTSP_PASSWORD` / `FRIGATE_RTSP_USER`
- Tailscale 转发：Web/ONVIF `100.77.157.73:18080`；RTSP `100.77.157.73:15540`

### 花园 951A / 192.168.3.185

- 型号：`yi_dome`；yi-hack：`yi-hack-v5 0.4.1`；硬件：`63CN`
- MAC：`58:70:c6:19:95:1a`；序列号：`Y9XRMBC0HS180316`
- HTTP 管理：`192.168.3.185:80`，鉴权：Basic；ONVIF 同端口使用 WS-Security UsernameToken/PasswordDigest
- RTSP：`192.168.3.185:554`，鉴权：Basic；主码流：`/ch0_0.h264`；子码流：`/ch0_1.h264`
- 用户名：<code>jarvis_cam_951a</code>
- 已保存密码：<code>CsIKOP43b1L3MgY3wgHobkFn0k5Hh2YkbLObV4-I_Ws</code>
- HA ONVIF 条目：`01M2WT6VMARP2ZE0N08E1CTAQ3`；yi-hack 条目：`01M2WTJ3EFAXX1RKG6WYPXPD3S`
- Frigate 秘密变量：`FRIGATE_RTSP_PASSWORD_951A` / `FRIGATE_RTSP_USER_951A`
- Tailscale 转发：Web/ONVIF `100.77.157.73:18081`；RTSP `100.77.157.73:15541`

### 车库 DA2F / 192.168.3.200

- 型号：`yi_dome`；yi-hack：`yi-hack-v5 0.4.1`；硬件：`43CN`
- MAC：`b0:d5:9d:a1:da:2f`；序列号：`YR8NC1BAS4170508`
- HTTP 管理：`192.168.3.200:80`，鉴权：Basic；ONVIF 同端口使用 WS-Security UsernameToken/PasswordDigest
- RTSP：`192.168.3.200:554`，鉴权：Basic；主码流：`/ch0_0.h264`；子码流：`/ch0_1.h264`
- 用户名：<code>jarvis_cam_da2f</code>
- 已保存密码：<code>AOryf-hc2M8lO5woPLK0KgY9cB5AF-5nutm-KbHYI08</code>
- HA ONVIF 条目：`01M2WT8T0H062QK64KRMN7G7X1`；yi-hack 条目：`01M2WTM7CD2CE8RG9S40956PCK`
- Frigate 秘密变量：`FRIGATE_RTSP_PASSWORD_DA2F` / `FRIGATE_RTSP_USER_DA2F`
- Tailscale 转发：Web/ONVIF `100.77.157.73:18082`；RTSP `100.77.157.73:15542`

### 大门 DA8D / 192.168.3.201

- 型号：`yi_dome`；yi-hack：`yi-hack-v5 0.4.1`；硬件：`43CN`
- MAC：`b0:d5:9d:ab:da:8d`；序列号：`Y2O2S4W4I3170508`
- HTTP 管理：`192.168.3.201:80`，鉴权：Basic；ONVIF 同端口使用 WS-Security UsernameToken/PasswordDigest
- RTSP：`192.168.3.201:554`，鉴权：Basic；主码流：`/ch0_0.h264`；子码流：`/ch0_1.h264`
- 用户名：<code>jarvis_cam_da8d</code>
- 已保存密码：<code>3nlLSzrl48mGuoeXwoZHA0PJwyBjmQhXhhBC4J1aLTo</code>
- HA ONVIF 条目：`01M2WT9NKBZEWDPD16MHCGQDF7`；yi-hack 条目：`01M2WTPRCC0TSWXQMSCR08H6VE`
- Frigate 秘密变量：`FRIGATE_RTSP_PASSWORD_DA8D` / `FRIGATE_RTSP_USER_DA8D`
- Tailscale 转发：Web/ONVIF `100.77.157.73:18083`；RTSP `100.77.157.73:15543`

## 后台连接方式

### Home Assistant ONVIF

Home Assistant 的四个 ONVIF 条目均连接到摄像头的 `http://CAMERA_IP:80/onvif/device_service`，使用 WS-Security UsernameToken/PasswordDigest，并已创建主 profile 摄像头实体。当前主 profile 实体如下：

- 客厅：`camera.cam_1_profile_0`
- 花园 951A：`camera.yi_dome_951a_profile_0`
- 车库 DA2F：`camera.yi_dome_da2f_profile_0`
- 大门 DA8D：`camera.yi_dome_da8d_profile_0`

### Home Assistant yi-hack

四个 `yi_hack` 条目连接到各摄像头的 HTTP `80` 和 RTSP `554`，并使用本机 MQTT broker `192.168.3.135:1883` 的 `yicam*` topic 前缀承载设备事件/控制。摄像头本身的 TCP `1883` 当前未开放。已确认 ONVIF 的 device/media/PTZ 服务端点分别为 `/onvif/device_service`、`/onvif/media_service`、`/onvif/ptz_service`。

### Frigate / go2rtc

Frigate 使用本地秘密文件 `/home/root2023/.config/jarvis/secrets/frigate.env` 展开 RTSP 账号密码，再由 go2rtc 直连四台摄像头：

```text
主码流：/ch0_0.h264
子码流：/ch0_1.h264
摄像头 RTSP 端口：554
Frigate 内部 restream：127.0.0.1:8554
```

Frigate 的四个 camera 名称为：`yi_dome_living_room`、`yi_dome_garden_951a`、`yi_dome_garden_da2f`、`yi_dome_garden_da8d`。

## Tailscale 访问方式

### 已立即可用的本地转发

转发服务：`jarvis-camera-forward.service`（systemd user service，已启用并运行）。HTTP 转发会把摄像头的 `index.html.gz`、`pages/*.html.gz`、`js/*.js.gz`、`css/*.css.gz` 等资源解压后返回，避免网页登录后一直加载。

| 摄像头 | Web/ONVIF 转发 | RTSP 转发 | 目标地址 |
|---|---:|---:|---|
| 客厅 / `192.168.3.199` | `100.77.157.73:18080` | `100.77.157.73:15540` | `192.168.3.199:80/554` |
| 花园 951A / `192.168.3.185` | `100.77.157.73:18081` | `100.77.157.73:15541` | `192.168.3.185:80/554` |
| 车库 DA2F / `192.168.3.200` | `100.77.157.73:18082` | `100.77.157.73:15542` | `192.168.3.200:80/554` |
| 大门 DA8D / `192.168.3.201` | `100.77.157.73:18083` | `100.77.157.73:15543` | `192.168.3.201:80/554` |

示例：

```text
管理页：http://100.77.157.73:18080
主码流：rtsp://100.77.157.73:15540/ch0_0.h264
子码流：rtsp://100.77.157.73:15540/ch0_1.h264
```

RTSP URL 中的用户名和密码使用上表对应的账号密码；如果密码包含 URL 保留字符，请在 URL 中进行 URL 编码，或在播放器的认证字段中单独填写。

### 完整子网路由（推荐，需 root 执行一次）

当前 Tailscale 客户端尚未声明子网路由，因为本次会话没有 root sudo 权限。若要让 Tailscale 设备直接访问原始 `192.168.3.x:80/554`，在这台主机上执行：

```bash
sudo tailscale set --advertise-routes=192.168.3.0/24
```

然后在 Tailscale 管理控制台批准 `root2023-super-server` 的 `192.168.3.0/24` 路由。批准后，客户端可以直接使用摄像头原始地址；上面的端口转发仍可作为备用入口。

## 本机文件与运维

- 转发程序：[camera-forward.js](/home/root2023/Codes/Projects/Jarvis/.local/camera-forward.js)
- systemd 用户服务：`/home/root2023/.config/systemd/user/jarvis-camera-forward.service`
- 账号密码来源：Home Assistant `/DATA/AppData/homeassistant/config/.storage/core.config_entries` 与 Frigate `/home/root2023/.config/jarvis/secrets/frigate.env`
- 查看状态：`systemctl --user status jarvis-camera-forward.service`
- 重启服务：`systemctl --user restart jarvis-camera-forward.service`

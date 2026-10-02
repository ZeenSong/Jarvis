# 家 · 此刻：Home Assistant 家庭中枢

2026-09-30 实施。入口：`/family-home/home`。

- HA 是家庭实时设备、状态、自动化和普通历史的唯一事实源。
- 人使用 HA 原生 Sections + Bubble Card 3.4.1 + card-mod 4.2.1。
- Hermes/Jarvis 使用现有 HA MCP / HA Tool。未新增 Jarvis 控制 API、状态数据库、Redis 镜像或事件入口。
- HA MCP 仅保留 Assist；移除了已退出的 `frigate_services` 引用。`GetLiveContext` 已实测返回中文设备名称和区域。

## 摄像头模型

| Device | Area | 主视频 entity_id |
| --- | --- | --- |
| 卧室摄像头 | 卧室 | `camera.bedroom_camera` |
| 花园走廊摄像头 | 花园 | `camera.garden_corridor_camera` |
| 车库摄像头 | 车库 | `camera.garage_camera` |
| 大门摄像头 | 大门 | `camera.front_gate_camera` |

每台一个 Device，全部通过 `yi_hack` 接入。主视频、事件连接、移动侦测等共 80 个实体改为中文 Friendly Name 与语义化 ID。Device 标签为 `camera`、`security`；主视频、事件连接、移动侦测标注 `jarvis_exposed`。标签本身不是权限控制；主要实体另由 HA Assist exposure 配置暴露。

四个 ONVIF 条目和一个 Frigate 条目已移除。Frigate 容器已停止（原策略 `unless-stopped`），配置与录像未删除。MQTT broker 继续使用原有实例；修复了原先仅允许 `yicam/#`、遗漏其他三台摄像头主题的 ACL，新增的精确前缀是 `yicam_951a/#`、`yicam_da2f/#`、`yicam_da8d/#`，用于既有 yicam 与 homeassistant 用户。

旧“摄像头事件”Dashboard 从侧边栏隐藏，旧 URL 提供新安防页入口。未接入的灯光、空调、温湿度不显示虚构状态；人员位置未知时如实显示未知。

## UI 配置

- `dashboard.json`：可通过 HA `lovelace/config/save` 导入到 `family-home`，包含首页 / 房间 / 安防 / 更多，房间 Popup、四路实时视频、短程 PTZ、底部导航。
- `quiet-home.yaml`：放入 HA `/config/themes/`，调用 `frontend.reload_themes`。
- Dashboard 使用 HA 实时 Jinja 模板与实体状态，不复制家庭状态。

## yi-hack-v5 视频兼容修复

当前 HACS yi-hack 的 `camera.py` 每次获取流地址会调用摄像头 `links.sh`，默认抓图调用 `snapshot.sh`。这些 CGI 在此批 v5 摄像头上出现超时、空响应，导致卡片持续重连；曾出现 RTSP 正常但 HA 抓图 500。

`patch-yi-v5-stream.py` 只针对 `HACK_NAME == yi-hack-v5`：

1. 从既有连接配置直接生成已验证的 `/ch0_0.h264` RTSP 地址，对用户名密码 URL 编码。
2. 强制 TCP，并利用 HA 原生 stream 生成静态预览，避免摄像头端反复启动抓图。
3. 不改变其他 yi-hack 型号，也不引入独立视频接入或新增 Device。

先备份 `/config/custom_components/yi_hack/camera.py`，在 HA 容器执行脚本后重启 HA。脚本有幂等标记；上游结构变化会触发断言。**HACS 更新 yi-hack 可能覆盖该本地补丁，更新后需要检查上游是否已修复，并重新验证视频。**

## 验证与回滚

已检查：四个物理摄像头对应四个 Device；ONVIF/Frigate 注册条目清理；4 路 RTSP 为 H.264 1280×720；HA 原生流与抓图；浏览器视频解码和播放进度；房间 Popup；卧室左右短程 PTZ；四台 MQTT 在线与真实卧室 motion；HA 重启后的设备/配置恢复；MCP tools/list 与 GetLiveContext。

受保护的完整 HA 配置备份、变更前 yi-hack 源文件、MQTT ACL、API 验证结果位于本机 `.local/ha-redesign/`（不提交）。备份包含认证数据，不能上传或加入 Git。历史录像保持原位。

回滚应停止 HA 后恢复备份中的注册表、Dashboard 和配置，再恢复原 `camera.py`，避免运行时直接改 `.storage`；恢复 MQTT ACL 前确认是否仍需要另外三台摄像头。若恢复 Frigate 接入与录像服务，再启动原容器。不要回滚整个 HA 历史数据库或删录像。

主动智能的未来扩展只考虑 `HA → apps/server home.event`，有长期价值的事件才落 PostgreSQL。普通状态仍留在 HA。`homeAssistantState()` 与 Hermes 工具的 capability consolidation 留待单独任务。

## 2026-10-01：事件恢复与 SD 卡回放

重启后视频在线但事件断开，检查发现 `jarvis-mosquitto` 容器处于 exited 状态。已启动，并将运行容器及 `/DATA/AppData/mosquitto/compose.yaml` 的重启策略同步改为 `always`。再次单独重启 broker 后，四个 `*_camera_status` 自动回到 `on`。没有进行整机重启验证。

新增回放子页面 `/family-home/recordings`，从安防页或任一房间 Popup 的“SD 卡录像回看”进入。仍保留四个主导航页。

- 按摄像头、日期选择 SD 卡录像；全天时间轴、手动时间定位、前后片段和连续播放。
- 按 HA 已记录的移动、声音、婴儿哭声事件筛选，点击定位到录像内对应秒数。
- 事件索引来自 HA recorder，排除日初合成状态；没有维护第二份状态数据库。
- 摄像头 v5 的目录接口仅提供日期和文件，不提供海雀式人形/宠物分类。HA 停机、事件连接中断或历史清理期间的事件无法追溯恢复。无事件索引的旧录像仍能按时间查看。
- 文件名按摄像头本地时间解释，事件按 HA 配置时区转换。摄像头与 HA 时钟必须一致；SD 卡中错误的旧日期也会如实展示。
- 此批固件录像片段最长按约一分钟定位，真实时长由浏览器读取并校验。SD 卡循环覆盖后旧索引需刷新。

实现完全位于 HA：`custom_components/yi_sd_recordings/` 和 `www/yi-sd-recordings-card.js`。不新增设备、实体、Jarvis 控制层或录像存储。浏览器只保留当前目录和事件元数据。播放时 HA 鉴权并将摄像头原 MP4 分块转发给浏览器；支持 HTTP Range，纠正摄像头错误的 Content-Type；无磁盘写入或录像缓存。正常浏览器播放缓冲仍存在。

部署：将组件复制到 HA `/config/custom_components/yi_sd_recordings/`，JS 复制到 `/config/www/`，在 `configuration.yaml` 加 `yi_sd_recordings:`。检查配置后重启 HA；添加 module 资源 `/local/yi-sd-recordings-card.js?v=3`，导入更新后的 dashboard.json。资源或仪表盘保存后应等待 HA 存储落盘再重启。

接口只复用 HA 已保存的 Yi 凭据，客户端不会拿到摄像头密码。索引通过认证 WebSocket；录像通过 HA 短时签名 URL 和实体读取权限；目录、文件名与 Range 严格校验，不接受任意 URL 或路径跳转。不要将签名播放链接分享出去。

验证：浏览器已解码 1280×720 历史录像、播放进度持续推进；移动事件关联播放和手动定位 00:05:30 已实测；历史日期切换可播放。分段请求返回 206 与 video/mp4；未认证返回 401、非法 Range 返回 400、非摄像头实体返回 404。broker 重启后四台事件连接恢复。上游接口依据 yi-hack-v5 的 eventsdir.sh、eventsfile.sh 和摄像头 /record/ 文件服务。

移除回放功能时先删除仪表盘卡片和 module 资源，再去掉 YAML 项并重启 HA，然后移除该自定义组件和 JS。不要删除摄像头 SD 卡内容或 HA 事件历史。

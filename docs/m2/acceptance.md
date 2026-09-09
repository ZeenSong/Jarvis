# M2 验收记录

状态：0.2.0-rc.1，本地交付验收通过，生产上线验收未完成。更新：2026-09-09。

## 已执行

| 检查 | 结果与证据 |
| --- | --- |
| TypeScript 服务端与 Web 类型检查 | 通过 |
| PostgreSQL 集成与单元测试 | 16 项通过，无跳过；覆盖 M1 迁移、幂等、取消竞态、事件重放、已完成 Worker 重启清理、凭据续期持久化、固定 Job 与 Ops 只读代理 |
| Web 构建与 Playwright | 配对、会话、断线恢复、第二设备读取同一会话、Run 输入、取消后 Diff、刷新保持 Run 通过；截图 `.local/evidence/m2-web-run-control.png` |
| Android 构建与单元测试 | assembleDebug、testDebugUnitTest 通过 |
| Android instrumentation | M2EndToEndTest 的输入、取消、页面重建通过；M1EndToEndTest 的监控与用量回归通过；共享 18 Block fixture 通过。输入/取消使用自动化测试 Runtime |
| 真实 DeepSeek Core | 连续对话、记忆与状态工具成功；3 次调用，5618 输入、140 输出 Token |
| 真实隔离 Codex | Codex 0.153.4，gpt-5.6-luna，low，标准服务。读取指定提交的 package.json、新增文档、执行 Node 断言退出 0、导出新增文件 Diff。`.local/evidence/m2-codex-luna-events.ndjson`、`m2-codex-luna.diff` |
| Worker 归档后退出 | Codex 共 110 个有序事件；本地保存后调用 dispose，容器退出码 0 |
| 真实 Pydantic AI + DeepSeek | 流式输出成功，566 输入、54 输出、512 缓存输入 Token。修复了带 token details 时依赖库用量提取为零的问题；独立映射回归测试通过 |
| 真实 Core → Ops → Core | 五类只读工具全部调用、通过独立只读代理、结果与用量归档并由 Core 汇总；最新 Ops 21085 输入、2947 输出 Token，完整事件与结果保留在 `.local/evidence/m2-delegate-*-results.json` |
| 真实 Core → Coding → Core | gpt-5.6-luna 读取仓库、编辑隔离副本、执行 Node 测试退出 0，结果与 changes.diff 入库，Core 汇总成功 |
| 测试数据库备份与恢复 | 新建无网络 PostgreSQL 恢复并运行 M2 迁移，M1 五类表计数与内容校验和一致；`.local/evidence/m2-test.dump.verified.json`，仅测试数据库 |
| 原 M1 增量迁移 | 冻结的 M1 schema 填入设备、Agent、会话、事件与历史计费后连续迁移两次，数据与设备鉴权不变 |
| APK 签名 | 与已发布的本地 v0.1.0 APK 的 SHA-256 签名指纹完全一致，可覆盖升级；生产手机安装仍待执行 |
| 部署脚本 | 启动脚本语法检查、清单渲染与 YAML 解析、隔离恢复脚本实跑通过；prepare/deploy/rollback 未在生产执行 |

Codex 实测在独立 Docker 内部网络、只读根文件系统、非 root、无 capabilities、无宿主目录与 socket 的容器中完成。App Server 的 externalSandbox 由容器提供隔离。出口经域名白名单代理，私网 CONNECT 被拒绝。此结果不能替代实际 Kubernetes 网络策略验收。

按用户要求，Codex 测试默认固定 gpt-5.6-luna，不自动升级模型。当前账号 model/list 和官方定价核对其为可用最低价模型。失败与诊断调用同样可能消耗额度；价格缺失时界面显示未知，不将 ChatGPT 登录额度换算成虚构美元账单。

## 尚未通过，不能标记完成

- 实际 K3s 的 namespace、固定模板调度、网络隔离与资源回收验收；当前默认 context 是 minikube，生产 kubeconfig 需要授权读取。
- 在实际集群执行双端 Demo Script 全流程；本地真实委派已通过。
- Ops 五类只读工具与生产网络隔离联合验收；真实只读代理与工具已验证，CNI 阻断仍待验证。
- 服务重启后的真实 Worker 验收；已实现明确失败、取消、限时读取存活日志并归档与清理，未确认清理时持久化告警，不宣称无损恢复。
- 输入、恢复、审批与取消在真实 Worker / 双端上的完整竞态验收。
- 专用 Codex 登录持久卷在实际 K3s 上的初始化、续期与重新登录演练；容器续期文件与失效处理已验证。
- 生产数据库备份恢复验证、同签名 APK 在生产手机上覆盖升级。
- 生产升级、旧设备与 Tailnet 验证、回退演练。

部署与回退步骤见 [部署说明](../../deploy/m2/README.md)。任何尚未执行的检查都不计为通过。

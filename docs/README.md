# Jarvis 文档中心

这里是 Jarvis 的统一文档入口。项目根目录只保留面向使用者的产品 README；设计、需求与实施记录按用途归档在本目录。包含家庭拓扑、真实网络地址、账号信息或原始日志的验收证据不进入公开仓库。

## 从这里开始

- [产品总览](../README.md)：能力介绍、截图、快速启动与当前边界
- [系统架构](reference/architecture.md)：服务边界、身份模型与工程决策
- [API / WebSocket 协议](reference/protocol.md)：客户端与服务端通信约定
- [部署指南](guides/deployment.md)：当前 Docker / CasaOS 路径与 Kubernetes 上线检查
- [家庭服务接入](guides/family-integrations.md)：Home Assistant、Immich 与摄像头服务的安全配置原则
- [当前 M3.3 状态](milestones/m3/m3.3-progress.md)：已实现能力、验证证据和未完成项

## 目录说明

| 目录 | 内容 | 适合谁看 |
| --- | --- | --- |
| [`product/`](product/) | 产品愿景、体验设计、架构蓝图、里程碑构想和概念图 | 产品、设计、贡献者 |
| [`specifications/`](specifications/) | M3.1、M3.2、M3.3 的正式需求与实施范围 | 开发、测试、评审者 |
| [`milestones/`](milestones/) | 各版本进度、验收问题、修复记录和发布说明 | 开发、运维、发布负责人 |
| [`guides/`](guides/) | 当前部署与家庭服务安全接入操作 | 使用者、运维 |
| [`reference/`](reference/) | 当前架构与协议参考 | 开发、集成方 |
| [`adr/`](adr/) | 关键技术决策记录 | 架构与维护人员 |
| [`assets/`](assets/) | README 等文档使用的静态资源 | 文档维护者 |

## 产品与设计

- [整体产品规划](product/vision.md)
- [产品架构 v2](product/architecture-v2.md)
- [体验与动态 UI v2](product/experience-dynamic-ui-v2.md)
- [M1 常驻服务与移动监控构想](product/m1-mobile-monitoring.md)
- [M2 真实 Agent 与动态体验构想](product/m2-agent-experience.md)
- [M3 Investor Demo 里程碑](product/m3-investor-demo.md)
- [产品概念图](product/concept-images/)

## 需求规格

- [M3.1 架构升级规格](specifications/m3.1-architecture-upgrade.md)
- [M3.2 开发需求与实施规范](specifications/m3.2-requirements.md)
- [M3.3 开发需求](specifications/m3.3-requirements.md)

## 里程碑记录

- [M1 验收](milestones/m1/acceptance.md) · [v0.1.0 发布说明](milestones/m1/release-v0.1.0.md)
- [M2 验收](milestones/m2/acceptance.md) · [M2 Demo](milestones/m2/demo.md)
- [M3 总体差距](milestones/m3/m3-status-and-gap-2026-09-13.md) · [历史实施流水](milestones/m3/m3-progress-history.md)
- [M3.1 发布记录](milestones/m3/m3.1-release.md) · [M3.1 修复后状态](milestones/m3/m3.1-status-and-plan.md)
- [M3.2 实施记录](milestones/m3/m3.2-progress.md)
- [M3.3 实施与验收记录](milestones/m3/m3.3-progress.md)

## 文档维护约定

1. 新的产品愿景放入 `product/`，可执行的需求基线放入 `specifications/`。
2. 阶段性进度、验收与发布记录放入对应的 `milestones/<版本>/`。
3. 可复用的操作步骤放入 `guides/`；稳定接口与架构事实放入 `reference/`。
4. 原始验证材料保存在仓库外的受控位置；公开文档只记录结论与可复现方法，不提交真实地址、日志、截图或家庭数据。
5. 部署组件自己的 README 保留在 `deploy/<组件>/`，因为它们与对应配置共同维护。
6. 旧版本文档必须明确标为历史记录，不得包含可直接复制执行的失效生产命令。

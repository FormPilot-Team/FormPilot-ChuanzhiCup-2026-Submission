# FormPilot Web 平台

平台包含动作训练、四套功法跟练、动作工坊、训练报告和 AI Coach。产品版本、环境安装、比赛构建、游戏连接及可选 Qwen 环境见[根 README](../../README.md)与[运行说明](../../docs/submission/RUNNING.md)。

```powershell
pnpm install --frozen-lockfile
pnpm competition:build
pnpm competition:preview
```

比赛预览地址为 `http://localhost:4175/`，独立游戏服务需在 `http://localhost:5181/` 运行。普通 `pnpm build` 关闭实验性决策模型；`competition:build` 启用带身份标识与规则回退的 M1/M2 推荐。

`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e` 为检查入口。视频素材按清单恢复；自由问答需另备本机模型。技术规格与历史研究结果保存在 `docs/` 和 `scripts/decision-model/`。

# 人工标注协议与评测

状态：**AWAITING_ANNOTATORS**。截至 2026-11-08 没有任何人工标签；本目录与证据目录中没有、也不会生成模拟的人工结果。

## 1. 两份标注包

| 包 | 发给 | 内容 |
| --- | --- | --- |
| `fp-cdm-annotation-package-A1.zip` | 标注者 1 | 离线工具 `fp-cdm-annotation-v1-testfamilies.html`、`GUIDELINES.md`（v1.1）、`README-A1.md`、`SHA256SUMS.txt` |
| `fp-cdm-annotation-package-A2.zip` | 标注者 2 | 同上，`README-A2.md` |

两份包的工具与规范逐字节相同，只有编号不同；工具按编号打乱场景顺序。每人 18 个场景（6 个冻结测试族 × 3 种条件），约 180 条评分，15–20 分钟。

生成方式（在 `apps/platform` 下）：`node scripts/decision-model/cdm/annotation-kit/packages/build-packages.mjs --out <dir>`，再把两个文件夹分别压缩。输出保存在指定目录。

## 2. 人选与独立性

- 两名团队成员。最好没有参与目录标签或推荐规则的编写；参与过的请在备注中注明，评测报告会单独标出。
- 不能是 Claude、Codex 或任何 AI，也不能由一个人完成两份。
- 分别私下发送。两人在都导出之前不讨论具体场景、不看任何系统输出（AI Coach、Lab、PR 演示与代码）。
- 结论统一写作“团队标注者（非临床）判断”。

## 3. 回收与评测

1. 收到的两个文件 `fp-cdm-labels-v1-A1.json`、`fp-cdm-labels-v1-A2.json` 原样放入同一个新目录，例如 `<研究输出目录>/labels/`，不要修改内容。
2. 在 `apps/platform` 下运行：

```bash
PY="python -I -B"
$PY scripts/decision-model/cdm/ingest_labels.py --labels-dir <labels> --subset test
```

   - 退出码 3（`AWAITING_LABELS`）：少于两份完整、独立的人工文件（AI 来源的文件会被拒收）。
   - 输出 `agreement.v1.json`（二次加权 κ、完全一致率、±1 一致率）、`adjudication-queue.v1.json`、`final-labels.v1.json`。
3. **质量门槛（预先声明）**：κ < 0.4 → `FAIL_REVISE_GUIDELINES`，只报告分歧，不得出任何模型结论，先修订规范再重标。
4. 仲裁：两人分差 ≥ 2 或任一方勾选安全疑虑的条目进入队列。由第三名成员或负责人逐条给出 `{"scenarioId","candidateId","grade","reason","adjudicator"}`，保存为 `adjudication.json`，再运行一次 `ingest_labels.py --labels-dir <labels> --subset test --adjudication adjudication.json`。原始两份分数保留不改。
5. 评测（不重新训练、不调参）：

```bash
$PY scripts/decision-model/cdm/evaluate_human_test.py --labels-dir <labels> --out <labels>/eval
```

   得到：人工之间的一致性；AI 标注者与每位人工的一致性（QWK、场景内 Spearman）；用人工标签重新计算的规则 P0 / PR #49 / fp-cdm 冻结测试指标。

## 4. 结果如何解读（预先声明）

- 这 180 条只用于**评测**。发布权重不变，层级仍为 `ai_experimental`，界面仍须显示“实验性模型”。
- 可以写的结论：在 6 个合成测试族上，两名团队标注者之间的一致性，AI 标签与团队标注者判断的一致程度，以及按团队标注者判断计算时模型与规则、PR #49 的差异（带区间）。
- 不能写的结论：专家验证、临床有效、真实用户效果；也不能因为这 18 个场景的结果好就称“经人工验证的模型”。
- 若要得到 `human` 层级的正式权重：需要两名标注者完成全部 720 条（`fp-cdm-annotation-v1.html`），并补充近期练习（0–2 天）场景，再按 `scripts/decision-model/cdm/README.md` §3 重训。属于下一轮，不在本阶段。

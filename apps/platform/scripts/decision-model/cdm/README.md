# fp-cdm 训练流水线（Competition Decision Model V1）

> 独立提交版请先读[训练复现说明](../../../../../docs/submission/TRAINING_REPRODUCTION.md)：下文历史 `VN` 内部哈希路径应替换为 `scripts/submission/run_ts.mjs` 解析器；Python 固定依赖已补充。研究记录和冻结权重保持原样。

两级模型，借鉴 StartLux 的决策架构（观测/状态 → 结构化协议 → 模型 → 校准置信度与弃权 → 独立 Guard → 不执行；off/shadow/active）：

| 模型 | 输入 | 标签 | 状态 |
| --- | --- | --- | --- |
| **M1 内容理解** `fp-cdm-m1` | 参考姿态轨迹的 3 s 窗口特征（真实观测，1,677 窗口 × 76 特征） | 团队人工目录标签（部位 / 注意项） | **已训练**：leave-one-programme-out |
| **M2 偏好排序** `fp-cdm-m2` | 用户 × 内容（P）、历史 × 内容（H）、报告 × 内容（R）共 111 个特征，含 M1 的 out-of-fold 输出 | 发布 v1.0：**单一 AI 标注者**（实验性）；正式版需两名独立人工标注者 | **已训练（实验性）并随发布 `fp-cdm-release/1.0.0` 绑定**；人工标签流水线就绪 |

以下命令在 `apps/platform` 下执行。`VN` 为 `node_modules/.pnpm/vite-node@3.2.4_@types+node_de474a0b50d035fb47eb67fa144202a3/node_modules/vite-node/vite-node.mjs`，`PY` 为本机 Python 3.12（numpy、scikit-learn 1.8、scipy），用 `-I -B` 运行。

## 1. 数据与标注材料（已生成，已冻结）

```bash
node $VN scripts/decision-model/cdm/build-scenarios.ts        # 72 个合成场景（24 族 × 3 条件），族级划分：6 族冻结测试
node $VN scripts/decision-model/cdm/build-annotation-kit.ts   # annotation-kit/fp-cdm-annotation-v1.html（离线单文件）
```

把 `annotation-kit/` 交给两名标注者（规范见 `annotation-kit/GUIDELINES.md`），收回 `fp-cdm-labels-v1-<ID>.json`，放入任一目录 `<labels>`。

## 2. M1（内容理解）

```bash
node $VN scripts/decision-model/cdm/export-window-features.ts
$PY -I -B scripts/decision-model/cdm/train_m1.py --out scripts/decision-model/cdm/artifacts/m1
```

## 3. M2（拿到标签后）

```bash
node $VN scripts/decision-model/cdm/export-ranking-matrix.ts
$PY -I -B scripts/decision-model/cdm/ingest_labels.py --labels-dir <labels>            # 一致性、仲裁队列、final-labels；不足两人时退出码 3
$PY -I -B scripts/decision-model/cdm/ingest_labels.py --labels-dir <labels> --adjudication <decisions.json>
$PY -I -B scripts/decision-model/cdm/train_m2.py --labels human --labels-dir <labels> --out scripts/decision-model/cdm/artifacts/m2
cp scripts/decision-model/cdm/artifacts/m2/fp-cdm-m2.weights.json src/features/coachAgent/decisionModel/cdm/fp-cdm-m2.weights.json
node $VN scripts/decision-model/cdm/evaluate-cdm.ts --out <dir> --weights src/features/coachAgent/decisionModel/cdm/fp-cdm-m2.weights.json
node node_modules/vitest/vitest.mjs run tests/coach-cdm.test.ts
```

`train_m2.py` 的执行内容：
- 在 18 个开发族上做 6 折分组交叉验证，选择线性模型（pairwise LR / ridge；HGB 只作离线对照）。
- 校准：成对温度与 Platt；弃权阈值取 top-1 精度 ≥ 0.85。
- 在 6 个冻结测试族上**只评测一次**：E1 指标（NDCG@3/5、P@K、R@K、成对准确率），与 P0、PR #49 对比，并给出家族级 bootstrap 95% CI。
- E3 消融 A/B/C；E6 跨标注者泛化；误差分析。

## 4. 对照：证明流水线既能学到信号，也不会学到噪声（不是模型效果）

```bash
$PY -I -B scripts/decision-model/cdm/train_m2.py --labels planted --seed 1 --out <dir>   # 随机隐藏线性效用 → 应能学到
$PY -I -B scripts/decision-model/cdm/train_m2.py --labels null    --seed 1 --out <dir>   # 随机标签 → 应接近随机水平
node $VN scripts/decision-model/cdm/evaluate-cdm.ts --out <dir>                          # 固定 fixture 权重：E4 安全、E5 性能
node scripts/decision-model/cdm/cold-start.mjs <tmpDir> 7                                 # 冷启动
```

## 5. 第二轮研究（2026-11-07 晚）

```bash
node $VN scripts/decision-model/cdm/export-window-features.ts --v2       # v2 姿态特征（负结果，未采用）
$PY -I -B scripts/decision-model/cdm/train_m1_v11.py --out scripts/decision-model/cdm/artifacts/m1-v11     # 嵌套 LOPO
$PY -I -B scripts/decision-model/cdm/robustness_m1.py --out scripts/decision-model/cdm/artifacts/m1-v11    # 噪声 / 缺失鲁棒性
$PY -I -B scripts/decision-model/cdm/research_m2.py --matrix scripts/decision-model/cdm/data/m2-matrix.v1.json --labels ai --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out <dir>
$PY -I -B scripts/decision-model/cdm/train_m2.py --labels ai --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out <dir>
$PY -I -B scripts/decision-model/cdm/attach_feature_ranges.py --weights <w.json> --matrix scripts/decision-model/cdm/data/m2-matrix.v1.json --out <w+ranges.json>
node $VN scripts/decision-model/cdm/evaluate-cdm.ts --out <dir> --weights <w+ranges.json> --ai-label-experiment
```

- `research_m2.py` 只用开发集。
- `train_m2.py --labels ai` 是 AI 标签弱监督实验，冻结测试只评一次。
- `evaluate-cdm.ts` 这一步产出 E2 / E4 / E5。

Lab（全部输入来自仓库内 artifacts，可复现）：

```bash
A=scripts/decision-model/cdm/artifacts
node scripts/decision-model/cdm/lab/build-lab.mjs --out <lab.html> --ai-label-experiment \
  --weights $A/m2-ai-experiment/fp-cdm-m2.ai-experiment.weights+ranges.json --m2-report $A/m2-ai-experiment/fp-cdm-m2.ai-experiment.report.json \
  --research $A/m2-research/m2-research-ai-v1-features.json --m1-metrics $A/m1/fp-cdm-m1.metrics.json --m1v11 $A/m1-v11/fp-cdm-m1-v11.report.json \
  --m1-robustness $A/m1-v11/fp-cdm-m1-robustness.json --ai-quality scripts/decision-model/cdm/labels-ai/ai-label-quality.json \
  --e245 $A/m2-ai-experiment/cdm-e2-e4-e5-ai_single_annotator.json --cold $A/m2-ai-experiment/cold-start.json
```

## 6. 最小人工检验（仅 6 个冻结测试族，约 180 条/人）

```bash
node $VN scripts/decision-model/cdm/build-annotation-kit.ts --subset-test    # annotation-kit/fp-cdm-annotation-v1-testfamilies.html
$PY -I -B scripts/decision-model/cdm/ingest_labels.py --labels-dir <dir> --subset test
$PY -I -B scripts/decision-model/cdm/evaluate_human_test.py --labels-dir <dir> --out <dir>
```

最后一步的输出包括：人工之间的一致性、AI 标注者与每位人工的一致性，以及在人工标签上重新计算的 E1（规则 P0 / PR #49 / AI 标签训练的 fp-cdm）。不重新训练，也不调参。

完整结果、版本与结论状态见 `docs/ai-coach-agent/decision-model/MODEL_REPORT.md`。

## 7. 第三阶段：集成就绪（2026-11-08）

发布 `fp-cdm-release/1.0.0` 已冻结；本阶段不重训发布模型、不再使用冻结测试集。Web 只调用 `src/features/coachAgent/decisionModel/engine` 的 `recommendCoachDecision`（说明见 `docs/ai-coach-agent/decision-model/WEB_INTEGRATION_READY.md`）。

```bash
node $VN scripts/decision-model/cdm/freeze-release.ts                       # 校验 release.ts 与权重 / M1 表 / 目录一致（--write 写入，--manifest <json> 输出文件清单）
$PY -I -B scripts/decision-model/cdm/integration_experiments.py --matrix scripts/decision-model/cdm/data/m2-matrix.v1.json     --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out scripts/decision-model/cdm/artifacts/integration   # I1/I2 消融、I3 训练阶段、研究变体（只用开发族）
node $VN scripts/decision-model/cdm/probes.ts --variants scripts/decision-model/cdm/artifacts/integration/variants --out scripts/decision-model/cdm/artifacts/integration/probes.json   # I4 行为探针
node $VN scripts/decision-model/cdm/evaluate-cdm.ts --out <dir>             # E2/E4/E5，经公开接口（发布模型）
node scripts/decision-model/cdm/cold-start.mjs <tmpDir> 7                    # 冷启动
node $VN scripts/decision-model/cdm/export-examples.ts                       # docs/.../examples/*.json（真实调用生成）
node node_modules/vitest/vitest.mjs run tests/coach-cdm.test.ts tests/coach-decision-engine.test.ts
A=scripts/decision-model/cdm/artifacts
node scripts/decision-model/cdm/lab/build-lab.mjs --out <coach-decision-lab-v3.html>   --m2-report $A/m2-ai-experiment/fp-cdm-m2.ai-experiment.report.json --research $A/m2-research/m2-research-ai-v1-features.json   --m1-metrics $A/m1/fp-cdm-m1.metrics.json --m1v11 $A/m1-v11/fp-cdm-m1-v11.report.json --m1-robustness $A/m1-v11/fp-cdm-m1-robustness.json   --ai-quality scripts/decision-model/cdm/labels-ai/ai-label-quality.json --e245 $A/integration/cdm-e2-e4-e5-release.json --cold $A/integration/cold-start.json   --integration $A/integration/integration-experiments.json --probes $A/integration/probes.json --variants $A/integration/variants --manifest $A/integration/release-manifest.json
```

- 研究变体（`artifacts/integration/variants/`）只能通过 `createCoachDecisionEngine({ binding: 'unbound' })` 影子运行，引擎拒绝把它们用于 ACTIVE。
- `evaluate-cdm.ts --weights <w>` 评估非绑定的研究权重；不带 `--weights` 时评估发布模型。

## 8. 最终交付收尾（2026-11-08）

模型侧冻结：不重训、不再使用冻结测试集、不新增实验。新增的只有审查与验收工具：

```bash
node $VN scripts/decision-model/cdm/fuzz-engine.ts                           # 公开接口健壮性：3,007 个畸形输入，失败时退出码 1
node $VN scripts/decision-model/cdm/shadow-acceptance.ts --self-test         # SHADOW 检查器自检（合成场景 + 负对照，不是验收证据）
node $VN scripts/decision-model/cdm/shadow-acceptance.ts --log a.json --log b.json --log c.json --out report.json   # Web 接线后的 SHADOW 验收
node scripts/decision-model/cdm/lab/check-lab.mjs <lab.html> <out.json>      # Lab 内嵌数据 = 产物文件；8 个案例浏览器 = Node 引擎；文字结论成立
node scripts/decision-model/cdm/annotation-kit/packages/build-packages.mjs --out <dir>   # 两份独立人工标注包 A1 / A2
```

Lab 构建在第 7 节命令后追加 `--tests <tests-summary.json>`（测试摘要，只用于展示）。SHADOW 日志格式见 `src/features/coachAgent/decisionModel/engine/shadow.ts`；流程见 `WEB_INTEGRATION_READY.md` §10。人工标注包的分发、回收与评测见 `annotation-kit/packages/HANDOFF_PACKAGES.md`。

## 禁止事项

- 不用规则、PR #49 输出、persona、画像枚举或标为 do-not-train 的数据作 M2 标签。
- `planted` / `null` 结果只能写作“流水线验证”，不得写作模型效果。
- 运行时只接受 `trainedOn.labels.kind` 为 `human`（层级 human）或 `ai_single_annotator`（层级 ai_experimental）的权重；植入信号、随机标签、fixture 一律拒绝。实验性权重在 ACTIVE 下需要负责人设置 `allowExperimentalModel`。

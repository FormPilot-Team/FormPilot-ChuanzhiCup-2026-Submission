# M1/M2 研究流水线复现

Web 运行直接使用冻结 M1/M2 权重，不需要 Python、再训练或模型下载。原始训练、特征提取、标签和评测脚本均保留在 `apps/platform/scripts/decision-model`，冻结报告和权重用于核查历史实验。

原 M1/M2 报告记录 Python 3.12.0、numpy 2.4.1、scikit-learn 1.8.0。复现环境另固定 scipy 1.17.0、joblib 1.5.3、threadpoolctl 3.6.0，见 `requirements-training.txt`。后三者来自复现环境核对，不是历史报告记录的版本。

如需重跑研究，在独立环境安装：

```powershell
python -m venv .venv-training
.venv-training/Scripts/python -m pip install -r apps/platform/scripts/decision-model/requirements-training.txt
```

旧 CDM README 的 `VN` 指向以前 pnpm 的内部哈希路径，不适用于新的锁文件安装位置。使用本仓库提供的解析器，从根目录运行：

```powershell
node scripts/submission/run_ts.mjs scripts/decision-model/cdm/export-window-features.ts
node scripts/submission/run_ts.mjs scripts/decision-model/cdm/export-ranking-matrix.ts
node scripts/submission/run_ts.mjs scripts/decision-model/cdm/evaluate-cdm.ts --out ../../../artifacts/cdm-evaluation
```

它根据实际锁定安装的 Vitest 解析 vite-node，脚本工作目录固定为 `apps/platform`，无需写本机 D/E/F 盘路径。原训练操作、参数和研究限制仍以 [CDM README](../../apps/platform/scripts/decision-model/cdm/README.md) 为准，用此解析器替换其中 `node $VN`。训练前先生成所需窗口/矩阵；大型派生中间数据不在 Git 中。

发布 M2 使用 AI 标注实验权重；人工标注流水线需要两名独立标注者，未收齐不能用假标签代替。重跑冻结测试集会影响“只评测一次”的研究约定，应在新的研究目录记录原因和结果，不能覆盖历史成绩。历史模型指标及 Qwen/RAG 评测汇总见 [HISTORICAL_MODEL_RESULTS.json](HISTORICAL_MODEL_RESULTS.json)；这些历史结果不表示当前机器已重跑。

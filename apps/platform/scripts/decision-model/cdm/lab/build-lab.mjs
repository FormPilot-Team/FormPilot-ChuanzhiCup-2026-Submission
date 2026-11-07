// Coach Decision Lab v3 (competition edition): one self-contained offline HTML page.
// Every decision on the page is computed live in the browser by the SAME public engine the Web calls
// (recommendCoachDecision, release fp-cdm-release/1.0.0). P0 rules and PR #49 are bundled as baselines; research
// variants (ablations, training-stage checkpoints) run through createCoachDecisionEngine({ binding: 'unbound' }).
//
//   node scripts/decision-model/cdm/lab/build-lab.mjs --out <file.html> \
//     [--m2-report <report.json>] [--research <m2-research-*.json>] [--m1-metrics <m1.metrics.json>] [--m1v11 <m1-v11.report.json>]
//     [--m1-robustness <json>] [--ai-quality <ai-label-quality.json>] [--e245 <cdm-e2-e4-e5-release.json>] [--cold <cold-start.json>]
//     [--integration <integration-experiments.json>] [--probes <probes.json>] [--variants <dir>] [--manifest <release-manifest.json>] [--tests <tests.json>]
// Run from apps/platform. Not a Vite entry and not an app route; it does not touch the Web build.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const readJson = path => (path ? JSON.parse(readFileSync(path, 'utf8')) : null)
const out = opt('--out'); if (!out) throw new Error('--out required')

const esbuild = await import(pathToFileURL(resolve('node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')).href)
const built = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, 'entry.ts')], bundle: true, minify: true, format: 'iife', globalName: 'FPLab', platform: 'browser', write: false, logLevel: 'silent' })
const bundle = built.outputFiles[0].text
if (bundle.includes('</script')) throw new Error('bundle contains a closing script tag')
const scenarioText = readFileSync(resolve(import.meta.dirname, '../data/scenarios.v1.json'), 'utf8')
const scenarios = JSON.parse(scenarioText).scenarios.map(s => ({ id: s.id, familyId: s.familyId, condition: s.condition, split: s.split, profile: s.profile, history: s.history, report: s.report }))
const vdir = opt('--variants')
const variants = vdir ? readdirSync(vdir).filter(f => f.endsWith('.weights.json')).sort().map(f => { const w = JSON.parse(readFileSync(resolve(vdir, f), 'utf8')); return { name: w.variant?.name ?? f, note: w.variant?.note ?? '', weights: w } }) : []
const data = {
  generatedAt: new Date().toISOString(), scenarioSha256: createHash('sha256').update(scenarioText).digest('hex'), scenarios, variants,
  m2: readJson(opt('--m2-report')), research: readJson(opt('--research')), m1: readJson(opt('--m1-metrics')), m1v11: readJson(opt('--m1v11')),
  aiq: readJson(opt('--ai-quality')), e245: readJson(opt('--e245')), cold: readJson(opt('--cold')), m1robust: readJson(opt('--m1-robustness')),
  integ: readJson(opt('--integration')), probes: readJson(opt('--probes')), manifest: readJson(opt('--manifest')), tests: readJson(opt('--tests')),
}
const json = JSON.stringify(data).replace(/</g, '\\u003c')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coach Decision Lab</title>
<style>
:root{--bg:#f6f6f3;--surface:#fcfcfb;--card:#ffffff;--fg:#0b0b0b;--fg2:#52514e;--muted:#6f6e69;--line:#dedcd5;--grid:#ecebe6;
 --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--neg:#8a8984;--warn:#a2461f;--ok:#1f6f45;--accent:#2a78d6;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#a09f97;--line:#373631;--grid:#2a2a27;
 --s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#8f8e87;--warn:#e08a5f;--ok:#5fc08a;--accent:#3987e5;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#a09f97;--line:#373631;--grid:#2a2a27;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#8f8e87;--warn:#e08a5f;--ok:#5fc08a;--accent:#3987e5;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}h1{font-size:24px;margin:6px 0 2px}h2{font-size:19px;margin:28px 0 8px;padding-top:8px;border-top:1px solid var(--line)}h3{font-size:15px;margin:8px 0 6px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;position:sticky;top:0;background:var(--bg);padding:6px 0;z-index:5}nav a{color:var(--fg2);text-decoration:none;border:1px solid var(--line);border-radius:14px;padding:2px 10px;font-size:13px}
.sub{color:var(--fg2);margin:0 0 10px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0;min-width:0}
.banner{border-radius:10px;padding:10px 14px;margin:10px 0;border:1px solid var(--warn);color:var(--warn)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:12px}.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.row>label{max-width:100%}select,button,textarea{font:inherit;padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);max-width:100%}
td,th{overflow-wrap:break-word}code{overflow-wrap:anywhere}.num{white-space:nowrap}
textarea{width:100%;min-height:180px;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre}button{cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
fieldset{border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:6px 10px;min-width:0}legend{color:var(--fg2);font-size:13px}fieldset label{display:inline-block;margin:2px 8px 2px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:5px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--fg2);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:1px;font-size:12px;color:var(--fg2)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:baseline}.muted{color:var(--muted)}.ok{color:var(--ok)}.warnc{color:var(--warn)}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px}.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}#tip{position:fixed;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:13px;display:none;z-index:9;max-width:320px}
details summary{cursor:pointer;color:var(--fg2)}.st-ok{color:var(--ok);font-weight:600}.st-exp{color:var(--warn);font-weight:600}.st-pend{color:var(--muted);font-weight:600}
.seen{border:2px solid var(--accent)}.pill{display:inline-block;border-radius:12px;padding:1px 9px;font-size:12px;font-weight:600;border:1px solid currentColor}
.case h3{margin-top:0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:640px){.cols{grid-template-columns:1fr}nav{position:static}}
pre{white-space:pre-wrap;word-break:break-all;font:12px/1.45 ui-monospace,Consolas,monospace;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0}
ol,ul{padding-left:22px}svg text{font-family:system-ui,"Microsoft YaHei",sans-serif}
</style></head><body><main>
<h1>Coach Decision Lab</h1>
<p class="sub">FormPilot 专用决策模型 fp-cdm 的比赛展示页。页面里的每一次推荐，都由 Web 将要调用的同一个公开接口 <code>recommendCoachDecision</code> 在浏览器内实时计算；规则引擎 P0 与 PR #49 只作为对照。离线运行，不接入正式用户页面。</p>
<div id="status"></div>
<nav><a href="#s-status">结论状态</a><a href="#s-arch">模型架构</a><a href="#s-data">数据</a><a href="#s-live">实时决策</a><a href="#s-cases">现场案例</a><a href="#s-persona">典型画像</a><a href="#s-train">训练过程</a><a href="#s-results">评估与对照</a><a href="#s-ablation">消融</a><a href="#s-probes">行为探针</a><a href="#s-gen">泛化</a><a href="#s-perf">安全与性能</a><a href="#s-version">版本与复现</a><a href="#s-limit">局限与启用条件</a></nav>
<h2 id="s-status">结论状态</h2><div class="card scroll" id="verify"></div>
<h2 id="s-arch">模型架构</h2><div class="grid2"><div class="card" id="arch"></div><div class="card" id="archtext"></div></div>
<h2 id="s-data">训练数据及来源</h2><div class="card scroll" id="datacard"></div>
<h2 id="s-live">实时决策（真实模型执行）</h2>
<div class="card"><div class="row"><label>输入 <select id="src"><option value="custom">自定义画像</option></select></label>
<label>模型 <select id="engine"></select></label></div>
<div class="row" style="margin-top:6px"><span class="muted">运行模式</span><label><input type="radio" name="mode" value="off"> OFF（规则）</label><label><input type="radio" name="mode" value="shadow"> SHADOW（影子）</label><label><input type="radio" name="mode" value="active" checked> ACTIVE（模型展示）</label>
<label><input type="checkbox" id="allow" checked> 负责人批准实验性模型（allowExperimentalModel，演示用；产品默认关闭）</label></div>
<div id="editor"></div>
<details><summary>契约输入 JSON（可直接编辑后运行）</summary><textarea id="json" spellcheck="false"></textarea><div class="row"><button class="primary" id="runjson">运行 JSON</button><span class="muted" id="jsonmsg"></span></div></details></div>
<div id="decision"></div>
<h2 id="s-cases">现场演示案例（点击即实时重算）</h2><p class="muted">每个案例比较“改变前 / 改变后”两次真实调用（发布模型，ACTIVE + 演示批准）。用户均为合成演示画像，不是真实用户。</p><div id="cases" class="grid2"></div>
<h2 id="s-persona">典型画像下的推荐差异（冷启动）</h2><div id="gallery" class="grid2"></div>
<h2 id="s-train">M1 / M2 训练过程</h2><div id="training" class="grid2"></div>
<h2 id="s-results">模型评估与基线对照</h2><div id="results" class="grid2"></div>
<h2 id="s-ablation">消融实验（开发集，预先声明）</h2><div id="ablation" class="grid2"></div>
<h2 id="s-probes">行为探针（发布模型，保存的证据）</h2><div id="probes"></div>
<h2 id="s-gen">跨功法泛化</h2><div id="gen" class="grid2"></div>
<h2 id="s-perf">安全、弃权与性能</h2><div id="perf"></div>
<h2 id="s-version">模型版本、可信度与复现</h2><div id="version"></div>
<h2 id="s-limit">局限与正式启用条件</h2><div class="card" id="limits"></div>
<p class="muted" id="foot"></p>
</main><div id="tip"></div>
<script>${bundle}</script>
<script>
const D = ${json};
const E = FPLab;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f3 = x => x == null ? '—' : Number(x).toFixed(3);
const pct = x => x == null ? '—' : (x * 100).toFixed(0) + '%';
const NOW = Date.UTC(2026, 10, 8, 12), DAY = 86400000;
const L = {goals:{mobility:'肩颈活动',upper_limb:'上肢功能练习',daily:'日常锻炼',rehab_support:'康复辅助意向'},difficulties:{stiffness:'僵硬感',reach_difficulty:'抬手困难',soreness:'酸痛',sedentary:'久坐不适',none:'暂无明显困难'},
 regions:{shoulders:'肩部',neck:'颈部',arms:'上肢',trunk:'躯干',legs:'下肢'},preference:{routine:'功法优先',game:'游戏优先',mixed:'混合'},risk:{none:'无',acute_pain:'急性疼痛',dizziness:'眩晕',recent_injury:'近期损伤'},
 group:{P:'画像×内容',H:'历史×内容',R:'报告×内容'},cond:{A_profile:'仅画像',B_history:'画像+历史',C_history_report:'画像+历史+报告'},prog:{baduanjin:'八段锦',taijiquan:'太极拳',wuqinxi:'五禽戏',yijinjing:'易筋经'},
 focus:{reach:'动作幅度',stability:'姿势稳定',coordination:'协调配合',rhythm:'动作节奏',general:'日常活动'}};
const FALLBACK = {MODEL_DISABLED:'OFF：模型未运行，展示规则结果', SHADOW_MODE:'SHADOW：模型已运行，用户仍看到规则结果', PROFILE_REQUIRED:'画像不完整，需先填写画像', SAFETY_HOLD:'风险条件：安全门禁在模型之前暂停推荐，模型不会被调用',
 INPUT_INVALID:'输入不合法，模型未运行（见 inputIssues）', INVALID_AVAILABILITY:'可用性快照不合法', MODEL_MISSING:'模型文件缺失', MODEL_NOT_TRAINED:'权重为未训练占位文件', WEIGHTS_INVALID:'权重文件结构无效', MODEL_VERSION_MISMATCH:'权重与代码版本不一致',
 LABELS_NOT_ACCEPTED:'权重的标签来源不被接受', CATALOGUE_MISMATCH:'可信目录与训练时不一致', CONTENT_FEATURES_MISMATCH:'M1 内容表与发布不一致', UNBOUND_WEIGHTS:'研究变体权重：只能影子运行，不能进入 ACTIVE',
 EXPERIMENTAL_MODEL_NOT_APPROVED:'实验性模型未获负责人批准，ACTIVE 回退规则', NO_CANDIDATES:'安全筛选后没有候选', MODEL_ABSTAINED:'模型弃权，回退规则结果', MODEL_ERROR:'模型推理异常，回退规则结果', OUTPUT_GUARD_REJECTED:'独立 Guard 拒绝模型输出，回退规则结果'};
const ABSTAIN = {LOW_SUITABILITY:'没有候选达到校准适配阈值', OUT_OF_DISTRIBUTION:'首选候选的特征超出训练范围', NO_CANDIDATES:'没有候选'};
const byId = new Map(E.COACH_KNOWLEDGE.map(e => [e.id, e]));
const CARD = E.describeCoachDecisionModel();
const M = CARD.model || {};
const st = [];
if (M.tier === 'ai_experimental') st.push('<div class="banner"><strong>实验性模型 · AI 标注弱监督</strong>：发布模型 ' + esc(M.id + ' v' + M.version) + ' 的训练标签来自单一 AI 标注者（Claude Opus 5.5，与规则基线设计者为同一智能体）对合成场景的分级。<strong>不是人工验证，不是专家判断</strong>，不代表真实用户效果；正式产品默认 OFF。</div>');
if (CARD.bundleStatus !== 'ok') st.push('<div class="banner">发布模型未通过完整性校验（' + esc(CARD.bundleStatus) + '）：页面只展示规则结果。</div>');
$('status').innerHTML = st.join('');

// ---------- verification status ----------
const V = [['Web 接入接口（OFF / SHADOW / ACTIVE、故障回退）', 'ok', '公开接口 recommendCoachDecision；OFF 与 Agent Web P0 逐字一致；13 类故障全部回退规则（单元测试）'],
 ['训练 / 推理一致性', 'ok', '72 个标注场景经接口输入后，模型分数与训练时的状态逐项相同（测试）'],
 ['安全门禁、弃权与回退（E4）', 'ok', '22,320 个画像全量 + 13,392 个风险画像 + 对抗权重；离线代码级验证'], ['推理性能与资源（E5）', 'ok', '开发机 CPU 实测；未在比赛目标设备上复测'],
 ['M1 内容理解（跨功法）', 'ok', '真实参考姿态 + 团队人工标签，嵌套按功法留一；单一示范者、二维；与手工描述符差异不显著'],
 ['M2 排序质量', 'exp', '标签来自单一 AI 标注者，场景为合成；指标衡量与该 AI 标注者的一致性'], ['M2 优于规则 / PR #49', 'exp', '成对准确率优势明显；NDCG 差异 CI 跨 0'],
 ['画像特征的作用', 'exp', '部位、偏好交叉特征显著有用；目标交叉特征无增益（开发集，AI 标签）'], ['历史 / 报告特征的贡献', 'exp', '整体效应很小；仅游戏历史显著（−0.013）'],
 ['人工或专家一致性', 'pend', '未进行；需要两名团队成员标注 6 个冻结测试族（约 180 条/人）'], ['真实用户推荐质量与康复效果', 'pend', '需要真实使用数据与专业评估；当前不作任何宣称']];
$('verify').innerHTML = '<table><tr><th>结论</th><th>状态</th><th>依据与范围</th></tr>' + V.map(v => '<tr><td>' + v[0] + '</td><td class="' + {ok:'st-ok',exp:'st-exp',pend:'st-pend'}[v[1]] + '">' + {ok:'已验证（离线）',exp:'实验性',pend:'待验证'}[v[1]] + '</td><td>' + v[2] + '</td></tr>').join('') + '</table>';

// ---------- architecture ----------
(function arch(){
  const steps = [['输入（契约 fp-coach-decision/v1）','画像 · 训练历史 · 游戏历史 · 最近报告 · 可用内容','var(--fg2)'],['严格校验','未知字段 / 越界 / 非目录 id → INPUT_INVALID','var(--neg)'],
   ['安全门禁（规则）','风险暂停 · 受限画像去注意项 · 可启动 · 可用性','var(--s1)'],['第一阶段：候选检索（规则）','P0 + PR #49 候选，补足至 12 个，全部在安全池内','var(--s1)'],
   ['M1 动作感知（训练）','示范视频姿态窗口 → 部位 / 注意项概率（内容表，指纹绑定）','var(--s3)'],['M2 偏好排序（训练）','111 个特征 · 成对逻辑回归 · 337 个参数','var(--s3)'],
   ['校准与弃权','Platt 适配概率 · 成对温度 · 低适配 / 分布外 → ABSTAIN','var(--s3)'],['独立 Guard','重新计算安全池，任何违规 → 拒绝，不修复','var(--s1)'],
   ['模式门','OFF 规则 · SHADOW 规则展示 + 模型影子 · ACTIVE 模型展示','var(--s2)']];
  const W = 640, bh = 50, gap = 16, H = steps.length * (bh + gap) + 10;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="fp-cdm 决策流程">';
  steps.forEach((x, i) => { const y = 6 + i * (bh + gap);
    s += '<rect x="20" y="' + y + '" width="' + (W - 120) + '" height="' + bh + '" rx="8" fill="var(--surface)" stroke="' + x[2] + '" stroke-width="2"/>';
    s += '<text x="36" y="' + (y + 21) + '" font-size="15" font-weight="600" fill="var(--fg)">' + esc(x[0]) + '</text><text x="36" y="' + (y + 40) + '" font-size="12.5" fill="var(--fg2)">' + esc(x[1]) + '</text>';
    if (i < steps.length - 1) s += '<line x1="' + (W / 2 - 50) + '" y1="' + (y + bh) + '" x2="' + (W / 2 - 50) + '" y2="' + (y + bh + gap - 3) + '" stroke="var(--fg2)" stroke-width="2"/><path d="M' + (W / 2 - 55) + ' ' + (y + bh + gap - 7) + ' L' + (W / 2 - 50) + ' ' + (y + bh + gap - 1) + ' L' + (W / 2 - 45) + ' ' + (y + bh + gap - 7) + '" fill="none" stroke="var(--fg2)" stroke-width="2"/>';
    if ([1, 2, 6, 7].includes(i)) s += '<line x1="' + (W - 100) + '" y1="' + (y + bh / 2) + '" x2="' + (W - 70) + '" y2="' + (y + bh / 2) + '" stroke="var(--warn)" stroke-width="2" stroke-dasharray="4 3"/><text x="' + (W - 64) + '" y="' + (y + bh / 2 + 4) + '" font-size="12" fill="var(--warn)">回退</text>'; });
  s += '</svg>';
  $('arch').innerHTML = '<h3>一次调用的完整路径</h3>' + s + '<p class="muted"><span class="sw" style="background:var(--s1)"></span>规则：安全与候选约束　<span class="sw" style="background:var(--s3)"></span>训练模型：感知、排序、校准　<span class="sw" style="background:var(--s2)"></span>运行模式　虚线：任一环节失败都回退规则结果</p>';
  $('archtext').innerHTML = '<h3>分工</h3><ul><li><b>训练模型负责推荐排序</b>：最终顺序、推荐组合、适配概率和解释全部来自 M2（输入含 M1 的动作感知特征）。</li><li><b>规则只做约束与兜底</b>：风险暂停、受限画像的注意项过滤、可启动性、可用性、候选检索、展示上限（≤3 章 / ≤2 套功法 / ≤2 个游戏）和异常回退。</li><li><b>借鉴 StartLux 的架构思想</b>：显式缺失与来源标记、决策与执行解耦、结构化协议、只在验证集上校准、弃权原因码、独立 Guard、模型身份与指纹、off / shadow / active。不使用 StartLux 权重或标签。</li><li><b>版本绑定</b>：权重、M1 内容表与可信目录在启动时校验指纹，任何不一致都不运行模型。</li></ul>'
   + '<h3>发布</h3><table><tr><td>发布</td><td>' + esc(CARD.release) + '</td></tr><tr><td>排序模型</td><td>' + esc((M.id || '—') + ' v' + (M.version || '—') + ' · 运行时 ' + (M.runtimeVersion || '—')) + '</td></tr><tr><td>标签层级</td><td class="warnc">' + esc(M.tierLabel || '—') + '</td></tr><tr><td>权重指纹</td><td><code>' + esc(M.weightsFingerprint || '—') + '</code></td></tr><tr><td>内容模型</td><td>' + esc(M.contentModel ? M.contentModel.modelOfRecord : '—') + '</td></tr></table>';
})();

// ---------- data card ----------
const aiq = D.aiq;
$('datacard').innerHTML = '<table><tr><th>数据</th><th>规模</th><th>性质</th><th>用途</th></tr>'
 + '<tr><td>标准示范参考姿态轨迹（4 套功法）</td><td>26,570 帧 / 1,677 个 3 s 窗口 / 59 章</td><td><span class="ok">真实观测</span>（单一示范者，MediaPipe 二维）</td><td>M1 训练</td></tr>'
 + '<tr><td>目录部位 / 注意标签</td><td>60 章 + 4 游戏</td><td>团队人工标注（非专家）</td><td>M1 标签、M2 内容特征</td></tr>'
 + '<tr><td>合成场景（画像 + 历史 + 报告）</td><td>72 个场景 / 24 族 / 720 个候选</td><td><span class="warnc">合成设计</span>，SHA ' + D.scenarioSha256.slice(0, 12) + '…</td><td>M2 训练与评测</td></tr>'
 + '<tr><td>M2 分级标签</td><td>' + (aiq ? aiq.integrity.received + ' 项；1/2/3 = ' + aiq.gradeDistribution.all.slice(1).join('/') : '—') + '</td><td class="warnc">AI 标注（单一 AI 标注者 Claude Opus 5.5，盲标，非人工、非专家）</td><td>M2 训练与评测</td></tr>'
 + '<tr><td>划分</td><td>18 个开发族 / 6 个冻结测试族</td><td>标签产生前固定</td><td>开发集交叉验证 / 单次冻结测试</td></tr>'
 + '<tr><td>未使用</td><td colspan="3">StartLux 权重与标签（任务不符、CC BY-NC）；标为 do-not-train 的数据集；许可受限的公开数据（REHAB24-6、UMONS-TAICHI 等）；画像枚举与 persona 不作训练样本</td></tr></table>';

// ---------- engines, presets, inputs ----------
const VARIANT_LABEL = {'full-refit':'研究复现：同流程重新拟合','no-history':'消融：去掉训练历史特征','no-report':'消融：去掉报告特征','no-m1':'消融：去掉 M1 动作感知特征','no-profile-crosses':'消融：去掉画像×内容交叉特征','profile-content-only':'消融：仅画像与内容','stage-25':'训练阶段：25% 开发族','stage-50':'训练阶段：50% 开发族','stage-75':'训练阶段：75% 开发族','stage-100':'训练阶段：100% 开发族'};
const ENGINES = [{key:'release', label:'发布模型 fp-cdm-m2 v1.0（发布绑定）', rec:E.recommendCoachDecision}].concat(D.variants.map(v => ({key:v.name, label:'研究变体 · ' + (VARIANT_LABEL[v.name] || v.name), note:v.note, rec:E.createCoachDecisionEngine({weights:v.weights, binding:'unbound'}).recommend})));
$('engine').innerHTML = ENGINES.map(e => '<option value="' + e.key + '">' + esc(e.label) + '</option>').join('');
const ch = (chapterId, sessions, meanScore, trend, daysAgo, completed) => ({chapterId, sessions, completedSessions: completed == null ? sessions : completed, meanScore, trend, lastPracticedAt: NOW - daysAgo * DAY});
const HIST = {none:['无训练历史', {}],
 s1:['第 1 周：八段锦第一式 2 次', {trainingHistory:{origin:'synthetic_demo', chapters:[ch('bdj-1', 2, 62, 'flat', 2)]}}],
 s2:['第 2 周：第一、二式 + 摘苹果 3 局', {trainingHistory:{origin:'synthetic_demo', chapters:[ch('bdj-1', 5, 70, 'up', 5), ch('bdj-2', 3, 64, 'flat', 2)]}, gameHistory:{origin:'synthetic_demo', games:[{gameId:'apple', plays:3, completedPlays:3, lastPlayedAt:NOW - DAY}]}}],
 s3:['第 4 周：八段锦前四式 + 太极起势 + 划船', {trainingHistory:{origin:'synthetic_demo', chapters:[ch('bdj-1', 8, 78, 'up', 6), ch('bdj-2', 7, 74, 'up', 4), ch('bdj-3', 6, 72, 'up', 2), ch('bdj-4', 4, 70, 'flat', 1), ch('tjq-1', 2, 60, 'flat', 3)]}, gameHistory:{origin:'synthetic_demo', games:[{gameId:'apple', plays:6, completedPlays:6, lastPlayedAt:NOW - 3 * DAY}, {gameId:'boating', plays:5, completedPlays:4, lastPlayedAt:NOW - DAY}]}}]};
const REP = {none:['无报告', null], stab:['八段锦第二式：稳定变差（52/100）', {origin:'synthetic_demo', createdAt:NOW - DAY, findings:[{focus:'stability', subjectId:'bdj-2', score:52, trend:'worse'}]}],
 reach:['八段锦第一式：幅度变差（55/100）', {origin:'synthetic_demo', createdAt:NOW - DAY, findings:[{focus:'reach', subjectId:'bdj-1', score:55, trend:'worse'}]}],
 rhythm:['八段锦第二式：节奏一般（60/100）', {origin:'synthetic_demo', createdAt:NOW - DAY, findings:[{focus:'rhythm', subjectId:'bdj-2', score:60, trend:'same'}]}]};
const PROFILE0 = {version:1, goals:['upper_limb'], difficulties:['stiffness'], regions:['shoulders','arms'], preference:'mixed', risk:'none', acknowledged:true};
function editorHtml(p){ const box = field => Object.keys(L[field]).map(k => '<label><input type="checkbox" data-f="' + field + '" value="' + k + '"' + (p[field].includes(k) ? ' checked' : '') + '> ' + L[field][k] + '</label>').join('');
  const radio = field => Object.keys(L[field]).map(k => '<label><input type="radio" name="' + field + '" value="' + k + '"' + (p[field] === k ? ' checked' : '') + '> ' + L[field][k] + '</label>').join('');
  const sel = (id, obj) => '<select id="' + id + '">' + Object.entries(obj).map(([k, v]) => '<option value="' + k + '">' + esc(v[0]) + '</option>').join('') + '</select>';
  return '<div class="grid2"><div><fieldset><legend>训练目标</legend>' + box('goals') + '</fieldset><fieldset><legend>困难</legend>' + box('difficulties') + '</fieldset><fieldset><legend>关注部位</legend>' + box('regions') + '</fieldset></div>'
   + '<div><fieldset><legend>偏好</legend>' + radio('preference') + '</fieldset><fieldset><legend>风险</legend>' + radio('risk') + '</fieldset>'
   + '<fieldset><legend>训练 / 游戏历史（合成演示）</legend>' + sel('hist', HIST) + '</fieldset><fieldset><legend>最近报告（合成演示）</legend>' + sel('rep', REP) + '</fieldset>'
   + '<fieldset><legend>当前不可用的内容</legend>' + ['taijiquan','yijinjing','archery','racing','apple'].map(k => '<label><input type="checkbox" data-u="' + k + '"> ' + (L.prog[k] || byId.get(k).title) + '</label>').join('') + '</fieldset></div></div>' }
$('editor').innerHTML = editorHtml(PROFILE0);
$('src').innerHTML += D.scenarios.map(s => '<option value="' + s.id + '">标注场景 ' + s.id + ' · ' + L.cond[s.condition] + (s.split === 'test' ? ' · 冻结测试族' : '') + '</option>').join('');
const SCEN_NOW = Date.UTC(2026, 10, 7, 12);
function scenarioInput(s){ return {contract:E.COACH_DECISION_CONTRACT, profile:s.profile, now:SCEN_NOW,
  trainingHistory: s.history && s.history.routines.length ? {origin:'synthetic_demo', chapters:s.history.routines.map(r => ({chapterId:r.chapterId, sessions:r.sessions, completedSessions:r.completedSessions, meanScore:r.meanScore, trend:r.trend, lastPracticedAt:SCEN_NOW - r.lastDaysAgo * DAY}))} : null,
  gameHistory: s.history && s.history.games.length ? {origin:'synthetic_demo', games:s.history.games.map(g => ({gameId:g.gameId, plays:g.plays, completedPlays:g.completedPlays, lastPlayedAt:SCEN_NOW - g.lastDaysAgo * DAY}))} : null,
  latestReport: s.report ? {origin:'synthetic_demo', createdAt:SCEN_NOW - s.report.daysAgo * DAY, findings:s.report.findings.map(f => ({focus:f.focus, subjectId:f.subjectId, score:f.score, trend:f.trend}))} : null} }
function editorInput(){ const pick = f => [...document.querySelectorAll('input[data-f="' + f + '"]:checked')].map(i => i.value); const r = n => (document.querySelector('input[name="' + n + '"]:checked') || {}).value;
  const profile = {version:1, goals:pick('goals'), difficulties:pick('difficulties'), regions:pick('regions'), preference:r('preference'), risk:r('risk'), acknowledged:true};
  const unavailable = [...document.querySelectorAll('input[data-u]:checked')].map(i => i.dataset.u);
  const input = Object.assign({contract:E.COACH_DECISION_CONTRACT, profile, now:NOW}, JSON.parse(JSON.stringify(HIST[$('hist').value][1])));
  const rep = REP[$('rep').value][1]; if (rep) input.latestReport = JSON.parse(JSON.stringify(rep));
  if (unavailable.length) input.availability = {snapshotRef:'lab', unavailableIds:unavailable};
  return input }
// Baselines receive the same information (history/report as CoachEvidence, like the training scenarios).
function evidenceOf(input){ const now = input.now || NOW; const days = t => t == null ? 0 : Math.max(0, Math.round((now - t) / DAY));
  const h = input.trainingHistory || input.gameHistory ? {sessionsLast28d:0, routines:((input.trainingHistory || {}).chapters || []).filter(c => byId.get(c.chapterId)).map(c => ({chapterId:c.chapterId, programId:byId.get(c.chapterId).programId, sessions:c.sessions, completedSessions:c.completedSessions, lastDaysAgo:days(c.lastPracticedAt), meanScore:c.meanScore, trend:c.trend})),
    games:((input.gameHistory || {}).games || []).map(g => ({gameId:g.gameId, plays:g.plays, completedPlays:g.completedPlays, lastDaysAgo:days(g.lastPlayedAt)}))} : null;
  const r = input.latestReport ? {dataOrigin:'synthetic_scenario', subjectId:'', daysAgo:days(input.latestReport.createdAt), findings:input.latestReport.findings.map(f => ({focus:f.focus, subjectId:f.subjectId, score:f.score, trend:f.trend, label:(byId.get(f.subjectId) || {}).title || f.subjectId}))} : null;
  try { return E.scenarioEvidence(h, r) } catch (e) { return [] } }
function baselines(input){ const p = input.profile; const evidence = evidenceOf(input); const availability = input.availability || null;
  let p0 = null, pr = null;
  try { p0 = E.recommendCoach(p, {evidence, limitations:[], decisionStatus:'synthetic'}) } catch (e) {}
  try { pr = evidence.length ? (p.risk === 'none' ? E.rankCoachDecision({profile:p, evidence, availability, catalogue:E.COACH_KNOWLEDGE}).result : null) : E.getCoachDecisionRecommendation({schemaVersion:1, source:'rules', profile:p}, {mode:'active', availability:availability || undefined}).active.result } catch (e) {}
  return {p0, pr} }
const slateIds = r => r.decisionOrigin === 'model' ? [...r.display.result.chapters, ...r.display.result.games].map(x => x.entry.id) : r.ranking.filter(x => x.inSlate).map(x => x.id);
function kendall(a, b){ const c0 = a.filter(x => b.includes(x)); if (c0.length < 2) return null; const pa = new Map(a.map((x, i) => [x, i])), pb = new Map(b.map((x, i) => [x, i])); let c = 0, d = 0;
  for (let i = 0; i < c0.length; i++) for (let j = i + 1; j < c0.length; j++) { const s = Math.sign((pa.get(c0[i]) - pa.get(c0[j])) * (pb.get(c0[i]) - pb.get(c0[j]))); if (s > 0) c++; else if (s < 0) d++ } return (c - d) / (c + d) }

// ---------- live decision ----------
function itemsList(items, empty){ if (!items.length) return '<p class="muted">' + esc(empty) + '</p>';
  return '<ol>' + items.map(i => '<li><b>' + esc(i.entry.title) + '</b>' + (i.entry.kind === 'game' ? ' <span class="tag">游戏 · 独立应用</span>' : '') + '<br><span class="muted">' + i.reasons.slice(0, 2).map(esc).join('；') + '</span></li>').join('') + '</ol>' }
function slateList(result, color, label, emptyText){ const head = '<span class="sw" style="background:' + color + '"></span><strong>' + label + '</strong>';
  if (!result || result.status !== 'ready') return '<div>' + head + '<p class="muted">' + esc(emptyText || (result ? result.message : '无')) + '</p></div>';
  return '<div>' + head + '<ol>' + [...result.chapters, ...result.games].map(i => '<li>' + esc(i.entry.title) + '</li>').join('') + '</ol></div>' }
function signedBars(parts){ const max = Math.max(0.01, ...parts.map(p => Math.abs(p.points)));
  return '<div class="scroll"><table>' + parts.map(p => { const w = Math.round(100 * Math.abs(p.points) / max);
    return '<tr><td>' + esc(p.label) + ' <span class="muted">' + esc(p.groupLabel) + '</span></td><td style="width:40%;min-width:120px"><div style="display:flex;align-items:center"><div style="width:50%;display:flex;justify-content:flex-end">' + (p.points < 0 ? '<div style="height:12px;border-radius:4px 0 0 4px;background:var(--neg);width:' + w + '%"></div>' : '') + '</div><div style="width:1px;height:16px;background:var(--fg2)"></div><div style="width:50%">' + (p.points > 0 ? '<div style="height:12px;border-radius:0 4px 4px 0;background:var(--s3);width:' + w + '%"></div>' : '') + '</div></div></td><td class="num">' + (p.points >= 0 ? '+' : '') + p.points.toFixed(2) + '</td></tr>' }).join('') + '</table></div>' }
let lastJson = null;
function render(input){
  const engine = ENGINES.find(e => e.key === $('engine').value) || ENGINES[0];
  const mode = (document.querySelector('input[name="mode"]:checked') || {}).value || 'off';
  const allow = $('allow').checked;
  const t0 = performance.now(); const res = engine.rec(input, {mode, allowExperimentalModel:allow}); const ms = performance.now() - t0;
  const shadow = mode === 'off' ? engine.rec(input, {mode:'shadow'}) : res;
  const {p0, pr} = baselines(input);
  lastJson = input; $('json').value = JSON.stringify(input, null, 1);
  const shown = res.display ? res.display.result : null;
  let h = '<div class="grid2"><div class="card seen"><div class="row"><h3 style="margin:0">用户将看到</h3><span class="pill" style="color:' + (res.decisionOrigin === 'model' ? 'var(--s3)' : 'var(--s1)') + '">' + (res.decisionOrigin === 'model' ? '训练模型推荐' : '规则推荐') + '</span>' + (res.decisionOrigin === 'model' && M.tier === 'ai_experimental' ? '<span class="pill warnc">实验性模型</span>' : '') + '<span class="tag">' + mode.toUpperCase() + '</span><span class="tag">' + ms.toFixed(1) + ' ms</span></div>'
    + (res.fallbackReason ? '<p class="warnc">' + esc(FALLBACK[res.fallbackReason] || res.fallbackReason) + (res.abstainReason ? '：' + esc(ABSTAIN[res.abstainReason] || res.abstainReason) + (res.outOfDistributionFeatures.length ? '（' + res.outOfDistributionFeatures.map(f => esc(E.featureLabel(f))).join('、') + '）' : '') : '') + '</p>' : '')
    + (shown ? '<p class="muted">' + esc(shown.message) + '</p><h3>章节</h3>' + itemsList(shown.chapters, '无') + '<h3>游戏</h3>' + itemsList(shown.games, '无') + (shown.routines && shown.routines.length ? '<p class="muted">功法：' + shown.routines.map(r => esc(r.entry.title)).join('、') + '</p>' : '') : '<p class="warnc">' + esc(res.error ? res.error.message : '无展示') + '</p>')
    + (res.inputIssues.length ? '<p class="warnc">输入问题：' + res.inputIssues.map(i => esc(i.path + ' ' + i.message)).join('；') + '</p>' : '')
    + '<p class="muted">数据来源：画像 自述 · 训练历史 ' + res.dataSources.trainingHistory + ' · 游戏历史 ' + res.dataSources.gameHistory + ' · 报告 ' + res.dataSources.latestReport + '</p></div>';
  h += '<div class="card"><h3>门禁与模型状态</h3><table><tr><td>执行</td><td>' + res.execution + (mode === 'off' ? '（下方排序来自额外的影子调用，仅供展示）' : '') + '</td></tr><tr><td>回退原因</td><td>' + (res.fallbackReason || '无（展示模型结果）') + '</td></tr><tr><td>置信度（首选胜过第二）</td><td>' + pct(shadow.confidence) + '</td></tr><tr><td>独立 Guard</td><td>' + (res.guard.checked ? (res.guard.violations.length ? '<span class="warnc">拒绝：' + esc(res.guard.violations.join(', ')) + '</span>' : '<span class="ok">通过</span>') : '未运行') + '</td></tr>'
    + '<tr><td>模型</td><td>' + esc(res.model ? res.model.id + ' v' + res.model.version + ' · ' + res.model.binding + ' · ' + res.model.tierLabel : '—') + '</td></tr>' + (engine.note ? '<tr><td>变体说明</td><td>' + esc(engine.note) + '</td></tr>' : '') + '</table>'
    + (res.decisionOrigin === 'model' && res.comparison ? '<p class="muted">与规则推荐相比：' + {identical:'相同', reordered:'顺序不同', changed:'内容不同', not_compared:'未比较'}[res.comparison.rankingEffect] + (res.comparison.addedIds.length ? '；新增 ' + res.comparison.addedIds.map(id => esc(byId.get(id).title)).join('、') : '') + '</p>' : '') + '</div></div>';
  if (shadow.ranking.length) {
    const top = shadow.ranking[0];
    h += '<div class="grid2"><div class="card"><h3>为什么首选「' + esc(top.title) + '」（适配概率 ' + pct(top.suitability) + '）</h3><p>' + top.reasons.map(esc).join('；') + '</p><p class="muted">分数 = 各特征标准化值 × 学到的权重之和；绿色加分，灰色减分（前 6 项）。</p>' + signedBars(top.explanation) + '</div>'
      + '<div class="card"><h3>最终推荐对照（同样的输入信息）</h3><div class="grid3">' + slateList(p0, 'var(--s1)', '规则引擎 P0') + slateList(pr, 'var(--s2)', 'PR #49 手工权重', input.profile.risk !== 'none' ? '风险画像：暂停推荐' : undefined)
      + '<div><span class="sw" style="background:var(--s3)"></span><strong>训练模型</strong><ol>' + (shadow.abstained ? '' : slateIds(shadow).map(id => '<li>' + esc(byId.get(id).title) + '</li>').join('')) + '</ol>' + (shadow.abstained ? '<p class="muted">弃权：' + esc(ABSTAIN[shadow.abstainReason] || '') + '，展示规则结果</p>' : '') + '</div></div></div></div>';
    const p0ids = p0 && p0.status === 'ready' ? [...p0.chapters, ...p0.games].map(i => i.entry.id) : [], prids = pr ? [...pr.chapters, ...pr.games].map(i => i.entry.id) : [];
    h += '<div class="card scroll"><details open><summary>模型对第一阶段 ' + shadow.ranking.length + ' 个候选的排序（降序）</summary><table><tr><th>#</th><th>候选</th><th class="num">分数</th><th class="num">适配概率</th><th>推荐组合</th><th>主要依据</th><th>规则</th><th>PR #49</th></tr>'
      + shadow.ranking.map(c => '<tr><td>' + c.rank + '</td><td>' + esc(c.title) + '<br><span class="muted">' + (c.kind === 'game' ? '游戏 · 独立应用' : '章节') + '</span></td><td class="num">' + c.score.toFixed(2) + '</td><td class="num">' + pct(c.suitability) + '</td><td>' + (c.inSlate ? '✓' : '') + '</td><td>' + c.reasons.map(r => '<span class="tag">' + esc(r) + '</span>').join('') + '</td><td>' + (p0ids.includes(c.id) ? '✓' : '') + '</td><td>' + (prids.includes(c.id) ? '✓' : '') + '</td></tr>').join('') + '</table></details>'
      + '<p class="muted">模型的程序级视图：' + shadow.programmes.map(p => esc(p.title) + ' ' + p.score.toFixed(2)).join(' · ') + '</p></div>';
  } else h += '<div class="card"><p class="muted">模型没有排序输出（' + esc(FALLBACK[shadow.fallbackReason] || shadow.fallbackReason || '') + '）。</p><div class="grid3">' + slateList(p0, 'var(--s1)', '规则引擎 P0') + slateList(pr, 'var(--s2)', 'PR #49 手工权重', '风险画像：暂停推荐') + '</div></div>';
  h += '<div class="card"><details><summary>完整响应 JSON（CoachDecisionResponse）</summary><pre>' + esc(JSON.stringify(res, null, 1)) + '</pre></details></div>';
  $('decision').innerHTML = h;
}
function run(){ const v = $('src').value; $('editor').style.display = v === 'custom' ? '' : 'none';
  render(v === 'custom' ? editorInput() : scenarioInput(D.scenarios.find(x => x.id === v))) }
$('src').onchange = run; $('engine').onchange = () => render(lastJson || editorInput()); $('editor').addEventListener('change', run); $('allow').onchange = () => render(lastJson || editorInput());
document.querySelectorAll('input[name="mode"]').forEach(i => i.onchange = () => render(lastJson || editorInput()));
$('runjson').onclick = () => { try { const v = JSON.parse($('json').value); $('jsonmsg').textContent = ''; render(v) } catch (e) { $('jsonmsg').textContent = 'JSON 解析失败：' + e.message } };
run();

// ---------- live demo cases ----------
const base = PROFILE0;
const P = o => Object.assign({}, base, o);
const IN = (p, extra) => Object.assign({contract:E.COACH_DECISION_CONTRACT, profile:p, now:NOW}, JSON.parse(JSON.stringify(extra || {})));
const CASES = [
 ['改变训练目标', '同一用户把目标从「上肢功能练习」改为「日常锻炼」。', IN(base), IN(P({goals:['daily']})), '目标通过候选检索与“目标 × 内容侧重”特征影响排序；消融显示目标交叉特征在开发集上没有增益，所以变化主要体现在候选集合上。'],
 ['增加训练历史', '同一用户从新用户到第 4 周（合成演示历史）。', IN(base), IN(base, HIST.s3[1]), '模型更偏向衔接已练内容（「与你最近的练习记录相衔接」），新内容占比下降；这是 AI 标签学到的偏好，未经人工验证。'],
 ['改变关注部位', '同一用户把关注部位从「肩部 + 上肢」改为「躯干 + 下肢」。', IN(base), IN(P({regions:['trunk','legs']})), '部位交叉特征是最重要的画像特征（去掉后开发集 NDCG@5 −0.058，CI 不跨 0）。'],
 ['最近报告出现问题', '第 2 周的用户，最近报告提示八段锦第二式「稳定」变差。', IN(base, HIST.s2[1]), IN(base, Object.assign({}, HIST.s2[1], {latestReport:REP.stab[1]})), '报告特征效应很小：稳定类内容平均排名略有提前，其他方向不一致（消融不显著）。'],
 ['内容不可用', '宿主报告「林间射箭」和「太极拳」当前不可用。', IN(base), IN(base, {availability:{snapshotRef:'demo', unavailableIds:['archery','taijiquan']}}), '可用性在模型之前过滤候选，并由独立 Guard 复核；模型不会排序或展示不可用内容。'],
 ['出现风险条件', '同一用户在画像中报告「眩晕」。', IN(base), IN(P({risk:'dizziness'})), '风险画像在模型之前由安全门禁暂停推荐；模型不会被调用（13,392 个风险画像全部暂停）。'],
 ['训练分布外输入', '只用功法、同时关注 3 个 → 4 个部位（肩、颈、上肢、下肢）。', IN(P({goals:['mobility'], difficulties:['none'], regions:['shoulders','neck','arms'], preference:'routine'})), IN(P({goals:['mobility'], difficulties:['none'], regions:['shoulders','neck','arms','legs'], preference:'routine'})), '首选候选与所选部位的重合数超出训练范围（+25% 余量），模型弃权并回退规则（冷启动画像空间中 197 / 22,320 个属于这种情况）。']];
function caseCol(title, r){ const items = r.display ? [...r.display.result.chapters, ...r.display.result.games] : [];
  return '<div><h3>' + title + ' <span class="pill" style="color:' + (r.decisionOrigin === 'model' ? 'var(--s3)' : 'var(--s1)') + '">' + (r.decisionOrigin === 'model' ? '模型' : '规则') + '</span></h3>'
    + (r.fallbackReason ? '<p class="warnc">' + esc(FALLBACK[r.fallbackReason] || r.fallbackReason) + (r.abstainReason ? '：' + esc(ABSTAIN[r.abstainReason]) : '') + '</p>' : '')
    + (r.status === 'safety_hold' ? '<p class="muted">' + esc(r.display.result.message) + '</p>' : '<ol>' + items.map(i => '<li>' + esc(i.entry.title) + '</li>').join('') + '</ol>') + '</div>' }
$('cases').innerHTML = CASES.map((c, k) => { const a = E.recommendCoachDecision(c[2], {mode:'active', allowExperimentalModel:true}), b = E.recommendCoachDecision(c[3], {mode:'active', allowExperimentalModel:true});
  const tau = kendall(a.ranking.map(x => x.id), b.ranking.map(x => x.id));
  return '<div class="card case"><h3>' + (k + 1) + '. ' + esc(c[0]) + '</h3><p class="muted">' + esc(c[1]) + '</p><div class="cols">' + caseCol('改变前', a) + caseCol('改变后', b) + '</div>'
   + '<p>' + (tau == null ? '' : '共同候选的排序一致度（Kendall τ）' + tau.toFixed(2) + '；') + esc(c[4]) + '</p><button data-case="' + k + '">在实时决策中打开“改变后”</button></div>' }).join('');
document.querySelectorAll('button[data-case]').forEach(b => b.onclick = () => { const c = CASES[Number(b.dataset.case)]; $('src').value = 'custom'; document.querySelector('input[name="mode"][value="active"]').checked = true; $('allow').checked = true; render(c[3]); location.hash = '#s-live' });

// ---------- persona gallery ----------
const PERSONAS = [
 ['久坐上班族：肩颈僵硬', {goals:['mobility','daily'], difficulties:['stiffness','sedentary'], regions:['shoulders','neck'], preference:'mixed'}],
 ['抬手困难，康复辅助意向', {goals:['rehab_support','upper_limb'], difficulties:['reach_difficulty'], regions:['shoulders','arms'], preference:'routine'}],
 ['喜欢游戏的下肢与躯干锻炼', {goals:['daily','mobility'], difficulties:['none'], regions:['legs','trunk'], preference:'game'}],
 ['上肢酸痛，想练上肢功能', {goals:['upper_limb'], difficulties:['soreness'], regions:['arms'], preference:'game'}],
 ['颈部僵硬', {goals:['mobility'], difficulties:['stiffness'], regions:['neck'], preference:'routine'}],
 ['上肢功能 + 混合偏好', {goals:['upper_limb'], difficulties:['stiffness'], regions:['shoulders','arms'], preference:'mixed'}]];
$('gallery').innerHTML = PERSONAS.map(([name, p]) => { const input = IN(Object.assign({version:1, risk:'none', acknowledged:true}, p)); const r = E.recommendCoachDecision(input, {mode:'active', allowExperimentalModel:true}); const {p0, pr} = baselines(input);
  return '<div class="card"><h3>' + esc(name) + '</h3><p class="muted">' + p.goals.map(g => L.goals[g]).join('、') + ' · ' + p.difficulties.map(d => L.difficulties[d]).join('、') + ' · ' + p.regions.map(x => L.regions[x]).join('、') + ' · ' + L.preference[p.preference] + '</p><div class="grid3">'
   + slateList(p0, 'var(--s1)', '规则') + slateList(pr, 'var(--s2)', 'PR #49') + slateList(r.decisionOrigin === 'model' ? r.display.result : null, 'var(--s3)', 'fp-cdm', '模型弃权（' + esc(ABSTAIN[r.abstainReason] || r.fallbackReason) + '），回退规则') + '</div>'
   + (r.ranking[0] ? '<p class="muted">fp-cdm 首选理由：' + r.ranking[0].reasons.map(esc).join('；') + '</p>' : '') + '</div>' }).join('');

// ---------- charts ----------
const tip = $('tip');
function hover(el, text){ el.addEventListener('mousemove', e => { tip.style.display = 'block'; tip.textContent = text; tip.style.left = Math.min(e.clientX + 12, innerWidth - 330) + 'px'; tip.style.top = (e.clientY + 12) + 'px' }); el.addEventListener('mouseleave', () => tip.style.display = 'none') }
function svgOf(W, H, title){ const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title);
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; svg.appendChild(n); return n }; return {svg, add} }
function cardOf(title, note, svg, legend, rows, fmt){ const card = document.createElement('div'); card.className = 'card'; card.innerHTML = '<h3>' + esc(title) + '</h3>' + (note ? '<p class="muted">' + esc(note) + '</p>' : '');
  card.appendChild(svg); if (legend) { const lg = document.createElement('p'); lg.className = 'muted'; lg.innerHTML = legend; card.appendChild(lg) }
  const det = document.createElement('details'); det.innerHTML = '<summary>表格视图</summary><table><tr><th>项目</th><th class="num">数值</th><th class="num">95% CI</th></tr>' + rows.map(r => '<tr><td>' + esc(r.label) + '</td><td class="num">' + fmt(r.value) + '</td><td class="num">' + (r.ci ? r.ci.map(fmt).join(' – ') : '—') + '</td></tr>').join('') + '</table>';
  card.appendChild(det); return card }
function hbars(rows, max, opts){
  const W = 560, rowH = 28, left = 200, right = 62, H = rows.length * rowH + 26, min = opts.min || 0, scale = v => left + (W - left - right) * (Math.max(min, v) - min) / (max - min);
  const {svg, add} = svgOf(W, H, opts.title);
  for (let i = 0; i <= 4; i++) { const t = min + (max - min) * i / 4; add('line', {x1:scale(t), x2:scale(t), y1:4, y2:H - 20, stroke:'var(--grid)', 'stroke-width':1}); add('text', {x:scale(t), y:H - 6, 'text-anchor':'middle', 'font-size':11, fill:'var(--muted)'}, t.toFixed(2)) }
  rows.forEach((r, i) => { const y = 8 + i * rowH;
    add('text', {x:left - 8, y:y + 13, 'text-anchor':'end', 'font-size':12, fill:'var(--fg2)'}, r.label);
    const bar = add('rect', {x:left, y:y + 4, width:Math.max(1, scale(r.value) - left), height:12, rx:4, fill:r.color});
    if (r.ci) { const a = scale(r.ci[0]), b = scale(r.ci[1]); add('line', {x1:a, x2:b, y1:y + 10, y2:y + 10, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:a, x2:a, y1:y + 5, y2:y + 15, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:b, x2:b, y1:y + 5, y2:y + 15, stroke:'var(--fg)', 'stroke-width':2}) }
    add('text', {x:Math.max(scale(r.value), r.ci ? scale(r.ci[1]) : 0) + 6, y:y + 14, 'font-size':12, fill:'var(--fg)'}, r.value.toFixed(3));
    hover(bar, r.label + '：' + r.value.toFixed(3) + (r.ci ? '（95% CI ' + r.ci[0].toFixed(3) + '–' + r.ci[1].toFixed(3) + '）' : '')) });
  return cardOf(opts.title, opts.note, svg, opts.legend, rows, v => v.toFixed(4)) }
/** Diverging bars around 0 (difference vs a reference) with 95% CI whiskers. */
function dbars(rows, lim, opts){
  const W = 560, rowH = 28, left = 200, right = 20, H = rows.length * rowH + 26, scale = v => left + (W - left - right) * (Math.max(-lim, Math.min(lim, v)) + lim) / (2 * lim), z = scale(0);
  const {svg, add} = svgOf(W, H, opts.title);
  for (const t of [-lim, -lim / 2, 0, lim / 2, lim]) { add('line', {x1:scale(t), x2:scale(t), y1:4, y2:H - 20, stroke:t === 0 ? 'var(--fg2)' : 'var(--grid)', 'stroke-width':1}); add('text', {x:scale(t), y:H - 6, 'text-anchor':'middle', 'font-size':11, fill:'var(--muted)'}, (t > 0 ? '+' : '') + t.toFixed(2)) }
  rows.forEach((r, i) => { const y = 8 + i * rowH, x = scale(r.value), sig = r.ci && (r.ci[0] > 0 || r.ci[1] < 0);
    add('text', {x:left - 8, y:y + 13, 'text-anchor':'end', 'font-size':12, fill:'var(--fg2)'}, r.label);
    const bar = add('rect', {x:Math.min(x, z), y:y + 4, width:Math.max(1, Math.abs(x - z)), height:12, rx:3, fill:sig ? (r.value < 0 ? 'var(--s2)' : 'var(--s3)') : 'var(--neg)'});
    if (r.ci) { const a = scale(r.ci[0]), b = scale(r.ci[1]); add('line', {x1:a, x2:b, y1:y + 10, y2:y + 10, stroke:'var(--fg)', 'stroke-width':1.5}); add('line', {x1:a, x2:a, y1:y + 6, y2:y + 14, stroke:'var(--fg)', 'stroke-width':1.5}); add('line', {x1:b, x2:b, y1:y + 6, y2:y + 14, stroke:'var(--fg)', 'stroke-width':1.5}) }
    hover(bar, r.label + '：' + (r.value >= 0 ? '+' : '') + r.value.toFixed(3) + (r.ci ? '（95% CI ' + r.ci[0].toFixed(3) + ' – ' + r.ci[1].toFixed(3) + '）' : '')) });
  return cardOf(opts.title, opts.note, svg, opts.legend, rows, v => (v >= 0 ? '+' : '') + v.toFixed(4)) }
const LEG = '<span class="sw" style="background:var(--s1)"></span>规则 P0　<span class="sw" style="background:var(--s2)"></span>PR #49 / 手工描述符　<span class="sw" style="background:var(--s3)"></span>训练模型';
const tr = $('training'), rs = $('results'), gn = $('gen'), ab = $('ablation');
if (D.m1) { const c = document.createElement('div'); c.className = 'card'; c.innerHTML = '<h3>M1 动作感知：训练数据与协议</h3><ul><li>输入：标准示范视频的 MediaPipe 二维姿态，3 s 窗口（步长 1.5 s），1,677 个窗口 × 76 个特征。</li><li>标签：目录中每章的部位 / 注意项（团队人工标注）。</li><li>协议：嵌套“留一套功法”——外层留出整套功法测试，内层只在其余 3 套功法上选模型与特征。</li><li>候选：逻辑回归、HGB、ExtraTrees；v2 新增 28 个姿态特征为负结果，未采用。</li><li>发布：M2 v1.0 绑定 M1 v1.0 的 out-of-fold 内容表（每章的值都来自没见过该功法的模型）。</li></ul>'; tr.appendChild(c) }
if (D.m2) {
  const sel = D.m2.devSelection.C_profile_history_report || [];
  const c = document.createElement('div'); c.className = 'card scroll';
  c.innerHTML = '<h3>M2 模型选择：开发集 6 折分组交叉验证（' + D.m2.splits.devFamilies + ' 个族）</h3><p class="muted">只用开发族选择；冻结测试族不参与。可部署要求为线性模型（HGB 仅作离线对照）。选中：' + esc(D.m2.devSelection.C_profile_history_report_chosen.family + ' / ' + D.m2.devSelection.C_profile_history_report_chosen.hp) + '</p><table><tr><th>模型族</th><th>超参数</th><th class="num">NDCG@5</th><th class="num">成对准确率</th></tr>'
   + sel.map(r => '<tr><td>' + r.family + '</td><td>' + r.hp + '</td><td class="num">' + f3(r['ndcg@5']) + '</td><td class="num">' + f3(r.pairwise_acc) + '</td></tr>').join('') + '</table><p class="muted">校准：成对温度 T=' + f3(D.m2.calibration.pairTemperature) + '；Platt a=' + f3(D.m2.calibration.platt.a) + ', b=' + f3(D.m2.calibration.platt.b) + '；弃权阈值 τ=' + f3(D.m2.calibration.abstainSuitabilityBelow) + '。</p>';
  tr.appendChild(c);
}
if (D.research) {
  const R = D.research;
  tr.appendChild(hbars(Object.entries(R.learningCurveNdcg5).map(([k, v]) => ({label:k.replace('_train_families', ' 个训练族'), value:v, color:'var(--s3)'})), 1, {min:0.6, title:'学习曲线：训练族数量 → 开发集 NDCG@5', note:'更多带标签的场景仍有提升空间'}));
  const cal = document.createElement('div'); cal.className = 'card scroll';
  cal.innerHTML = '<h3>适配概率校准（开发集交叉拟合）</h3><p class="muted">ECE ' + f3(R.calibration.ece10) + '，Brier ' + f3(R.calibration.brier) + '，基础“适合”比例 ' + f3(R.calibration.baseRate) + '</p><table><tr><th>预测区间</th><th class="num">样本</th><th class="num">平均预测</th><th class="num">实际适合比例</th></tr>' + R.calibration.reliability.map(b => '<tr><td>' + b.bin + '</td><td class="num">' + b.n + '</td><td class="num">' + f3(b.meanPredicted) + '</td><td class="num">' + f3(b.observedSuitable) + '</td></tr>').join('') + '</table>';
  tr.appendChild(cal);
}
if (D.integ && D.integ.checkpoints) {
  const C = D.integ.checkpoints; const rows = Object.entries(C).filter(([, v]) => v.heldOutDev).map(([k, v]) => ({label:k + '（' + v.trainFamilies + ' 族训练）', value:v.heldOutDev['ndcg@5'], color:'var(--s3)'}));
  tr.appendChild(hbars(rows, 1, {min:0.6, title:'训练阶段：用部分开发族训练，在其余开发族上评估', note:'同一训练流程；100% 阶段即发布配置（无留出族）。下方“行为探针”展示各阶段排序与发布模型的差异'}));
}
if (D.m2) {
  const t = D.m2.test, ci = D.m2.bootstrap95;
  const SYS = [['rules_p0', '规则引擎 P0', 'var(--s1)', ci['rules_p0_ndcg@5']], ['pr49_manual_ranker', 'PR #49 手工权重', 'var(--s2)', ci['pr49_ndcg@5']], ['C_profile_history_report', '训练模型 fp-cdm', 'var(--s3)', ci['model_C_ndcg@5']]];
  rs.appendChild(hbars(SYS.map(([k, l, c, cc]) => ({label:l, value:t[k].all['ndcg@5'], color:c, ci:cc})), 1, {min:0.4, title:'冻结测试 NDCG@5（6 个族 / 18 个场景，只评测一次）', note:'标签 = AI 标注；模型 − P0 差值 CI [' + ci['model_minus_p0_ndcg@5'].map(f3).join(', ') + ']，跨 0', legend:LEG}));
  rs.appendChild(hbars(SYS.map(([k, l, c]) => ({label:l, value:t[k].all['pairwise_acc'], color:c})), 1, {min:0.4, title:'冻结测试：成对排序准确率', legend:LEG}));
  const keys = ['ndcg@3','ndcg@5','p@3','p@5','r@3','r@5','pairwise_acc'];
  const tb = document.createElement('div'); tb.className = 'card scroll'; tb.innerHTML = '<h3>冻结测试全部指标（AI 标签）</h3><table><tr><th>系统</th>' + keys.map(k => '<th class="num">' + k + '</th>').join('') + '</tr>' + SYS.map(([k, l]) => '<tr><td>' + l + '</td>' + keys.map(m => '<td class="num">' + f3(t[k].all[m]) + '</td>').join('') + '</tr>').join('') + '</table><p class="muted">公平对照：三者使用相同候选池、相同标签和相同指标；规则与 PR #49 收到相同的历史 / 报告信息。</p>';
  rs.appendChild(tb);
  if (D.m2.errorAnalysisTop1 && D.m2.errorAnalysisTop1.length) { const e = document.createElement('div'); e.className = 'card scroll';
    e.innerHTML = '<h3>误差案例：测试集中 top-1 不是最高分</h3><table><tr><th>场景</th><th>模型 top-1（分）</th><th>最高分候选（分）</th><th>规则 top-1（分）</th></tr>' + D.m2.errorAnalysisTop1.map(x => '<tr><td>' + x.scenarioId + '</td><td>' + esc(byId.get(x.modelTop1).title) + '（' + x.top1Label + '）</td><td>' + x.bestCandidates.map(id => esc(byId.get(id).title)).join('、') + '（' + x.bestLabel + '）</td><td>' + esc(byId.get(x.p0Top1).title) + '（' + x.p0Top1Label + '）</td></tr>').join('') + '</table>'; rs.appendChild(e) }
}
if (D.e245 && D.e245.e2) {
  const e2 = D.e245.e2, S3 = [['rules_p0', '规则 P0', 'var(--s1)'], ['pr49', 'PR #49', 'var(--s2)'], ['cdm', 'fp-cdm', 'var(--s3)']];
  rs.appendChild(hbars(S3.map(([k, l, c]) => ({label:l, value:e2.meanRegionCoverage[k], color:c})), 1, {min:0.5, title:'个性化：所选部位平均覆盖率（22,320 个冷启动画像）', note:'画像为枚举的自述组合，不代表真实用户分布；fp-cdm 在 ' + e2.cdmAbstainedOrFellBack + ' 个画像上弃权并回退规则', legend:LEG}));
  rs.appendChild(hbars(S3.map(([k, l, c]) => ({label:l, value:e2.normalisedEntropy[k], color:c})), 1, {title:'个性化：推荐组合区分度（归一化熵）', note:'不同推荐组合数：规则 ' + e2.distinctSlates.rules_p0 + '，PR #49 ' + e2.distinctSlates.pr49 + '，fp-cdm ' + e2.distinctSlates.cdm, legend:LEG}));
}
if (D.research) { const A = D.research.ablation, row = (k, l, color) => ({label:l, value:A[k]['ndcg@5'], ci:A[k]['ndcg@5_ci95'], color});
  ab.appendChild(hbars([row('rules_p0', '规则 P0', 'var(--s1)'), row('pr49_manual_ranker', 'PR #49 手工权重', 'var(--s2)'), row('tiny_3feat', '学习：3 个基础特征', 'var(--s3)'), row('P_no_m1', '学习：画像×内容（无 M1）', 'var(--s3)'), row('P', '学习：画像×内容 + M1', 'var(--s3)'), row('PH', '+ 历史', 'var(--s3)'), row('PHR', '+ 历史 + 报告（发布）', 'var(--s3)')], 1, {min:0.6, title:'特征组逐级加入（开发集 NDCG@5，族级 95% CI）', note:'标签 = AI 标注', legend:LEG})) }
if (D.integ) {
  const A = D.integ.ablation, NAMES = {minus_goal_crosses:'去掉 目标×内容侧重', minus_difficulty_crosses:'去掉 困难×内容侧重', minus_region_crosses:'去掉 部位匹配', minus_preference:'去掉 形式偏好', minus_all_profile_crosses:'去掉 全部画像交叉', minus_m1_content:'去掉 M1 动作感知', minus_content_tags:'去掉 内容标签',
    minus_history_all:'去掉 全部历史', minus_history_practice:'去掉 练习记录', minus_history_quality:'去掉 完成率/得分/趋势', minus_history_games:'去掉 游戏历史', minus_report_all:'去掉 全部报告'};
  const rowsOf = (keys, sub) => keys.map(k => ({label:NAMES[k], value:A[k][sub].diffVsFull['ndcg@5'].meanDiff, ci:A[k][sub].diffVsFull['ndcg@5'].ci95}));
  const DL = '<span class="sw" style="background:var(--s2)"></span>显著变差　<span class="sw" style="background:var(--s3)"></span>显著变好　<span class="sw" style="background:var(--neg)"></span>CI 跨 0（不显著）';
  ab.appendChild(dbars(rowsOf(['minus_region_crosses','minus_preference','minus_all_profile_crosses','minus_goal_crosses','minus_difficulty_crosses','minus_m1_content','minus_content_tags'], 'all_dev'), 0.12, {title:'用户画像特征消融：去掉后 NDCG@5 的变化（全部开发场景）', note:'相对完整模型 ' + f3(A.full_PHR.all_dev['ndcg@5']) + '；配对族级 bootstrap 95% CI；同一模型族与超参数，不重新选择', legend:DL}));
  ab.appendChild(dbars(rowsOf(['minus_history_all','minus_history_practice','minus_history_quality','minus_history_games','minus_report_all'], 'with_history_B_C'), 0.06, {title:'历史 / 报告特征消融：去掉后 NDCG@5 的变化（有历史的场景）', note:'有历史的开发场景（条件 B、C）；完整模型 ' + f3(A.full_PHR.with_history_B_C['ndcg@5']), legend:DL}));
  const tb = document.createElement('div'); tb.className = 'card scroll'; tb.innerHTML = '<h3>消融全表</h3><table><tr><th>特征集</th><th class="num">特征数</th><th class="num">全部 NDCG@5</th><th class="num">成对准确率</th><th class="num">有历史 NDCG@5</th><th class="num">有报告 NDCG@5</th></tr>' + Object.entries(A).map(([k, v]) => '<tr><td>' + esc(NAMES[k] || (k === 'full_PHR' ? '完整（发布）' : '仅画像与内容 P')) + '</td><td class="num">' + v.features + '</td><td class="num">' + f3(v.all_dev['ndcg@5']) + '</td><td class="num">' + f3(v.all_dev.pairwise_acc) + '</td><td class="num">' + f3(v.with_history_B_C['ndcg@5']) + '</td><td class="num">' + f3(v.with_report_C['ndcg@5']) + '</td></tr>').join('') + '</table><p class="muted">只用 18 个开发族；冻结测试族不参与。预先声明为解释性实验，不据此改变发布模型。</p>';
  ab.appendChild(tb);
}
if (D.research) { const R = D.research;
  ab.appendChild(hbars(Object.entries(R.labelNoiseRobustness).map(([k, v]) => ({label:'训练标签 ' + k.replace('pct', '%') + ' 扰动 ±1', value:v.meanNdcg5, color:'var(--s3)'})).concat([{label:'无扰动', value:R.ablation.PHR['ndcg@5'], color:'var(--s3)'}]), 1, {min:0.6, title:'鲁棒性：训练标签噪声', note:'在干净标签上评估；5 次重复平均'})) }

// ---------- probes ----------
if (D.probes) { const P8 = D.probes; let h = '<p class="muted">' + esc(P8.note) + '</p><div class="grid2">';
  h += '<div class="card scroll"><h3>改变训练目标</h3><table><tr><th>目标</th><th>模型推荐</th><th class="num">τ</th><th class="num">组合重合</th><th class="num">规则组合重合</th></tr>' + P8.goalSweep.map(g => '<tr><td>' + g.input.profile.goals.map(x => L.goals[x]).join('+') + (g.limitedProfileSafetyPoolChanged ? '<br><span class="muted">受限画像，安全池变化</span>' : '') + '</td><td>' + g.slate.map(id => esc(byId.get(id).title)).join('、') + '</td><td class="num">' + f3(g.kendallVsUpperLimbOverCommon) + '</td><td class="num">' + f3(g.slateJaccardVsUpperLimb) + '</td><td class="num">' + f3(g.rulesSlateJaccardVsUpperLimb) + '</td></tr>').join('') + '</table><p class="muted">相对「上肢功能练习」；τ 为共同候选的排序一致度。</p></div>';
  h += '<div class="card scroll"><h3>不同关注部位</h3><table><tr><th>部位</th><th>模型</th><th class="num">模型部位命中</th><th class="num">规则</th><th class="num">PR #49</th></tr>' + P8.regionSweep.map(g => '<tr><td>' + g.input.profile.regions.map(x => L.regions[x]).join('+') + '</td><td>' + (g.fallbackReason ? '<span class="warnc">弃权：' + esc(ABSTAIN[g.abstainReason] || g.fallbackReason) + '</span>' : g.slate.map(id => esc(byId.get(id).title)).join('、')) + '</td><td class="num">' + f3(g.model.regionPrecision) + '</td><td class="num">' + f3(g.rulesP0.regionPrecision) + '</td><td class="num">' + f3(g.pr49.regionPrecision) + '</td></tr>').join('') + '</table><p class="muted">部位命中 = 推荐中至少覆盖一个所选部位的比例。单独“上肢”“下肢”时模型置信不足而弃权，展示规则结果。</p></div>';
  h += '<div class="card scroll"><h3>不同训练阶段（同一用户）</h3><table><tr><th>阶段</th><th>模型推荐</th><th class="num">τ vs 新用户</th><th class="num">新内容占比</th></tr>' + P8.trainingStages.map(s => '<tr><td>' + esc(s.label) + '</td><td>' + s.slate.map(id => esc(byId.get(id).title)).join('、') + '</td><td class="num">' + f3(s.kendallVsS0) + '</td><td class="num">' + f3(s.slateNovelShare) + '</td></tr>').join('') + '</table><p class="muted">历史越多，模型越倾向衔接已练内容。是否应更多推荐新内容，需人工标注确认。</p></div>';
  h += '<div class="card scroll"><h3>最近报告</h3><table><tr><th>报告方向</th><th class="num">该方向候选平均排名（无报告）</th><th class="num">有报告</th><th class="num">τ</th></tr>' + P8.reportProbe.map(s => '<tr><td>' + L.focus[s.focus] + ' 变差</td><td class="num">' + f3(s.meanRankWithoutReport) + '</td><td class="num">' + f3(s.meanRankWithReport) + '</td><td class="num">' + f3(s.kendallVsNoReport) + '</td></tr>').join('') + '</table><p class="muted">排名越小越靠前。效应小且不一致，与报告特征消融不显著一致。</p></div>';
  const pt = P8.perturbation;
  h += '<div class="card"><h3>输入扰动稳定性</h3><div class="grid3"><div class="tile">Kendall τ 中位数<b>' + f3(pt.kendallMedian) + '</b><span class="muted">5% 分位 ' + f3(pt.kendallP05) + '</span></div><div class="tile">首选不变<b>' + pct(pt.top1Unchanged) + '</b><span class="muted">' + pt.trials + ' 次扰动</span></div><div class="tile">推荐组合不变<b>' + pct(pt.slateUnchanged) + '</b><span class="muted">' + esc(pt.perturbation) + '</span></div></div></div>';
  h += '<div class="card scroll"><h3>风险与分布外</h3><table><tr><th>输入</th><th>结果</th></tr>' + P8.riskProbe.map(s => '<tr><td>风险：' + L.risk[s.input.profile.risk] + '</td><td>' + (s.fallbackReason ? esc(FALLBACK[s.fallbackReason]) : '模型推荐') + '（执行 ' + s.execution + '）</td></tr>').join('') + P8.oodProbe.map(s => '<tr><td>' + s.input.profile.regions.length + ' 个部位</td><td>' + (s.abstainReason ? '弃权：' + esc(ABSTAIN[s.abstainReason]) + '（' + s.outOfDistributionFeatures.map(f => esc(E.featureLabel(f))).join('、') + '）' : '正常排序') + '</td></tr>').join('') + '</table></div></div>';
  if (P8.variants) h += '<div class="card scroll"><h3>研究变体与训练阶段：与发布模型的排序一致度（Kendall τ）</h3><table><tr><th>变体</th>' + P8.variantUsers.map(u => '<th class="num">' + esc(u.label) + '</th>').join('') + '</tr>' + P8.variants.map(v => '<tr><td>' + esc(VARIANT_LABEL[v.variant] || v.variant) + '</td>' + v.users.map(u => '<td class="num">' + (u.abstainReason ? '弃权' : f3(u.kendallVsRelease)) + '</td>').join('') + '</tr>').join('') + '</table><p class="muted">在“实时决策”中切换“模型”即可查看任一变体的实际排序。研究变体为非绑定权重，只能影子运行。</p></div>';
  $('probes').innerHTML = h }

// ---------- generalisation ----------
if (D.m1v11) {
  const r = D.m1v11.results, PR = ['baduanjin','taijiquan','wuqinxi','yijinjing'];
  const rows = []; for (const p of PR) { rows.push({label:L.prog[p] + ' · M1 v1.1', value:r.m1_v11_nested.perHeldOutProgrammeMacro[p], color:'var(--s3)'}); rows.push({label:L.prog[p] + ' · 手工描述符', value:r.pr49_descriptors_baseline.perHeldOutProgrammeMacro[p], color:'var(--s2)'}) }
  gn.appendChild(hbars(rows, 1, {min:0.3, title:'M1 跨功法泛化：留出整套功法的宏平均 AUC', note:'嵌套按功法留一；总体 ' + f3(r.m1_v11_nested.macroAucLearnable) + ' vs 描述符 ' + f3(r.pr49_descriptors_baseline.macroAucLearnable) + '，差值 CI [' + r.nested_minus_baseline_macro_ci95.map(f3).join(', ') + ']'}));
  const lab = k => ({'region:shoulders':'部位·肩','region:neck':'部位·颈','region:arms':'部位·上肢','region:trunk':'部位·躯干','region:legs':'部位·下肢','caution:overhead':'注意·过顶','caution:balance':'注意·平衡','caution:twist':'注意·转体','caution:bending':'注意·俯身'})[k] || k;
  const lr = []; for (const [k, v] of Object.entries(r.m1_v11_nested.perLabel)) { if (!v.learnable) continue; lr.push({label:lab(k) + ' · M1', value:v.auc, color:'var(--s3)'}); lr.push({label:lab(k) + ' · 描述符', value:r.pr49_descriptors_baseline.perLabel[k].auc, color:'var(--s2)'}) }
  gn.appendChild(hbars(lr, 1, {min:0.3, title:'M1 各标签 AUC（嵌套 LOPO）', note:'weight_bearing 只有 1 个正例章节，不可学习'}));
}
if (D.m1robust) { const R = D.m1robust.macroAuc, row = (l, v) => ({label:l, value:typeof v === 'number' ? v : v.mean, color:'var(--s3)'});
  gn.appendChild(hbars([row('无扰动', R.clean), row('高斯噪声 0.1 SD', R['gaussian_0.1sd']), row('高斯噪声 0.25 SD', R['gaussian_0.25sd']), row('高斯噪声 0.5 SD', R['gaussian_0.5sd']), row('20% 特征缺失', R.missing_20pct), row('40% 特征缺失', R.missing_40pct)], 1, {min:0.5, title:'M1 鲁棒性：跟踪抖动或特征缺失', note:'只扰动留出功法的测试特征；每种条件 5 个随机种子'})) }
if (D.research && D.research.crossProgrammeRanker) { const X = D.research.crossProgrammeRanker; const rows = [];
  for (const [p, v] of Object.entries(X)) { rows.push({label:L.prog[p] + ' · 规则', value:v.rules_p0_ndcg5, color:'var(--s1)'}); rows.push({label:L.prog[p] + ' · PR #49', value:v.pr49_ndcg5, color:'var(--s2)'}); rows.push({label:L.prog[p] + ' · 模型', value:v.model_ndcg5, color:'var(--s3)'}) }
  gn.appendChild(hbars(rows, 1, {min:0.6, title:'M2 跨功法泛化：训练时去掉某套功法，再为该功法内容排序', note:'开发集；标签 = AI 标注', legend:LEG})) }

// ---------- safety & performance ----------
if (D.e245) { const e4 = D.e245.e4, e5 = D.e245.e5, b = e5.bundle.engineCoreIncludingP0Pr49AndWeights;
  // live browser timing of the real engine on this device
  const t = []; for (let i = 0; i < 300; i++) { const s = performance.now(); E.recommendCoachDecision(IN(PERSONAS[i % 6] ? Object.assign({version:1, risk:'none', acknowledged:true}, PERSONAS[i % 6][1]) : base), {mode:'active', allowExperimentalModel:true}); t.push(performance.now() - s) } t.sort((x, y) => x - y);
  $('perf').innerHTML = '<div class="card"><div class="grid3">'
   + '<div class="tile">风险画像暂停<b>' + e4.riskProfiles.held + '/' + e4.riskProfiles.checked + '</b><span class="muted">模型执行 ' + e4.riskProfiles.modelExecutions + ' 次</span></div>'
   + '<div class="tile">受限画像风险条目<b>' + e4.profileSpace.limitedCautionItemsShown + '</b><span class="muted">对抗权重下 ' + e4.adversarialCautionLovingWeights.cautionItemsRankedOrShown + '</span></div>'
   + '<div class="tile">不可用内容被排序或展示<b>' + e4.unavailableContentRankedOrShown + '</b><span class="muted">宿主可用性快照</span></div>'
   + '<div class="tile">冷启动画像弃权<b>' + (e4.profileSpace.outcomes.LOW_SUITABILITY + e4.profileSpace.outcomes.OUT_OF_DISTRIBUTION) + '</b><span class="muted">低适配 ' + e4.profileSpace.outcomes.LOW_SUITABILITY + ' · 分布外 ' + e4.profileSpace.outcomes.OUT_OF_DISTRIBUTION + ' / ' + e4.profileSpace.profiles + '</span></div>'
   + '<div class="tile">整次调用 p50 / p95（开发机 Node）<b>' + e5.singleRequestMs.p50.toFixed(2) + ' / ' + e5.singleRequestMs.p95.toFixed(2) + ' ms</b><span class="muted">含校验、规则、模型、Guard；有历史+报告 ' + e5.withHistoryAndReportMs.p50.toFixed(2) + ' ms</span></div>'
   + '<div class="tile">本浏览器实测 p50 / p95<b>' + t[150].toFixed(2) + ' / ' + t[285].toFixed(2) + ' ms</b><span class="muted">页面加载时 300 次真实调用</span></div>'
   + (D.cold ? '<div class="tile">冷启动（导入 + 首次调用）<b>' + D.cold.median.importMs.toFixed(1) + ' + ' + D.cold.median.firstCallMs.toFixed(1) + ' ms</b><span class="muted">堆 ' + D.cold.median.heapMB.toFixed(1) + ' MB</span></div>' : '')
   + '<div class="tile">模型参数 / 权重文件<b>' + e5.parameters + ' / ' + (e5.weightsFileBytes / 1024).toFixed(1) + ' KB</b><span class="muted">CPU 单线程，无 GPU，无网络</span></div>'
   + '<div class="tile">接入包体（含规则与权重）<b>' + (b.minifiedBytes / 1024).toFixed(0) + ' KB</b><span class="muted">gzip ' + (b.gzipBytes / 1024).toFixed(0) + ' KB；Node 内置依赖 ' + b.nodeBuiltinImports + '</span></div></div>'
   + '<h3>故障注入</h3><div class="scroll"><table>' + Object.entries(e4.faults).map(([k, v]) => '<tr><td>' + ({missingWeights:'模型文件缺失', placeholderWeights:'权重为未训练占位', tamperedWeights:'权重被改动（版本不匹配）', inferenceException:'推理异常', experimentalWithoutApproval:'ACTIVE 未获批准'}[k] || k) + '</td><td>' + esc(v) + ' → 回退规则</td></tr>').join('') + '</table></div>'
   + '<p class="muted">何时弃权：最高适配概率低于 τ，或首选候选的特征超出训练范围（+25% 余量）；风险画像在模型之前即被安全门禁暂停。</p></div>' }

// ---------- version & reproduction ----------
(function(){ const R = E.FP_CDM_RELEASE; const man = D.manifest; const T = D.tests;
  let h = '<div class="grid2"><div class="card scroll"><h3>发布清单</h3><table><tr><td>发布</td><td>' + esc(R.release) + '（冻结 ' + esc(R.frozenAt) + '）</td></tr><tr><td>M2</td><td>' + esc(R.m2.id + ' v' + R.m2.version + ' · 运行时 ' + R.m2.runtimeVersion + ' · ' + R.m2.featureSet) + '</td></tr>'
   + '<tr><td>标签层级</td><td class="warnc">' + esc(R.m2.tier) + '</td></tr><tr><td>权重 SHA-256</td><td><code>' + esc(R.m2.weightsSha256) + '</code></td></tr><tr><td>权重指纹</td><td><code>' + esc(R.m2.weightsFingerprint) + '</code></td></tr>'
   + '<tr><td>M1 内容表 SHA-256</td><td><code>' + esc(R.m1.contentTableSha256) + '</code></td></tr><tr><td>目录指纹</td><td><code>' + esc(R.catalogueFingerprint) + '</code></td></tr><tr><td>本页校验</td><td class="' + (CARD.bundleStatus === 'ok' ? 'ok' : 'warnc') + '">' + esc(CARD.bundleStatus) + '</td></tr></table></div>'
   + '<div class="card"><h3>可信度</h3><ul><li>离线技术验证：<span class="st-ok">通过</span>（测试、Guard、评估）。</li><li>人工验证：<span class="st-pend">待进行</span>（AI 标签不等于人工或专家判断）。</li><li>产品验收：<span class="st-pend">未验收</span>（默认 OFF，ACTIVE 需负责人批准）。</li>'
   + (T ? '<li>测试：' + esc(T.summary) + '</li>' : '') + '<li>冻结测试集只评测一次；本阶段的消融与探针只用开发集或合成探针用户。</li></ul></div></div>';
  if (man) h += '<div class="card scroll"><details><summary>模型文件 SHA-256（' + man.files.length + ' 个）</summary><table><tr><th>文件</th><th class="num">字节</th><th>SHA-256</th></tr>' + man.files.map(f => '<tr><td>' + esc(f.path) + '</td><td class="num">' + f.bytes + '</td><td><code>' + esc(f.sha256) + '</code></td></tr>').join('') + '</table></details><details><summary>回退方式</summary><ul>' + man.rollback.map(r => '<li>' + esc(r.to) + '：' + esc(r.how) + '</li>').join('') + '</ul></details></div>';
  h += '<div class="card"><h3>复现（在 apps/platform 下）</h3><pre>VN=node_modules/.pnpm/vite-node@3.2.4_@types+node_de474a0b50d035fb47eb67fa144202a3/node_modules/vite-node/vite-node.mjs\\nPY="D:/Dev_Environment/Python312/python.exe -I -B"\\n# M1（真实姿态 → 内容理解）\\nnode $VN scripts/decision-model/cdm/export-window-features.ts\\n$PY scripts/decision-model/cdm/train_m1_v11.py --out scripts/decision-model/cdm/artifacts/m1-v11\\n# M2（AI 标签弱监督实验，冻结测试只评一次）\\nnode $VN scripts/decision-model/cdm/export-ranking-matrix.ts\\n$PY scripts/decision-model/cdm/train_m2.py --labels ai --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out &lt;dir&gt;\\n# 本阶段：消融、训练阶段、研究变体（只用开发集）\\n$PY scripts/decision-model/cdm/integration_experiments.py --matrix scripts/decision-model/cdm/data/m2-matrix.v1.json --ai-labels scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json --out scripts/decision-model/cdm/artifacts/integration\\nnode $VN scripts/decision-model/cdm/probes.ts --variants scripts/decision-model/cdm/artifacts/integration/variants --out scripts/decision-model/cdm/artifacts/integration/probes.json\\n# 发布校验、E2/E4/E5、测试\\nnode $VN scripts/decision-model/cdm/freeze-release.ts\\nnode $VN scripts/decision-model/cdm/evaluate-cdm.ts --out &lt;dir&gt;\\nnode node_modules/vitest/vitest.mjs run tests/coach-cdm.test.ts tests/coach-decision-engine.test.ts</pre></div>';
  $('version').innerHTML = h })();
$('limits').innerHTML = '<ul><li>标签：单一 AI 标注者（非人工、非专家）。场景为合成设计；结论只说明模型与该标签来源的一致性，不说明真实用户推荐质量或康复效果。</li><li>冻结测试只有 6 个族；NDCG 优势不显著，成对准确率优势明显。</li><li>目标交叉特征无增益，历史与报告的作用很小；有历史时模型偏向衔接已练内容。</li><li>M1 来自单一示范者的二维姿态；太极拳最难泛化。</li><li>游戏历史目前没有平台仓储；接口按缺失处理。</li><li>安全筛选在模型前后独立执行，模型分数不能解除任何限制。不做诊断、不承诺疗效、不提供剂量。</li></ul>'
 + '<h3>正式启用条件（需负责人确认）</h3><ol><li>两名团队成员标注 6 个冻结测试族（约 180 条 / 人），在人工标签上复现对照结论。</li><li>决定是否用人工标签重训正式权重；未重训前，模型只能以“实验性”身份展示。</li><li>Web 接线先用 SHADOW 模式联调；ACTIVE 需负责人批准并显式设置 allowExperimentalModel。</li><li>在比赛目标设备上复测性能。</li><li>合并到 main、启用 ACTIVE、修改安全门禁均由负责人决定。</li></ol>';
$('foot').textContent = '生成 ' + D.generatedAt + ' · 场景 SHA ' + D.scenarioSha256.slice(0, 12) + '… · 页面中的用户均为合成画像，不是真实用户';
</script></body></html>
`
writeFileSync(out, html)
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(html), bundleBytes: bundle.length, variants: variants.length, inputs: Object.fromEntries(Object.entries(data).filter(([k]) => ['m2', 'research', 'm1', 'm1v11', 'aiq', 'e245', 'cold', 'm1robust', 'integ', 'probes', 'manifest', 'tests'].includes(k)).map(([k, v]) => [k, !!v])) }))

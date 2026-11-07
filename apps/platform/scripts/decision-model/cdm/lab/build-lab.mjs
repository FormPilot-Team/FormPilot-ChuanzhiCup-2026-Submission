// Coach Decision Lab v2 generator: one self-contained offline HTML page for the competition demo.
// The real P0 / PR #49 / fp-cdm modules are bundled into the page; every decision shown is computed live in the browser.
//
//   node scripts/decision-model/cdm/lab/build-lab.mjs --out <file.html> [--weights <weights.json>]
//        [--m2-report <report.json>] [--research <m2-research-*.json>] [--m1-metrics <fp-cdm-m1.metrics.json>]
//        [--m1v11 <fp-cdm-m1-v11.report.json>] [--ai-quality <ai-label-quality.json>] [--e245 <cdm-e2-e4-e5-*.json>] [--cold <cold-start.json>]
//   --ai-label-experiment : weights trained on the single-AI-annotator labels; page is stamped "AI 标注弱监督实验".
//   --fixture-preview     : non-human weights for layout checks only; page is stamped FIXTURE PREVIEW.
// Run from apps/platform. Not a Vite entry and not an app route; it does not touch the Web build.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const flag = name => argv.includes(name)
const readJson = path => (path ? JSON.parse(readFileSync(path, 'utf8')) : null)
const out = opt('--out'); if (!out) throw new Error('--out required')
const weights = readJson(opt('--weights'))
const preview = flag('--fixture-preview')
const aiExperiment = flag('--ai-label-experiment')
const weightsHuman = weights?.trainedOn?.labels?.kind === 'human' && weights?.status !== 'AWAITING_LABELS'
const weightsAi = weights?.trainedOn?.labels?.kind === 'ai_single_annotator'
if (aiExperiment && !weightsAi) throw new Error('--ai-label-experiment requires weights trained on AI labels')
if (weights && !weightsHuman && !preview && !aiExperiment) throw new Error('weights are not human-label trained; refusing (use --fixture-preview for layout checks, --ai-label-experiment for the stamped AI-label experiment page)')

const esbuild = await import(pathToFileURL(resolve('node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')).href)
const built = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, 'entry.ts')], bundle: true, minify: true, format: 'iife', globalName: 'FPLab', platform: 'browser', write: false, logLevel: 'silent' })
const bundle = built.outputFiles[0].text
if (bundle.includes('</script')) throw new Error('bundle contains a closing script tag')
const scenarioText = readFileSync(resolve(import.meta.dirname, '../data/scenarios.v1.json'), 'utf8')
const scenarios = JSON.parse(scenarioText).scenarios.map(s => ({ id: s.id, familyId: s.familyId, condition: s.condition, split: s.split, profile: s.profile, history: s.history, report: s.report, candidates: s.candidates }))
const data = {
  generatedAt: new Date().toISOString(), preview, aiExperiment, weightsHuman, weights,
  scenarioSha256: createHash('sha256').update(scenarioText).digest('hex'), scenarios,
  m2: readJson(opt('--m2-report')), research: readJson(opt('--research')), m1: readJson(opt('--m1-metrics')), m1v11: readJson(opt('--m1v11')),
  aiq: readJson(opt('--ai-quality')), e245: readJson(opt('--e245')), cold: readJson(opt('--cold')),
}
const json = JSON.stringify(data).replace(/</g, '\\u003c')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coach Decision Lab</title>
<style>
:root{--bg:#f6f6f3;--surface:#fcfcfb;--card:#ffffff;--fg:#0b0b0b;--fg2:#52514e;--muted:#7a7974;--line:#dedcd5;--grid:#ecebe6;
 --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--neg:#8a8984;--warn:#a2461f;--ok:#1f6f45;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#97968e;--line:#373631;--grid:#2a2a27;
 --s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#8f8e87;--warn:#e08a5f;--ok:#5fc08a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#97968e;--line:#373631;--grid:#2a2a27;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--neg:#8f8e87;--warn:#e08a5f;--ok:#5fc08a;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:1160px;margin:0 auto;padding:16px}h1{font-size:23px;margin:6px 0 2px}h2{font-size:18px;margin:26px 0 8px;padding-top:6px;border-top:1px solid var(--line)}h3{font-size:15px;margin:10px 0 6px}
nav{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}nav a{color:var(--fg2);text-decoration:none;border:1px solid var(--line);border-radius:14px;padding:2px 10px;font-size:13px}
.sub{color:var(--fg2);margin:0 0 10px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0}
.banner{border-radius:10px;padding:10px 14px;margin:10px 0;border:1px solid var(--warn);color:var(--warn)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}label{white-space:nowrap}select,button{font:inherit;padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
button.primary{background:var(--s1);border-color:var(--s1);color:#fff;cursor:pointer}fieldset{border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:6px 10px}legend{color:var(--fg2);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:5px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--fg2);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:1px;font-size:12px;color:var(--fg2)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:baseline}.muted{color:var(--muted)}.ok{color:var(--ok)}.warnc{color:var(--warn)}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px}.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}#tip{position:fixed;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:13px;display:none;z-index:9}
details summary{cursor:pointer;color:var(--fg2)}.st-ok{color:var(--ok);font-weight:600}.st-exp{color:var(--warn);font-weight:600}.st-pend{color:var(--muted);font-weight:600}
</style></head><body><main>
<h1>Coach Decision Lab</h1>
<p class="sub">FormPilot 专用决策模型 fp-cdm 的实验页面：数据来源 → 训练与评估 → 实时决策 → 与规则引擎、PR #49 手工权重排序器对照。离线运行，所有决策在浏览器内实时计算，不接入正式用户页面。</p>
<nav><a href="#s-status">结论状态</a><a href="#s-data">数据与来源</a><a href="#s-live">实时决策</a><a href="#s-persona">典型画像</a><a href="#s-train">训练过程</a><a href="#s-results">实验结果</a><a href="#s-gen">跨功法泛化</a><a href="#s-perf">安全与性能</a><a href="#s-limit">局限与启用条件</a></nav>
<div id="status"></div>
<h2 id="s-status">结论状态</h2><div class="card scroll" id="verify"></div>
<h2 id="s-data">数据与来源</h2><div class="card scroll" id="datacard"></div>
<h2 id="s-live">实时决策（模型真实计算）</h2>
<div class="card"><div class="row"><label>输入 <select id="src"><option value="custom">自定义画像（无历史）</option></select></label><button class="primary" id="run">运行</button></div>
<div id="editor"></div></div>
<div id="state" class="grid3"></div><div id="decision"></div>
<h2 id="s-persona">典型画像下的推荐差异（冷启动）</h2><div id="gallery" class="grid2"></div>
<h2 id="s-train">训练过程</h2><div id="training" class="grid2"></div>
<h2 id="s-results">实验结果</h2><div id="results" class="grid2"></div>
<h2 id="s-gen">跨功法泛化</h2><div id="gen" class="grid2"></div>
<h2 id="s-perf">安全与性能</h2><div id="perf"></div>
<h2 id="s-limit">局限与真实产品启用条件</h2><div class="card" id="limits"></div>
<p class="muted" id="foot"></p>
</main><div id="tip"></div>
<script>${bundle}</script>
<script>
const D = ${json};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f3 = x => x == null ? '—' : Number(x).toFixed(3);
const L = {goals:{mobility:'肩颈活动',upper_limb:'上肢功能练习',daily:'日常锻炼',rehab_support:'康复辅助意向'},difficulties:{stiffness:'僵硬感',reach_difficulty:'抬手困难',soreness:'酸痛',sedentary:'久坐不适',none:'暂无明显困难'},
 regions:{shoulders:'肩部',neck:'颈部',arms:'上肢',trunk:'躯干',legs:'下肢'},preference:{routine:'功法优先',game:'游戏优先',mixed:'混合'},risk:{none:'无',acute_pain:'急性疼痛',dizziness:'眩晕',recent_injury:'近期损伤'},
 group:{P:'画像×内容',H:'历史×内容',R:'报告×内容'},cond:{A_profile:'仅画像',B_history:'画像+历史',C_history_report:'画像+历史+报告'},prog:{baduanjin:'八段锦',taijiquan:'太极拳',wuqinxi:'五禽戏',yijinjing:'易筋经'}};
const FEAT = {x_region_f1:'部位匹配度',x_region_recall:'所选部位覆盖',x_region_precision:'部位集中度',x_region_overlap:'部位重合数',x_pref_kind_match:'符合内容偏好',x_pref_mixed_game:'混合偏好中的游戏',c_caution_count:'注意标签数量',c_is_game:'游戏',c_form_position:'在功法中的位置',c_deepknee_s:'实测深屈膝',x_m1_region_selected_mean:'M1 实测所选部位活动',c_m1_missing:'无 M1 实测',h_practised_this_log:'练过该内容',h_score_this:'历史得分',h_completion_this:'历史完成率',h_trend_this:'历史趋势',h_recency_this:'最近练过',h_novel:'新内容',h_next_in_programme:'功法内下一节',h_practised_programme_log:'同功法练习量',h_game_played_this_log:'玩过该游戏',h_game_completion_this:'游戏完成率',h_focus_overlap_practised:'与已练方向相同',r_focus_match:'针对报告问题',r_focus_need_weighted:'报告问题严重度加权',r_same_subject:'报告所指内容',r_same_programme:'报告所指功法',r_worse_focus_match:'针对变差的问题'};
const CN = {shoulders:'肩部',neck:'颈部',arms:'上肢',trunk:'躯干',legs:'下肢',overhead:'过顶',balance:'平衡',twist:'转体',bending:'俯身',weight_bearing:'支撑负荷',reach:'幅度',stability:'稳定',coordination:'配合',rhythm:'节奏',general:'日常',region_shoulders:'部位·肩',region_neck:'部位·颈',region_arms:'部位·上肢',region_trunk:'部位·躯干',region_legs:'部位·下肢',caution_overhead:'注意·过顶',caution_balance:'注意·平衡',caution_twist:'注意·转体',caution_bending:'注意·俯身'};
const cn = k => CN[k] || k;
const feat = n => FEAT[n] || (n.startsWith('c_m1_') ? 'M1 实测·' + cn(n.slice(5)) : n.startsWith('c_region_') ? '内容部位·' + cn(n.slice(9)) : n.startsWith('c_focus_') ? '内容方向·' + cn(n.slice(8)) : n.startsWith('c_caution_') ? '注意标签·' + cn(n.slice(10)) : n.startsWith('c_prog_') ? '功法·' + (L.prog[n.slice(7)] || n.slice(7))
  : n.startsWith('x_region_match_') ? '部位匹配·' + cn(n.slice(15)) : /^x_(goal|diff)_(.+)_focus_(.+)$/.test(n) ? n.replace(/^x_(goal|diff)_(.+)_focus_(.+)$/, (m, k, a, b) => (k === 'goal' ? '目标「' + (L.goals[a] || a) : '困难「' + (L.difficulties[a] || a)) + '」×' + cn(b) + '方向')
  : /^x_diff_(.+)_caution_count$/.test(n) ? '困难「' + (L.difficulties[n.slice(7, -14)] || n) + '」×注意标签数' : n);
const byId = new Map(FPLab.COACH_KNOWLEDGE.map(e => [e.id, e]));
const weightsStatus = D.weights ? ((D.preview || D.aiExperiment) && !D.weightsHuman ? {ok:true, weights:D.weights} : FPLab.loadWeights(D.weights)) : {ok:false, reason:'MODEL_NOT_TRAINED'};
const LABEL_SRC = D.aiExperiment ? 'AI 标注（单一 AI 标注者 Claude Opus 5.5，非人工、非专家）' : D.weightsHuman ? '团队标注者（非临床）' : '无';
const svc = FPLab.createCdmService({catalogue:FPLab.COACH_KNOWLEDGE, rules:FPLab.getCoachWebRecommendation, weights:weightsStatus, now:() => Date.UTC(2026,10,8)});
const st = [];
if (D.preview) st.push('<div class="banner"><strong>FIXTURE PREVIEW</strong>：测试 fixture 权重，仅检查版面，<strong>不是训练模型</strong>。</div>');
if (D.aiExperiment) st.push('<div class="banner"><strong>AI 标注弱监督实验</strong>：排序模型由单一 AI 标注者（Claude Opus 5.5，与 PR #49 设计者为同一智能体）对合成场景的分级训练。<strong>不是人工验证，不是专家判断</strong>，不代表真实用户效果；模型未接入正式产品。</div>');
if (!weightsStatus.ok) st.push('<div class="banner">排序模型未加载（' + esc(weightsStatus.reason) + '）：下方只展示规则引擎与 PR #49。</div>');
$('status').innerHTML = st.join('');

// ---------- verification status ----------
const V = [['安全门禁、弃权与回退（E4）', 'ok', '22,320 个画像全量 + 13,392 个风险画像 + 对抗权重；离线代码级验证'], ['推理性能与资源（E5）', 'ok', '开发机 CPU 实测；未在目标比赛设备上复测'],
 ['M1 内容理解（跨功法）', 'ok', '真实参考姿态 + 团队人工标签，嵌套按功法留一；单一示范者、二维；与手工描述符的差异不显著'],
 ['M2 排序质量', 'exp', '标签来自单一 AI 标注者，场景为合成；指标衡量与该 AI 标注者的一致性'], ['M2 优于规则 / PR #49', 'exp', '成对准确率优势明显；NDCG 差异的 CI 跨 0'],
 ['历史 / 报告特征的贡献', 'exp', '效应很小（AI 标签很少随历史/报告变化）'], ['人工或专家一致性', 'pend', '未进行；需要两名真人标注者或专业人员'], ['真实用户推荐质量与康复效果', 'pend', '需要真实使用数据与专业评估；当前不作任何宣称']];
$('verify').innerHTML = '<table><tr><th>结论</th><th>状态</th><th>依据与范围</th></tr>' + V.map(v => '<tr><td>' + v[0] + '</td><td class="' + {ok:'st-ok',exp:'st-exp',pend:'st-pend'}[v[1]] + '">' + {ok:'已验证（离线）',exp:'实验性',pend:'待验证'}[v[1]] + '</td><td>' + v[2] + '</td></tr>').join('') + '</table>';

// ---------- data card ----------
const aiq = D.aiq;
$('datacard').innerHTML = '<table><tr><th>数据</th><th>规模</th><th>性质</th><th>用途</th></tr>'
 + '<tr><td>标准示范参考姿态轨迹（4 套功法）</td><td>26,570 帧 / 1,677 个 3 s 窗口 / 59 章</td><td><span class="ok">真实观测</span>（单一示范者，MediaPipe 二维）</td><td>M1 训练</td></tr>'
 + '<tr><td>目录部位 / 注意标签</td><td>60 章 + 4 游戏</td><td>团队人工标注（非专家）</td><td>M1 标签、M2 内容特征</td></tr>'
 + '<tr><td>合成场景（画像 + 历史 + 报告）</td><td>72 个场景 / 24 族 / 720 个候选</td><td><span class="warnc">合成设计</span>，SHA ' + D.scenarioSha256.slice(0, 12) + '…</td><td>M2 训练与评测</td></tr>'
 + '<tr><td>M2 分级标签</td><td>' + (aiq ? aiq.integrity.received + ' 项；1/2/3 = ' + aiq.gradeDistribution.all.slice(1).join('/') : '—') + '</td><td>' + esc(LABEL_SRC) + '</td><td>M2 训练与评测</td></tr>'
 + '<tr><td>划分</td><td>18 个开发族 / 6 个冻结测试族</td><td>标签产生前固定</td><td>开发集交叉验证 / 单次冻结测试</td></tr>'
 + '<tr><td>未使用</td><td colspan="3">StartLux 权重与标签（任务不符、CC BY-NC）；标为 do-not-train 的数据集；许可受限的公开数据（REHAB24-6、UMONS-TAICHI 等）；画像枚举与 persona 不作训练样本</td></tr></table>';

// ---------- live decision ----------
const PROFILE0 = {version:1, goals:['mobility','daily'], difficulties:['stiffness','sedentary'], regions:['shoulders','neck'], preference:'mixed', risk:'none', acknowledged:true};
function editorHtml(p){ const box = (field, key) => Object.keys(L[field]).map(k => '<label><input type="checkbox" data-f="' + field + '" value="' + k + '"' + (p[field].includes(k) ? ' checked' : '') + '> ' + L[field][k] + '</label>').join(' ');
  const radio = field => Object.keys(L[field]).map(k => '<label><input type="radio" name="' + field + '" value="' + k + '"' + (p[field] === k ? ' checked' : '') + '> ' + L[field][k] + '</label>').join(' ');
  return '<fieldset><legend>目标</legend>' + box('goals') + '</fieldset><fieldset><legend>困难</legend>' + box('difficulties') + '</fieldset><fieldset><legend>关注部位</legend>' + box('regions') + '</fieldset>'
   + '<fieldset><legend>偏好</legend>' + radio('preference') + '</fieldset><fieldset><legend>风险</legend>' + radio('risk') + '</fieldset>'
   + '<fieldset><legend>宿主可用性（模拟不可启动的内容）</legend>' + ['taijiquan','yijinjing','racing','apple'].map(k => '<label><input type="checkbox" data-u="' + k + '"> ' + (L.prog[k] || byId.get(k).title) + ' 不可用</label>').join(' ') + '</fieldset>' }
function readEditor(){ const pick = f => [...document.querySelectorAll('input[data-f="' + f + '"]:checked')].map(i => i.value); const r = n => (document.querySelector('input[name="' + n + '"]:checked') || {}).value;
  return {profile:{version:1, goals:pick('goals'), difficulties:pick('difficulties'), regions:pick('regions'), preference:r('preference'), risk:r('risk'), acknowledged:true}, unavailable:[...document.querySelectorAll('input[data-u]:checked')].map(i => i.dataset.u)} }
$('src').innerHTML += D.scenarios.map(s => '<option value="' + s.id + '">' + s.id + ' · ' + L.cond[s.condition] + (s.split === 'test' ? ' · 冻结测试族' : '') + '</option>').join('');
$('editor').innerHTML = editorHtml(PROFILE0);
function decide(profile, history, report, unavailable){
  const req = {schemaVersion:1, source:'rules', profile};
  const availability = unavailable.length ? {snapshotRef:'lab', unavailableIds:unavailable} : undefined;
  const evidence = FPLab.scenarioEvidence(history, report);
  const p0 = FPLab.recommendCoach(profile, {evidence, limitations:[], decisionStatus:'synthetic'});
  const pr = history || report ? (profile.risk === 'none' ? FPLab.rankCoachDecision({profile, evidence, availability:availability || null, catalogue:FPLab.COACH_KNOWLEDGE}).result : null)
    : FPLab.getCoachDecisionRecommendation(req, {mode:'active', availability}).active.result;
  let state; try { state = FPLab.stateFromScenario(profile, history, report) } catch (e) { state = undefined }
  const cdm = svc(req, {mode:'active', state, availability});
  return {p0, pr, cdm} }
function slateList(result, color, label, emptyText){
  const head = '<span class="sw" style="background:' + color + '"></span><strong>' + label + '</strong>';
  if (!result || result.status !== 'ready') return '<div>' + head + '<p class="muted">' + esc(emptyText || (result ? result.message : '无')) + '</p></div>';
  return '<div>' + head + '<ol>' + [...result.chapters, ...result.games].map(i => '<li>' + esc(i.entry.title) + '</li>').join('') + '</ol></div>' }
function signedBars(parts){ const max = Math.max(0.01, ...parts.map(p => Math.abs(p.points)));
  return '<div class="scroll"><table>' + parts.map(p => { const w = Math.round(100 * Math.abs(p.points) / max);
    return '<tr><td>' + esc(feat(p.feature)) + ' <span class="muted">' + L.group[p.group] + '</span></td><td style="width:40%;min-width:120px"><div style="display:flex;align-items:center"><div style="width:50%;display:flex;justify-content:flex-end">' + (p.points < 0 ? '<div style="height:12px;border-radius:4px 0 0 4px;background:var(--neg);width:' + w + '%"></div>' : '') + '</div><div style="width:1px;height:16px;background:var(--fg2)"></div><div style="width:50%">' + (p.points > 0 ? '<div style="height:12px;border-radius:0 4px 4px 0;background:var(--s3);width:' + w + '%"></div>' : '') + '</div></div></td><td class="num">' + (p.points >= 0 ? '+' : '') + p.points.toFixed(2) + '</td></tr>' }).join('') + '</table></div>' }
function run(){
  const v = $('src').value; let profile, history = null, report = null, unavailable = [];
  if (v === 'custom') { const e = readEditor(); profile = e.profile; unavailable = e.unavailable } else { const s = D.scenarios.find(x => x.id === v); profile = s.profile; history = s.history; report = s.report }
  $('editor').style.display = v === 'custom' ? '' : 'none';
  const {p0, pr, cdm} = decide(profile, history, report, unavailable);
  const hist = history ? history.routines.map(r => esc(byId.get(r.chapterId).title) + '：' + r.sessions + ' 次，均分 ' + r.meanScore + '（' + r.trend + '），' + r.lastDaysAgo + ' 天前').join('<br>') + (history.games.length ? '<br>' + history.games.map(g => esc(byId.get(g.gameId).title) + '：' + g.plays + ' 局').join('<br>') : '') : '<span class="muted">无（missing）</span>';
  const rep = report ? report.findings.map(f => esc(f.label) + '，' + f.score + '/100（' + f.trend + '）').join('<br>') : '<span class="muted">无（missing）</span>';
  $('state').innerHTML = '<div class="card"><h3>画像（自述）</h3>目标：' + profile.goals.map(g => L.goals[g]).join('、') + '<br>困难：' + profile.difficulties.map(d => L.difficulties[d]).join('、') + '<br>部位：' + profile.regions.map(r => L.regions[r]).join('、') + '<br>偏好：' + (L.preference[profile.preference] || '—') + '<br>风险：' + (L.risk[profile.risk] || '—') + '</div>'
    + '<div class="card"><h3>训练历史 <span class="tag">' + (history ? 'synthetic_scenario' : 'missing') + '</span></h3>' + hist + '</div><div class="card"><h3>最近报告 <span class="tag">' + (report ? 'synthetic_scenario' : 'missing') + '</span></h3>' + rep + '</div>';
  let h = '<div class="card"><div class="row"><strong>门禁与模型</strong><span class="tag">decisionOrigin ' + cdm.decisionOrigin + '</span><span class="tag">fallback ' + (cdm.fallbackReason || 'none') + '</span><span class="tag">guard ' + (cdm.guard.checked ? (cdm.guard.violations.length ? '违规' : '通过') : '未运行') + '</span>'
    + (cdm.model ? '<span class="tag">top-1 置信度 ' + (cdm.model.confidence * 100).toFixed(0) + '%</span>' + (cdm.model.abstainReason ? '<span class="tag warnc">弃权 ' + cdm.model.abstainReason + '</span>' : '') : '') + '</div>'
    + (cdm.fallbackReason === 'SAFETY_HOLD' ? '<p class="warnc">风险画像：在模型之前由安全门禁直接暂停推荐，模型不会被调用。</p>' : '') + (unavailable.length ? '<p class="muted">宿主标记不可用：' + unavailable.map(k => L.prog[k] || byId.get(k).title).join('、') + '。模型候选已移除；规则引擎不接收该输入。</p>' : '') + '</div>';
  if (cdm.model && cdm.model.candidates.length) {
    const top = cdm.model.candidates[0];
    h += '<div class="card"><h3>为什么首选「' + esc(top.title) + '」（适配概率 ' + (top.suitability * 100).toFixed(0) + '%）</h3><p class="muted">分数 = 各特征标准化值 × 学到的权重之和；绿色为加分，灰色为减分。</p>' + signedBars(top.contributions) + '</div>';
    const p0ids = p0.status === 'ready' ? [...p0.chapters, ...p0.games].map(i => i.entry.id) : [], prids = pr ? [...pr.chapters, ...pr.games].map(i => i.entry.id) : [];
    h += '<div class="card scroll"><details><summary>第一阶段检索的 ' + cdm.model.candidates.length + ' 个候选（安全池共 ' + cdm.model.retrieval.safePool + ' 项）及模型分数，降序</summary><table><tr><th>#</th><th>候选</th><th class="num">适配分</th><th class="num">适配概率</th><th>主要依据</th><th>规则</th><th>PR #49</th></tr>'
      + cdm.model.candidates.map((c, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(c.title) + '<br><span class="muted">' + (c.kind === 'game' ? '游戏 · 独立应用' : '章节') + '</span></td><td class="num">' + c.score.toFixed(2) + '</td><td class="num">' + (c.suitability * 100).toFixed(0) + '%</td><td>'
        + c.contributions.slice(0, 3).map(p => '<span class="tag">' + esc(feat(p.feature)) + ' ' + (p.points >= 0 ? '+' : '') + p.points.toFixed(2) + '</span>').join('') + '</td><td>' + (p0ids.includes(c.id) ? '✓' : '') + '</td><td>' + (prids.includes(c.id) ? '✓' : '') + '</td></tr>').join('') + '</table></details></div>';
  }
  h += '<div class="card"><h3>最终推荐对照</h3><div class="grid3">' + slateList(p0, 'var(--s1)', '规则引擎 P0') + slateList(pr, 'var(--s2)', 'PR #49 手工权重', profile.risk !== 'none' ? '风险画像：暂停推荐' : undefined)
    + slateList(cdm.decisionOrigin === 'model' ? cdm.active.result : null, 'var(--s3)', '训练模型 fp-cdm', abstainText(cdm)) + '</div></div>';
  $('decision').innerHTML = h;
}
$('run').onclick = run; $('src').onchange = run; $('editor').addEventListener('change', run); run();

function abstainText(cdm){
  if (cdm.model && cdm.model.abstainReason === 'OUT_OF_DISTRIBUTION') return '模型弃权：输入超出训练分布（' + (cdm.model.oodFeatures || []).map(feat).join('、') + '），回退规则结果。';
  if (cdm.model && cdm.model.abstainReason === 'LOW_SUITABILITY') return '模型弃权：没有候选达到适配阈值，回退规则结果。';
  return '未给出推荐（' + (cdm.fallbackReason || '') + '），回退规则结果。' }
// ---------- persona gallery ----------
const PERSONAS = [
 ['久坐上班族：肩颈僵硬', {goals:['mobility','daily'], difficulties:['stiffness','sedentary'], regions:['shoulders','neck'], preference:'mixed'}],
 ['抬手困难，康复辅助意向', {goals:['rehab_support','upper_limb'], difficulties:['reach_difficulty'], regions:['shoulders','arms'], preference:'routine'}],
 ['喜欢游戏的下肢与躯干锻炼', {goals:['daily','mobility'], difficulties:['none'], regions:['legs','trunk'], preference:'game'}],
 ['上肢酸痛，想练上肢功能', {goals:['upper_limb'], difficulties:['soreness'], regions:['arms'], preference:'game'}],
 ['全身日常锻炼', {goals:['mobility','daily'], difficulties:['none'], regions:['shoulders','neck','arms','trunk','legs'], preference:'routine'}],
 ['颈部僵硬', {goals:['mobility'], difficulties:['stiffness'], regions:['neck'], preference:'routine'}]];
$('gallery').innerHTML = PERSONAS.map(([name, p]) => { const profile = Object.assign({version:1, risk:'none', acknowledged:true}, p); const {p0, pr, cdm} = decide(profile, null, null, []);
  const top = cdm.model && cdm.model.candidates[0];
  return '<div class="card"><h3>' + esc(name) + '</h3><p class="muted">' + profile.goals.map(g => L.goals[g]).join('、') + ' · ' + profile.difficulties.map(d => L.difficulties[d]).join('、') + ' · ' + profile.regions.map(r => L.regions[r]).join('、') + ' · ' + L.preference[profile.preference] + '</p><div class="grid3">'
   + slateList(p0, 'var(--s1)', '规则') + slateList(pr, 'var(--s2)', 'PR #49') + slateList(cdm.decisionOrigin === 'model' ? cdm.active.result : null, 'var(--s3)', 'fp-cdm', abstainText(cdm)) + '</div>'
   + (top ? '<p class="muted">fp-cdm 首选理由：' + top.contributions.slice(0, 3).map(c => esc(feat(c.feature)) + (c.points >= 0 ? ' +' : ' ') + c.points.toFixed(2)).join('；') + (cdm.model.coverage ? '' : '') + '</p>' : '') + '</div>' }).join('');

// ---------- charts ----------
const tip = $('tip');
function hover(el, text){ el.addEventListener('mousemove', e => { tip.style.display = 'block'; tip.textContent = text; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px' }); el.addEventListener('mouseleave', () => tip.style.display = 'none') }
function hbars(rows, max, opts){
  const W = 520, rowH = 28, left = 170, right = 62, H = rows.length * rowH + 26, min = opts.min || 0, scale = v => left + (W - left - right) * (Math.max(min, v) - min) / (max - min);
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', opts.title);
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; svg.appendChild(n); return n };
  for (let i = 0; i <= 4; i++) { const t = min + (max - min) * i / 4; add('line', {x1:scale(t), x2:scale(t), y1:4, y2:H - 20, stroke:'var(--grid)', 'stroke-width':1}); add('text', {x:scale(t), y:H - 6, 'text-anchor':'middle', 'font-size':11, fill:'var(--muted)'}, t.toFixed(2)) }
  rows.forEach((r, i) => { const y = 8 + i * rowH;
    add('text', {x:left - 8, y:y + 13, 'text-anchor':'end', 'font-size':12, fill:'var(--fg2)'}, r.label);
    const bar = add('rect', {x:left, y:y + 4, width:Math.max(1, scale(r.value) - left), height:12, rx:4, fill:r.color});
    if (r.ci) { const a = scale(r.ci[0]), b = scale(r.ci[1]); add('line', {x1:a, x2:b, y1:y + 10, y2:y + 10, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:a, x2:a, y1:y + 5, y2:y + 15, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:b, x2:b, y1:y + 5, y2:y + 15, stroke:'var(--fg)', 'stroke-width':2}) }
    add('text', {x:Math.max(scale(r.value), r.ci ? scale(r.ci[1]) : 0) + 6, y:y + 14, 'font-size':12, fill:'var(--fg)'}, r.value.toFixed(3));
    hover(bar, r.label + '：' + r.value.toFixed(3) + (r.ci ? '（95% CI ' + r.ci[0].toFixed(3) + '–' + r.ci[1].toFixed(3) + '）' : '')) });
  const card = document.createElement('div'); card.className = 'card'; card.innerHTML = '<h3>' + esc(opts.title) + '</h3>' + (opts.note ? '<p class="muted">' + esc(opts.note) + '</p>' : '');
  card.appendChild(svg); if (opts.legend) { const lg = document.createElement('p'); lg.className = 'muted'; lg.innerHTML = opts.legend; card.appendChild(lg) }
  const det = document.createElement('details'); det.innerHTML = '<summary>表格视图</summary><table><tr><th>项目</th><th class="num">数值</th><th class="num">95% CI</th></tr>' + rows.map(r => '<tr><td>' + esc(r.label) + '</td><td class="num">' + r.value.toFixed(4) + '</td><td class="num">' + (r.ci ? r.ci.map(x => x.toFixed(4)).join(' – ') : '—') + '</td></tr>').join('') + '</table>';
  card.appendChild(det); return card }
const LEG = '<span class="sw" style="background:var(--s1)"></span>规则 P0　<span class="sw" style="background:var(--s2)"></span>PR #49 / 手工描述符　<span class="sw" style="background:var(--s3)"></span>训练模型';
const tr = $('training'), rs = $('results'), gn = $('gen');
if (D.m2) {
  const sel = D.m2.devSelection.C_profile_history_report || [];
  const c = document.createElement('div'); c.className = 'card scroll';
  c.innerHTML = '<h3>模型选择：开发集 6 折分组交叉验证（' + D.m2.splits.devFamilies + ' 个族）</h3><p class="muted">只用开发族选择；冻结测试族不参与。可部署要求为线性模型（HGB 仅作离线对照）。选中：' + esc(D.m2.devSelection.C_profile_history_report_chosen.family + ' / ' + D.m2.devSelection.C_profile_history_report_chosen.hp) + '</p><table><tr><th>模型族</th><th>超参数</th><th class="num">NDCG@5</th><th class="num">成对准确率</th></tr>'
   + sel.map(r => '<tr><td>' + r.family + '</td><td>' + r.hp + '</td><td class="num">' + f3(r['ndcg@5']) + '</td><td class="num">' + f3(r.pairwise_acc) + '</td></tr>').join('') + '</table><p class="muted">校准：成对温度 T=' + f3(D.m2.calibration.pairTemperature) + '；Platt a=' + f3(D.m2.calibration.platt.a) + ', b=' + f3(D.m2.calibration.platt.b) + '；弃权阈值 τ=' + f3(D.m2.calibration.abstainSuitabilityBelow) + '。</p>';
  tr.appendChild(c);
}
if (D.research) {
  const R = D.research;
  tr.appendChild(hbars(Object.entries(R.learningCurveNdcg5).map(([k, v]) => ({label:k.replace('_train_families', ' 个训练族'), value:v, color:'var(--s3)'})), 1, {min:0.6, title:'学习曲线：训练族数量 → 开发集 NDCG@5', note:'更多带标签的场景仍有提升空间'}));
  const cal = document.createElement('div'); cal.className = 'card scroll';
  cal.innerHTML = '<h3>适配概率校准（开发集交叉拟合）</h3><p class="muted">ECE ' + f3(R.calibration.ece10) + '，Brier ' + f3(R.calibration.brier) + '，基础“适合”比例 ' + f3(R.calibration.baseRate) + '</p><table><tr><th>预测区间</th><th class="num">样本</th><th class="num">平均预测</th><th class="num">实际适合比例</th></tr>' + R.calibration.reliability.map(b => '<tr><td>' + b.bin + '</td><td class="num">' + b.n + '</td><td class="num">' + f3(b.meanPredicted) + '</td><td class="num">' + f3(b.observedSuitable) + '</td></tr>').join('') + '</table>';
  tr.appendChild(cal);
  const ab = R.ablation, A = (k, l, color) => ({label:l, value:ab[k]['ndcg@5'], ci:ab[k]['ndcg@5_ci95'], color});
  rs.appendChild(hbars([A('rules_p0', '规则 P0', 'var(--s1)'), A('pr49_manual_ranker', 'PR #49 手工权重', 'var(--s2)'), A('tiny_3feat', '学习：3 个基础特征', 'var(--s3)'), A('P_no_m1', '学习：画像×内容（无 M1）', 'var(--s3)'), A('P', '学习：画像×内容 + M1', 'var(--s3)'), A('PH', '+ 历史', 'var(--s3)'), A('PHR', '+ 历史 + 报告', 'var(--s3)'), A('PHR_no_m1', '全部但去掉 M1', 'var(--s3)')], 1, {min:0.6, title:'消融：特征组的作用（开发集 NDCG@5，族级 95% CI）', note:'标签 = ' + LABEL_SRC + '；M1 内容特征约 +0.015；历史/报告贡献很小', legend:LEG}));
  rs.appendChild(hbars(Object.entries(R.labelNoiseRobustness).map(([k, v]) => ({label:'训练标签 ' + k.replace('pct', '%') + ' 扰动 ±1', value:v.meanNdcg5, color:'var(--s3)'})).concat([{label:'无扰动', value:ab.PHR['ndcg@5'], color:'var(--s3)'}]), 1, {min:0.6, title:'鲁棒性：训练标签噪声', note:'在干净标签上评估；5 次重复的平均值'}));
}
if (D.m2 && (D.m2.resultKind === 'MODEL_EVALUATION' || (D.aiExperiment && D.m2.resultKind.startsWith('AI_LABEL')))) {
  const t = D.m2.test, ci = D.m2.bootstrap95;
  const SYS = [['rules_p0', '规则引擎 P0', 'var(--s1)', ci['rules_p0_ndcg@5']], ['pr49_manual_ranker', 'PR #49 手工权重', 'var(--s2)', ci['pr49_ndcg@5']], ['C_profile_history_report', '训练模型 fp-cdm', 'var(--s3)', ci['model_C_ndcg@5']]];
  rs.prepend(hbars(SYS.map(([k, l, c]) => ({label:l, value:t[k].all['pairwise_acc'], color:c})), 1, {min:0.4, title:'冻结测试：成对排序准确率', legend:LEG}));
  rs.prepend(hbars(SYS.map(([k, l, c, cc]) => ({label:l, value:t[k].all['ndcg@5'], color:c, ci:cc})), 1, {min:0.4, title:'冻结测试 NDCG@5（6 个族 / 18 个场景，单次评测）', note:'标签 = ' + LABEL_SRC + '；模型 − P0 差值 CI [' + ci['model_minus_p0_ndcg@5'].map(f3).join(', ') + ']，跨 0', legend:LEG}));
  if (D.m2.errorAnalysisTop1 && D.m2.errorAnalysisTop1.length) { const e = document.createElement('div'); e.className = 'card scroll';
    e.innerHTML = '<h3>误差案例：测试集中 top-1 不是最高分</h3><table><tr><th>场景</th><th>模型 top-1（分）</th><th>最高分候选（分）</th><th>规则 top-1（分）</th></tr>' + D.m2.errorAnalysisTop1.map(x => '<tr><td>' + x.scenarioId + '</td><td>' + esc(byId.get(x.modelTop1).title) + '（' + x.top1Label + '）</td><td>' + x.bestCandidates.map(id => esc(byId.get(id).title)).join('、') + '（' + x.bestLabel + '）</td><td>' + esc(byId.get(x.p0Top1).title) + '（' + x.p0Top1Label + '）</td></tr>').join('') + '</table>'; rs.appendChild(e) }
}
if (D.m1v11) {
  const r = D.m1v11.results, P = ['baduanjin','taijiquan','wuqinxi','yijinjing'];
  const rows = []; for (const p of P) { rows.push({label:L.prog[p] + ' · M1 v1.1', value:r.m1_v11_nested.perHeldOutProgrammeMacro[p], color:'var(--s3)'}); rows.push({label:L.prog[p] + ' · 手工描述符', value:r.pr49_descriptors_baseline.perHeldOutProgrammeMacro[p], color:'var(--s2)'}) }
  gn.appendChild(hbars(rows, 1, {min:0.3, title:'M1 跨功法泛化：留出整套功法的宏平均 AUC', note:'嵌套按功法留一（模型与特征只在其余 3 套功法上选择）；总体 ' + f3(r.m1_v11_nested.macroAucLearnable) + ' vs 描述符 ' + f3(r.pr49_descriptors_baseline.macroAucLearnable) + '，差值 CI [' + D.m1v11.results.nested_minus_baseline_macro_ci95.map(f3).join(', ') + ']'}));
  const lab = k => ({'region:shoulders':'部位·肩','region:neck':'部位·颈','region:arms':'部位·上肢','region:trunk':'部位·躯干','region:legs':'部位·下肢','caution:overhead':'注意·过顶','caution:balance':'注意·平衡','caution:twist':'注意·转体','caution:bending':'注意·俯身'})[k] || k;
  const lr = []; for (const [k, v] of Object.entries(r.m1_v11_nested.perLabel)) { if (!v.learnable) continue; lr.push({label:lab(k) + ' · M1', value:v.auc, color:'var(--s3)'}); lr.push({label:lab(k) + ' · 描述符', value:r.pr49_descriptors_baseline.perLabel[k].auc, color:'var(--s2)'}) }
  gn.appendChild(hbars(lr, 1, {min:0.3, title:'M1 各标签 AUC（嵌套 LOPO）', note:'v2 新增姿态特征未带来提升（负结果，未采用）；weight_bearing 只有 1 个正例章节，不可学习'}));
}
if (D.research && D.research.crossProgrammeRanker) {
  const X = D.research.crossProgrammeRanker; const rows = [];
  for (const [p, v] of Object.entries(X)) { rows.push({label:L.prog[p] + ' · 规则', value:v.rules_p0_ndcg5, color:'var(--s1)'}); rows.push({label:L.prog[p] + ' · PR #49', value:v.pr49_ndcg5, color:'var(--s2)'}); rows.push({label:L.prog[p] + ' · 模型', value:v.model_ndcg5, color:'var(--s3)'}) }
  gn.appendChild(hbars(rows, 1, {min:0.6, title:'M2 跨功法泛化：训练时去掉某套功法，再为该功法内容排序', note:'开发集；标签 = ' + LABEL_SRC, legend:LEG}));
}
if (D.e245 && D.e245.e2 && D.e245.e2.distinctSlates) {
  const e2 = D.e245.e2, S3 = [['rules_p0', '规则 P0', 'var(--s1)'], ['pr49', 'PR #49', 'var(--s2)'], ['cdm', 'fp-cdm', 'var(--s3)']];
  rs.appendChild(hbars(S3.map(([k, l, c]) => ({label:l, value:e2.normalisedEntropy[k], color:c})), 1, {title:'个性化：推荐组合区分度（归一化熵，22,320 个冷启动画像）', note:'不同推荐组合数：规则 ' + e2.distinctSlates.rules_p0 + '，PR #49 ' + e2.distinctSlates.pr49 + '，fp-cdm ' + e2.distinctSlates.cdm + '；fp-cdm 在 ' + e2.cdmAbstainedOrFellBack + ' 个画像上弃权并回退规则', legend:LEG}));
  rs.appendChild(hbars(S3.map(([k, l, c]) => ({label:l, value:e2.meanRegionCoverage[k], color:c})), 1, {min:0.5, title:'个性化：所选部位平均覆盖率', note:'同一画像空间；画像为枚举的自述组合，不代表真实用户分布', legend:LEG}));
}
if (D.e245) {
  const e4 = D.e245.e4, e5 = D.e245.e5;
  $('perf').innerHTML = '<div class="card"><div class="grid3">'
   + '<div class="tile">风险画像暂停<b>' + e4.riskProfiles.held + '/' + e4.riskProfiles.checked + '</b><span class="muted">模型执行 ' + e4.riskProfiles.modelExecutions + ' 次</span></div>'
   + '<div class="tile">受限画像风险条目<b>' + e4.profileSpace.limitedCautionItems + '</b><span class="muted">对抗权重下 ' + e4.adversarialCautionLovingWeights.cautionItemsShown + '</span></div>'
   + '<div class="tile">不可用内容被推荐<b>' + e4.unavailableContentShownByModel + '</b><span class="muted">宿主可用性快照</span></div>'
   + '<div class="tile">单次推理 p50 / p95<b>' + e5.singleRequestMs.p50.toFixed(2) + ' / ' + e5.singleRequestMs.p95.toFixed(2) + ' ms</b><span class="muted">CPU 单线程，无 GPU</span></div>'
   + (D.cold ? '<div class="tile">冷启动（导入 + 首次调用）<b>' + D.cold.median.importMs.toFixed(1) + ' + ' + D.cold.median.firstCallMs.toFixed(1) + ' ms</b><span class="muted">堆 ' + D.cold.median.heapMB.toFixed(1) + ' MB</span></div>' : '')
   + '<div class="tile">模型参数 / 包体<b>' + e5.parameters + ' / ' + (e5.bundle.cdmIndexIncludingP0AndPr49.minifiedBytes / 1024).toFixed(0) + ' KB</b><span class="muted">gzip ' + (e5.bundle.cdmIndexIncludingP0AndPr49.gzipBytes / 1024).toFixed(0) + ' KB（含规则代码）</span></div></div>'
   + '<p class="muted">何时弃权：最高适配概率低于 τ，或输入超出训练分布（>3 个特征偏离 8σ）时，模型返回 ABSTAIN，页面回退规则结果；风险画像在模型之前即被安全门禁暂停。当前 AI 标签几乎没有“不适合”，因此低适配弃权很少触发。</p></div>';
}
$('limits').innerHTML = '<ul><li>标签：' + esc(LABEL_SRC) + '。场景为合成设计；结论只说明模型与该标签来源的一致性，不说明真实用户推荐质量或康复效果。</li><li>冻结测试只有 6 个族；请看置信区间，NDCG 优势不显著。</li><li>M1 来自单一示范者的二维姿态；太极拳是最难泛化的功法。</li><li>安全筛选在模型前后独立执行，模型分数不能解除任何限制。不做诊断、不承诺疗效、不提供剂量。</li></ul>'
 + '<h3>真实产品启用条件（需负责人确认）</h3><ol><li>由人工（至少两名团队成员，理想为专业人员）完成冻结测试族的标注，并在人工标签上复现对照结论。</li><li>用人工标签训练正式权重（loadWeights 只接受 human），去掉 AI 实验水印。</li><li>Web 负责人接线 shadow 模式并核对来源文案；active 模式需负责人批准。</li><li>在目标比赛设备上复测性能。</li><li>合并到 main、启用 active、修改安全门禁均需负责人决定。</li></ol>';
$('foot').textContent = '生成 ' + D.generatedAt + ' · 场景 SHA ' + D.scenarioSha256.slice(0, 12) + '… · 合成场景，不是真实用户';
</script></body></html>
`
writeFileSync(out, html)
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(html), bundleBytes: bundle.length, preview, aiExperiment, weightsHuman, inputs: Object.fromEntries(Object.entries(data).filter(([k]) => ['m2', 'research', 'm1', 'm1v11', 'aiq', 'e245', 'cold'].includes(k)).map(([k, v]) => [k, !!v])) }))

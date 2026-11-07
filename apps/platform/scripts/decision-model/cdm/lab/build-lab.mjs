// Coach Decision Model Lab generator: one self-contained offline HTML page for the competition demo.
// The real fp-cdm modules are bundled into the page, so every decision shown is computed live in the browser.
//
//   node scripts/decision-model/cdm/lab/build-lab.mjs --out <file.html> --weights <fp-cdm-m2.weights.json>
//        [--m2-report <fp-cdm-m2.report.json>] [--m1-metrics <fp-cdm-m1.metrics.json>] [--e245 <cdm-e2-e4-e5-*.json>] [--cold <cold-start.json>]
//   --fixture-preview  : allow non-human weights ONLY to check layout; the page is stamped FIXTURE PREVIEW.
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
const weightsHuman = weights?.trainedOn?.labels?.kind === 'human' && weights?.status !== 'AWAITING_LABELS'
if (weights && !weightsHuman && !preview) throw new Error('weights are not human-label trained; refusing (use --fixture-preview only for layout checks)')

const esbuild = await import(pathToFileURL(resolve('node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')).href)
const built = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, 'entry.ts')], bundle: true, minify: true, format: 'iife', globalName: 'FPLab', platform: 'browser', write: false, logLevel: 'silent' })
const bundle = built.outputFiles[0].text
const scenarioText = readFileSync(resolve(import.meta.dirname, '../data/scenarios.v1.json'), 'utf8')
const scenarios = JSON.parse(scenarioText).scenarios.map(s => ({ id: s.id, familyId: s.familyId, condition: s.condition, split: s.split, profile: s.profile, history: s.history, report: s.report, candidates: s.candidates }))
const data = {
  generatedAt: new Date().toISOString(), preview, weightsHuman, weights,
  scenarioSha256: createHash('sha256').update(scenarioText).digest('hex'), scenarios,
  m2: readJson(opt('--m2-report')), m1: readJson(opt('--m1-metrics')), e245: readJson(opt('--e245')), cold: readJson(opt('--cold')),
}
const json = JSON.stringify(data).replace(/</g, '\\u003c')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coach Decision Lab</title>
<style>
:root{--bg:#f6f6f3;--surface:#fcfcfb;--card:#ffffff;--fg:#0b0b0b;--fg2:#52514e;--muted:#7a7974;--line:#dedcd5;--grid:#ecebe6;
 --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--warn:#a2461f;--ok:#1f6f45;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#97968e;--line:#373631;--grid:#2a2a27;
 --s1:#3987e5;--s2:#d95926;--s3:#199e70;--warn:#e08a5f;--ok:#5fc08a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121211;--surface:#1a1a19;--card:#1f1f1d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#97968e;--line:#373631;--grid:#2a2a27;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--warn:#e08a5f;--ok:#5fc08a;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:1120px;margin:0 auto;padding:16px}h1{font-size:22px;margin:6px 0 2px}h2{font-size:17px;margin:22px 0 8px}h3{font-size:15px;margin:12px 0 6px}
.sub{color:var(--fg2);margin:0 0 10px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0}
.banner{border-radius:10px;padding:10px 14px;margin:10px 0;border:1px solid var(--warn);color:var(--warn)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}label{white-space:nowrap}select,button{font:inherit;padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
button.primary{background:var(--s1);border-color:var(--s1);color:#fff;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:5px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--fg2);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:1px;font-size:12px;color:var(--fg2)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:baseline}.muted{color:var(--muted)}.ok{color:var(--ok)}.warnc{color:var(--warn)}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px}.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}#tip{position:fixed;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:13px;display:none;z-index:9}
details summary{cursor:pointer;color:var(--fg2)}
</style></head><body><main>
<h1>Coach Decision Lab</h1>
<p class="sub">FormPilot 专用训练决策模型 fp-cdm：画像、训练历史与报告 → 安全候选 → 模型适配分与置信度 → 推荐；与规则引擎、PR #49 手工权重排序器对照。本页离线运行，所有决策在浏览器内实时计算，不连接正式用户页面。</p>
<div id="status"></div>
<h2>1. 决策过程（实时）</h2>
<div class="card"><div class="row"><label>场景 <select id="scen"></select></label><button class="primary" id="run">运行</button>
<span class="muted">场景中的用户、历史和报告均为合成设计；冻结测试族在名称中标注。</span></div></div>
<div id="state" class="grid3"></div>
<div id="decision"></div>
<h2>2. 实验结果</h2>
<div id="results"></div>
<h2>3. 局限</h2>
<div class="card"><ul>
<li>M2 的标签来自两名<strong>团队标注者</strong>（非临床专家）对合成场景的分级判断，指标衡量的是与团队判断的一致程度，不是专家有效性、真实用户泛化能力或康复效果。</li>
<li>冻结测试只有 6 个场景族（18 个场景），区间较宽；请看 bootstrap 95% CI，不要只看点估计。</li>
<li>M1 来自单一示范者的二维姿态，共 59 章、4 个功法；weight_bearing 不可学习。</li>
<li>安全筛选在模型前后独立执行；模型分数不能解除任何限制。不做诊断、不承诺疗效、不提供剂量。</li></ul></div>
<p class="muted" id="foot"></p>
</main><div id="tip"></div>
<script>${bundle}</script>
<script>
const D = ${json};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const L = {goals:{mobility:'肩颈活动',upper_limb:'上肢功能练习',daily:'日常锻炼',rehab_support:'康复辅助意向'},difficulties:{stiffness:'僵硬感',reach_difficulty:'抬手困难',soreness:'酸痛',sedentary:'久坐不适',none:'暂无明显困难'},
 regions:{shoulders:'肩部',neck:'颈部',arms:'上肢',trunk:'躯干',legs:'下肢'},preference:{routine:'功法优先',game:'游戏优先',mixed:'混合'},group:{P:'画像×内容',H:'历史×内容',R:'报告×内容'},
 cond:{A_profile:'仅画像',B_history:'画像+历史',C_history_report:'画像+历史+报告'}};
const byId = new Map(FPLab.COACH_KNOWLEDGE.map(e => [e.id, e]));
const weightsStatus = D.weights ? (D.preview && !D.weightsHuman ? {ok:true, weights:D.weights} : FPLab.loadWeights(D.weights)) : {ok:false, reason:'MODEL_NOT_TRAINED'};
const svc = FPLab.createCdmService({catalogue:FPLab.COACH_KNOWLEDGE, rules:FPLab.getCoachWebRecommendation, weights:weightsStatus, now:() => Date.UTC(2026,10,8)});
const st = [];
if (D.preview) st.push('<div class="banner"><strong>FIXTURE PREVIEW</strong>：本页用测试 fixture 权重检查版面，<strong>不是训练模型</strong>，不得用于展示或汇报。</div>');
if (!weightsStatus.ok) st.push('<div class="banner">M2 偏好排序模型尚未训练（' + esc(weightsStatus.reason) + '），等待两名团队标注者完成标注。下方只展示规则引擎与 PR #49 的结果，以及模型的安全前置与候选池。</div>');
else if (!D.preview) st.push('<div class="card">模型 <strong>' + esc(D.weights.id + '@' + D.weights.version) + '</strong>（' + esc(D.weights.family) + '，' + D.weights.featureNames.length + ' 个特征），标签文件 SHA256 ' + esc((D.weights.trainedOn.labels.file_sha256 || '').slice(0, 12)) + '…，矩阵 ' + esc(D.weights.trainedOn.matrixSha256.slice(0, 12)) + '…；标注者为团队成员（非临床）。</div>');
$('status').innerHTML = st.join('');
$('scen').innerHTML = D.scenarios.map(s => '<option value="' + s.id + '">' + s.id + ' · ' + L.cond[s.condition] + (s.split === 'test' ? ' · 冻结测试族' : '') + '</option>').join('');

function profileText(p){ return '目标：' + p.goals.map(g => L.goals[g]).join('、') + '<br>困难：' + p.difficulties.map(d => L.difficulties[d]).join('、') + '<br>部位：' + p.regions.map(r => L.regions[r]).join('、') + '<br>偏好：' + L.preference[p.preference] }
function slateList(result, color, label, emptyText){
  if (!result) return '<div><span class="sw" style="background:' + color + '"></span><strong>' + label + '</strong><p class="muted">' + esc(emptyText || '无') + '</p></div>';
  const items = [...result.chapters, ...result.games];
  return '<div><span class="sw" style="background:' + color + '"></span><strong>' + label + '</strong><ol>' + items.map(i => '<li>' + esc(i.entry.title) + '</li>').join('') + '</ol></div>' }
function run(){
  const s = D.scenarios.find(x => x.id === $('scen').value);
  const req = {schemaVersion:1, source:'rules', profile:s.profile};
  const state = FPLab.stateFromScenario(s.profile, s.history, s.report);
  const evidence = FPLab.scenarioEvidence(s.history, s.report);
  const p0 = FPLab.recommendCoach(s.profile, {evidence, limitations:[], decisionStatus:'synthetic'});
  const pr = FPLab.rankCoachDecision({profile:s.profile, evidence, availability:null, catalogue:FPLab.COACH_KNOWLEDGE});
  const cdm = svc(req, {mode:'active', state});
  const hist = s.history ? s.history.routines.map(r => esc(byId.get(r.chapterId).title) + '：' + r.sessions + ' 次，均分 ' + r.meanScore + '（' + r.trend + '），' + r.lastDaysAgo + ' 天前').join('<br>') + (s.history.games.length ? '<br>' + s.history.games.map(g => esc(byId.get(g.gameId).title) + '：' + g.plays + ' 局').join('<br>') : '') : '<span class="muted">无（missing）</span>';
  const rep = s.report ? s.report.findings.map(f => esc(f.label) + '，' + f.score + '/100（' + f.trend + '）').join('<br>') : '<span class="muted">无（missing）</span>';
  $('state').innerHTML = '<div class="card"><h3>画像（自述）</h3>' + profileText(s.profile) + '</div><div class="card"><h3>训练历史 <span class="tag">synthetic_scenario</span></h3>' + hist + '</div><div class="card"><h3>最近报告 <span class="tag">synthetic_scenario</span></h3>' + rep + '</div>';
  let h = '<div class="card"><div class="row"><strong>门禁与模型</strong><span class="tag">mode active</span><span class="tag">decisionOrigin ' + cdm.decisionOrigin + '</span><span class="tag">fallback ' + (cdm.fallbackReason || 'none') + '</span><span class="tag">guard ' + (cdm.guard.checked ? (cdm.guard.violations.length ? '违规' : '通过') : '未运行') + '</span>'
    + (cdm.model ? '<span class="tag">top-1 置信度 ' + (cdm.model.confidence * 100).toFixed(0) + '%</span>' + (cdm.model.abstainReason ? '<span class="tag warnc">弃权 ' + cdm.model.abstainReason + '</span>' : '') : '') + '</div></div>';
  if (cdm.model) {
    const p0ids = [...p0.chapters, ...p0.games].map(i => i.entry.id), prids = pr.priority.map(i => i.id);
    h += '<div class="card scroll"><h3>全部安全候选的模型适配分（' + cdm.model.candidates.length + ' 项，降序）</h3><table><tr><th>#</th><th>候选</th><th class="num">适配分</th><th class="num">适配概率</th><th>主要依据（特征贡献）</th><th>规则</th><th>PR #49</th></tr>'
      + cdm.model.candidates.map((c, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(c.title) + '<br><span class="muted">' + (c.kind === 'game' ? '游戏 · 独立应用' : '章节') + '</span></td><td class="num">' + c.score.toFixed(2) + '</td><td class="num">' + (c.suitability * 100).toFixed(0) + '%</td><td>'
        + c.contributions.slice(0, 3).map(p => '<span class="tag">' + L.group[p.group] + ' ' + esc(p.feature) + ' ' + (p.points >= 0 ? '+' : '') + p.points.toFixed(2) + '</span>').join('') + '</td><td>' + (p0ids.includes(c.id) ? '✓' : '') + '</td><td>' + (prids.includes(c.id) ? '✓' : '') + '</td></tr>').join('') + '</table></div>';
  }
  h += '<div class="card"><h3>最终推荐对照</h3><div class="grid3">' + slateList({chapters:p0.chapters, games:p0.games}, 'var(--s1)', '规则引擎 P0') + slateList(pr.result, 'var(--s2)', 'PR #49 手工权重排序')
    + slateList(cdm.decisionOrigin === 'model' ? cdm.active.result : null, 'var(--s3)', '训练模型 fp-cdm', '未给出推荐（' + (cdm.fallbackReason === 'MODEL_NOT_TRAINED' ? '模型尚未训练' : cdm.fallbackReason === 'MODEL_ABSTAINED' ? '模型弃权：' + cdm.model.abstainReason : cdm.fallbackReason) + '），页面回退规则结果。') + '</div>' + (cdm.comparison.rankingEffect !== 'not_compared' ? '<p class="muted">与规则相比：' + cdm.comparison.rankingEffect + '；新增 ' + cdm.comparison.addedIds.length + '，移除 ' + cdm.comparison.removedIds.length + '。</p>' : '') + '</div>';
  $('decision').innerHTML = h;
}
$('run').onclick = run; run();

// ---------- charts (inline SVG, thin bars, direct value labels, hover tooltip, table views) ----------
const tip = $('tip');
function hover(el, text){ el.addEventListener('mousemove', e => { tip.style.display = 'block'; tip.textContent = text; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px' }); el.addEventListener('mouseleave', () => tip.style.display = 'none') }
function hbars(rows, max, opts){ // rows: [{label, value, color, ci?}]
  const W = 520, rowH = 30, left = 150, right = 60, H = rows.length * rowH + 26, scale = v => left + (W - left - right) * Math.max(0, v) / max;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', opts.title);
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; svg.appendChild(n); return n };
  for (const t of [0, 0.25, 0.5, 0.75, 1].map(x => x * max)) { add('line', {x1:scale(t), x2:scale(t), y1:4, y2:H - 20, stroke:'var(--grid)', 'stroke-width':1}); add('text', {x:scale(t), y:H - 6, 'text-anchor':'middle', 'font-size':11, fill:'var(--muted)'}, t.toFixed(2)) }
  rows.forEach((r, i) => { const y = 8 + i * rowH;
    add('text', {x:left - 8, y:y + 14, 'text-anchor':'end', 'font-size':12, fill:'var(--fg2)'}, r.label);
    const bar = add('rect', {x:left, y:y + 4, width:Math.max(1, scale(r.value) - left), height:14, rx:4, fill:r.color});
    if (r.ci) { add('line', {x1:scale(r.ci[0]), x2:scale(r.ci[1]), y1:y + 11, y2:y + 11, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:scale(r.ci[0]), x2:scale(r.ci[0]), y1:y + 6, y2:y + 16, stroke:'var(--fg)', 'stroke-width':2}); add('line', {x1:scale(r.ci[1]), x2:scale(r.ci[1]), y1:y + 6, y2:y + 16, stroke:'var(--fg)', 'stroke-width':2}) }
    add('text', {x:Math.max(scale(r.value), r.ci ? scale(r.ci[1]) : 0) + 6, y:y + 15, 'font-size':12, fill:'var(--fg)'}, r.value.toFixed(3));
    hover(bar, r.label + '：' + r.value.toFixed(3) + (r.ci ? '（95% CI ' + r.ci[0].toFixed(3) + '–' + r.ci[1].toFixed(3) + '）' : '')) });
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = '<h3>' + esc(opts.title) + '</h3>' + (opts.note ? '<p class="muted">' + esc(opts.note) + '</p>' : '');
  card.appendChild(svg);
  const det = document.createElement('details'); det.innerHTML = '<summary>表格视图</summary><table><tr><th>项目</th><th class="num">数值</th><th class="num">95% CI</th></tr>' + rows.map(r => '<tr><td>' + esc(r.label) + '</td><td class="num">' + r.value.toFixed(4) + '</td><td class="num">' + (r.ci ? r.ci.map(x => x.toFixed(4)).join(' – ') : '—') + '</td></tr>').join('') + '</table>';
  card.appendChild(det); return card }
const res = $('results'); const grid = document.createElement('div'); grid.className = 'grid2'; res.appendChild(grid);
const SYS = [['rules_p0', '规则引擎 P0', 'var(--s1)'], ['pr49_manual_ranker', 'PR #49 手工权重', 'var(--s2)'], ['C_profile_history_report', '训练模型 fp-cdm', 'var(--s3)']];
if (D.m2 && D.m2.resultKind === 'MODEL_EVALUATION') {
  const t = D.m2.test, ci = D.m2.bootstrap95;
  const ciOf = {rules_p0:ci['rules_p0_ndcg@5'], pr49_manual_ranker:ci['pr49_ndcg@5'], C_profile_history_report:ci['model_C_ndcg@5']};
  grid.appendChild(hbars(SYS.map(([k, l, c]) => ({label:l, value:t[k].all['ndcg@5'], color:c, ci:ciOf[k]})), 1, {title:'E1 冻结测试 NDCG@5（家族级 bootstrap 95% CI）', note:D.m2.splits.testScenarios + ' 个测试场景 / ' + D.m2.splits.testFamilies + ' 个族；标签 = 团队标注者'}));
  grid.appendChild(hbars(SYS.map(([k, l, c]) => ({label:l, value:t[k].all['pairwise_acc'], color:c})), 1, {title:'E1 成对排序准确率'}));
  grid.appendChild(hbars(SYS.map(([k, l, c]) => ({label:l, value:t[k].all['p@3'], color:c})), 1, {title:'E1 Precision@3（适合 = 分级 ≥ 2）'}));
  grid.appendChild(hbars([['A_profile', 'A 仅画像'], ['B_profile_history', 'B 画像+历史'], ['C_profile_history_report', 'C 画像+历史+报告']].map(([k, l]) => ({label:l, value:t[k].C_history_report['ndcg@5'], color:'var(--s3)'})), 1, {title:'E3 消融：含历史与报告的场景上的 NDCG@5', note:'同一模型族在不同特征组上训练；只在条件 C 的测试场景上比较'}));
} else {
  const c = document.createElement('div'); c.className = 'card'; c.innerHTML = '<h3>E1 / E3 / E6</h3><p class="muted">需要人工标签训练后生成；尚无结果。本页不展示流水线验证（植入信号 / 随机标签）的数字，因为它们不是模型效果。</p>'; grid.appendChild(c);
}
if (D.m1) {
  const r = D.m1.results, keys = r.hgb.learnableLabels;
  const lab = k => ({'region:shoulders':'部位·肩','region:neck':'部位·颈','region:arms':'部位·上肢','region:trunk':'部位·躯干','region:legs':'部位·下肢','caution:overhead':'注意·过顶','caution:balance':'注意·平衡','caution:twist':'注意·转体','caution:bending':'注意·俯身'})[k] || k;
  const rows = []; for (const k of keys) { rows.push({label:lab(k) + ' · M1', value:r.hgb.perLabel[k].auc, color:'var(--s3)'}); rows.push({label:lab(k) + ' · 描述符', value:r.pr49_descriptors_baseline.perLabel[k].auc, color:'var(--s2)'}) }
  grid.appendChild(hbars(rows, 1, {title:'M1 内容理解：按功法留一 AUC（M1 vs PR #49 预注册描述符）', note:'macro AUC：M1 ' + r.hgb.macroAuc.toFixed(3) + '，描述符 ' + r.pr49_descriptors_baseline.macroAuc.toFixed(3) + '；59 章，4 个留出功法'}));
}
if (D.e245) {
  const e4 = D.e245.e4, e5 = D.e245.e5, c = document.createElement('div'); c.className = 'card';
  c.innerHTML = '<h3>E4 安全 · E5 性能</h3><div class="grid3">'
   + '<div class="tile">风险画像暂停<b>' + e4.riskProfiles.held + '/' + e4.riskProfiles.checked + '</b><span class="muted">模型执行 ' + e4.riskProfiles.modelExecutions + ' 次</span></div>'
   + '<div class="tile">受限画像风险条目<b>' + e4.profileSpace.limitedCautionItems + '</b><span class="muted">对抗权重下 ' + e4.adversarialCautionLovingWeights.cautionItemsShown + '</span></div>'
   + '<div class="tile">单次推理 p50 / p95<b>' + e5.singleRequestMs.p50.toFixed(2) + ' / ' + e5.singleRequestMs.p95.toFixed(2) + ' ms</b><span class="muted">CPU，无 GPU</span></div>'
   + (D.cold ? '<div class="tile">冷启动（导入 + 首次调用）<b>' + D.cold.median.importMs.toFixed(1) + ' + ' + D.cold.median.firstCallMs.toFixed(1) + ' ms</b><span class="muted">堆 ' + D.cold.median.heapMB.toFixed(1) + ' MB</span></div>' : '')
   + '<div class="tile">包体（含规则）<b>' + (e5.bundle.cdmIndexIncludingP0AndPr49.minifiedBytes / 1024).toFixed(0) + ' KB</b><span class="muted">gzip ' + (e5.bundle.cdmIndexIncludingP0AndPr49.gzipBytes / 1024).toFixed(0) + ' KB</span></div></div>';
  res.appendChild(c);
}
if (D.m2 && D.m2.errorAnalysisTop1) {
  const c = document.createElement('div'); c.className = 'card scroll';
  c.innerHTML = '<h3>误差案例（测试集中 top-1 不是最优的场景）</h3><table><tr><th>场景</th><th>模型 top-1（分级）</th><th>最优候选（分级）</th><th>规则 top-1（分级）</th></tr>' + D.m2.errorAnalysisTop1.map(e => '<tr><td>' + e.scenarioId + '</td><td>' + esc(byId.get(e.modelTop1).title) + '（' + e.top1Label + '）</td><td>' + e.bestCandidates.map(id => esc(byId.get(id).title)).join('、') + '（' + e.bestLabel + '）</td><td>' + esc(byId.get(e.p0Top1).title) + '（' + e.p0Top1Label + '）</td></tr>').join('') + '</table>';
  res.appendChild(c);
}
$('foot').textContent = '生成 ' + D.generatedAt + ' · 场景 SHA ' + D.scenarioSha256.slice(0, 12) + '… · 合成场景，不是真实用户';
</script></body></html>
`
writeFileSync(out, html)
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(html), bundleBytes: bundle.length, preview, weightsHuman, hasM2: !!data.m2, hasM1: !!data.m1 }))

/**
 * Generates the offline, single-file annotation tool from scenarios.v1.json.
 *   node <vite-node.mjs> scripts/decision-model/cdm/build-annotation-kit.ts
 * The tool never shows which system proposed a candidate, the split, or any model/rule score.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import type { ScenarioFile } from './scenarioTypes'

const DIR = resolve(import.meta.dirname)
const scenarioText = readFileSync(resolve(DIR, 'data/scenarios.v1.json'), 'utf8')
const file = JSON.parse(scenarioText) as ScenarioFile
const scenarioSha = createHash('sha256').update(scenarioText).digest('hex')
const used = new Set(file.scenarios.flatMap(s => s.candidates))
const PROGRAM: Record<string, string> = { baduanjin: '八段锦', taijiquan: '太极拳', wuqinxi: '五禽戏', yijinjing: '易筋经' }
const content = Object.fromEntries(COACH_KNOWLEDGE.filter(e => used.has(e.id)).map(e => [e.id, {
  title: e.title, kind: e.kind, programme: e.programId ? PROGRAM[e.programId] : null, movement: e.movement,
  regions: e.regions, focuses: e.focuses, caution: e.caution,
}]))
const data = {
  kitId: 'fp-cdm-annotation/v1', scenarioSetId: file.id, scenarioSha256: scenarioSha,
  scenarios: file.scenarios.map(s => ({ id: s.id, profile: s.profile, history: s.history, report: s.report, candidates: s.candidates })),
  content,
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>fp-cdm 标注工具 v1</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5f5f5a;--card:#fff;--line:#d9d8d2;--accent:#1f6f5c;--warn:#a2461f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29b;--card:#20201e;--line:#3a3935;--accent:#58b79c;--warn:#e08a5f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:20px;margin:8px 0}h2{font-size:16px;margin:16px 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
.muted{color:var(--muted)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
table{width:100%;border-collapse:collapse}td,th{border-top:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
.cand{border-top:1px solid var(--line);padding:10px 0}.grades label{margin-right:10px;white-space:nowrap}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.warn{color:var(--warn)}
input[type=text],select,textarea{font:inherit;padding:5px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
textarea{width:100%;min-height:34px}.tag{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 7px;margin:1px;font-size:13px}
</style></head><body><main>
<h1>fp-cdm 训练内容适配度标注 v1</h1>
<p class="muted">请先阅读 GUIDELINES.md。场景中的用户、历史和报告均为合成设计。候选顺序随机，不代表任何系统的推荐。</p>
<div id="app"></div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const L = {goals:{mobility:'肩颈活动',upper_limb:'上肢功能练习',daily:'日常锻炼',rehab_support:'康复辅助意向'},
 difficulties:{stiffness:'僵硬感',reach_difficulty:'抬手困难',soreness:'酸痛',sedentary:'久坐不适',none:'暂无明显困难'},
 regions:{shoulders:'肩部',neck:'颈部',arms:'上肢',trunk:'躯干',legs:'下肢'},preference:{routine:'功法优先',game:'游戏优先',mixed:'混合'},
 focuses:{reach:'动作幅度',stability:'姿势与支撑稳定',coordination:'左右与手脚配合',rhythm:'动作节奏',general:'日常活动'},
 caution:{overhead:'过顶',balance:'平衡',twist:'转体',bending:'明显俯身',weight_bearing:'支撑负荷'},trend:{up:'上升',flat:'持平',down:'下降',worse:'变差',same:'不变',better:'变好'}};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let state = {annotator:null, answers:{}, index:0};
const KEY = id => 'fp-cdm-annotation-v1:' + id;
function save(){ try { localStorage.setItem(KEY(state.annotator.id), JSON.stringify(state)) } catch (e) {} }
function hash(str){ let h=2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 } return h }
function order(id){ const ids = DATA.scenarios.map(s => s.id); let a = hash(id) || 1; const r = () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296 };
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] } return ids }
function done(s){ return s.candidates.every(c => state.answers[s.id + '|' + c] && state.answers[s.id + '|' + c].grade !== undefined) }
function start(){
  const app = document.getElementById('app');
  app.innerHTML = '<div class="card"><h2>标注者登记（匿名）</h2><div class="row"><label>编号 <input id="aid" type="text" placeholder="A1" size="6"></label>'
   + '<label>背景 <select id="role"><option value="clinician">康复医师/治疗师</option><option value="sports_medicine">运动医学/体育教育</option><option value="qigong_instructor">健身气功指导员</option><option value="team_member">团队成员（非临床）</option><option value="other">其他</option></select></label>'
   + '<label>相关年限 <input id="years" type="text" size="4"></label><button class="primary" id="go">开始 / 继续</button></div>'
   + '<p class="muted">同一台电脑按编号分别保存进度。也可以导入之前导出的 JSON 继续。</p><input type="file" id="imp" accept=".json"></div>';
  document.getElementById('go').onclick = () => {
    const id = document.getElementById('aid').value.trim(); if (!/^[A-Za-z0-9_-]{1,12}$/.test(id)) { alert('请输入编号，如 A1'); return }
    let loaded = null; try { loaded = JSON.parse(localStorage.getItem(KEY(id)) || 'null') } catch (e) {}
    state = loaded && loaded.annotator ? loaded : {annotator:{id, role:document.getElementById('role').value, years:document.getElementById('years').value.trim()}, answers:{}, index:0};
    render() };
  document.getElementById('imp').onchange = ev => { const f = ev.target.files[0]; if (!f) return; f.text().then(t => { const j = JSON.parse(t);
    if (j.kitId !== DATA.kitId || j.scenarioSha256 !== DATA.scenarioSha256) { alert('文件与本工具版本不一致'); return }
    state = {annotator:j.annotator, answers:Object.fromEntries(j.labels.map(l => [l.scenarioId + '|' + l.candidateId, {grade:l.grade, safety:l.safetyConcern, note:l.note || ''}])), index:0}; save(); render() }) };
}
function profileHtml(p){ return '<table><tr><th>目标</th><td>' + p.goals.map(g => L.goals[g]).join('、') + '</td></tr><tr><th>困难</th><td>' + p.difficulties.map(d => L.difficulties[d]).join('、')
  + '</td></tr><tr><th>关注部位</th><td>' + p.regions.map(r => L.regions[r]).join('、') + '</td></tr><tr><th>偏好</th><td>' + L.preference[p.preference] + '</td></tr><tr><th>风险</th><td>无</td></tr></table>' }
function historyHtml(h){ if (!h) return '<p class="muted">无训练历史（首次使用）。</p>';
  const rows = h.routines.map(r => '<tr><td>' + esc(DATA.content[r.chapterId] ? DATA.content[r.chapterId].title : r.chapterId) + '</td><td>' + r.sessions + ' 次，完成 ' + r.completedSessions + '</td><td>' + r.lastDaysAgo + ' 天前</td><td>相似度均分 ' + r.meanScore + '（' + L.trend[r.trend] + '）</td></tr>').join('')
   + h.games.map(g => '<tr><td>游戏：' + esc(DATA.content[g.gameId] ? DATA.content[g.gameId].title : g.gameId) + '</td><td>' + g.plays + ' 局，完成 ' + g.completedPlays + '</td><td>' + g.lastDaysAgo + ' 天前</td><td></td></tr>').join('');
  return '<p>近 28 天共 ' + h.sessionsLast28d + ' 次训练/游戏。</p><table>' + rows + '</table>' }
function reportHtml(r){ if (!r) return '<p class="muted">无报告。</p>'; return '<p>' + r.daysAgo + ' 天前的报告：</p><ul>' + r.findings.map(f => '<li>' + esc(f.label) + '，分项 ' + f.score + '/100，较上次' + L.trend[f.trend] + '</li>').join('') + '</ul>' }
function render(){
  const ids = order(state.annotator.id); const total = ids.length; state.index = Math.max(0, Math.min(state.index, total - 1));
  const s = DATA.scenarios.find(x => x.id === ids[state.index]); const finished = DATA.scenarios.filter(done).length;
  const app = document.getElementById('app');
  let h = '<div class="card row"><b>标注者 ' + esc(state.annotator.id) + '</b><span class="muted">已完成 ' + finished + '/' + total + ' 个场景</span><span style="flex:1"></span>'
   + '<button id="prev">上一个</button><span>' + (state.index + 1) + '/' + total + '</span><button id="next">下一个</button><button id="nextTodo">下一个未完成</button><button class="primary" id="exp">导出 JSON</button></div>';
  h += '<div class="card"><h2>用户画像</h2>' + profileHtml(s.profile) + '<h2>训练历史</h2>' + historyHtml(s.history) + '<h2>最近报告</h2>' + reportHtml(s.report) + '</div>';
  h += '<div class="card"><h2>候选内容（' + s.candidates.length + ' 项）</h2>';
  for (const c of s.candidates) { const e = DATA.content[c]; const a = state.answers[s.id + '|' + c] || {};
    h += '<div class="cand"><b>' + esc(e.title) + '</b> <span class="muted">' + (e.kind === 'game' ? '体感游戏（独立应用）' : '功法章节 · ' + esc(e.programme)) + '</span><br>' + esc(e.movement)
      + '<br>部位：' + e.regions.map(r => '<span class="tag">' + L.regions[r] + '</span>').join('') + ' 方向：' + e.focuses.map(f => '<span class="tag">' + L.focuses[f] + '</span>').join('')
      + (e.caution.length ? ' <span class="warn">注意：' + e.caution.map(x => L.caution[x]).join('、') + '</span>' : '')
      + '<div class="grades row">' + [3,2,1,0].map(g => '<label><input type="radio" name="g-' + c + '" value="' + g + '"' + (a.grade === g ? ' checked' : '') + '> ' + g + ' ' + ['不适合','勉强','适合','非常适合'][g] + '</label>').join('')
      + '<label><input type="checkbox" data-s="' + c + '"' + (a.safety ? ' checked' : '') + '> 安全疑虑</label></div><textarea data-n="' + c + '" placeholder="备注（可选）">' + esc(a.note || '') + '</textarea></div>' }
  h += '</div>'; app.innerHTML = h;
  for (const c of s.candidates) {
    for (const el of document.getElementsByName('g-' + c)) el.onchange = () => { const k = s.id + '|' + c; state.answers[k] = Object.assign({}, state.answers[k], {grade:Number(el.value), at:Date.now()}); save(); };
    document.querySelector('[data-s="' + c + '"]').onchange = ev => { const k = s.id + '|' + c; state.answers[k] = Object.assign({}, state.answers[k], {safety:ev.target.checked}); save() };
    document.querySelector('[data-n="' + c + '"]').onchange = ev => { const k = s.id + '|' + c; state.answers[k] = Object.assign({}, state.answers[k], {note:ev.target.value.slice(0, 500)}); save() }; }
  document.getElementById('prev').onclick = () => { state.index--; save(); render(); scrollTo(0, 0) };
  document.getElementById('next').onclick = () => { state.index++; save(); render(); scrollTo(0, 0) };
  document.getElementById('nextTodo').onclick = () => { const k = ids.findIndex(id => !done(DATA.scenarios.find(x => x.id === id))); if (k >= 0) { state.index = k; save(); render(); scrollTo(0, 0) } else alert('全部完成，请导出 JSON') };
  document.getElementById('exp').onclick = () => {
    const labels = []; for (const sc of DATA.scenarios) for (const c of sc.candidates) { const a = state.answers[sc.id + '|' + c]; if (a && a.grade !== undefined) labels.push({scenarioId:sc.id, candidateId:c, grade:a.grade, safetyConcern:!!a.safety, note:a.note || '', at:a.at || null}) }
    const out = {kitId:DATA.kitId, scenarioSetId:DATA.scenarioSetId, scenarioSha256:DATA.scenarioSha256, annotator:state.annotator, exportedAt:new Date().toISOString(), complete:labels.length === DATA.scenarios.reduce((n, x) => n + x.candidates.length, 0), labels};
    const blob = new Blob([JSON.stringify(out, null, 1)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'fp-cdm-labels-v1-' + state.annotator.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) };
}
start();
</script></body></html>
`
writeFileSync(resolve(DIR, 'annotation-kit/fp-cdm-annotation-v1.html'), html)
console.log(JSON.stringify({ html: 'annotation-kit/fp-cdm-annotation-v1.html', bytes: Buffer.byteLength(html), scenarioSha256: scenarioSha, candidates: Object.keys(content).length }))

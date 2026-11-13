import type { BodyRegion, CoachProfile, KnowledgeEntry } from '../../recommendation/types'
import type { FeatureGroup } from './features'

/**
 * Human-readable explanation layer for fp-cdm (zh-CN). Pure text mapping: it never changes a score.
 * featureLabel() names one model feature; reasonSentences() turns the strongest POSITIVE contributions of one
 * candidate into at most three short sentences for the product UI.
 */
const REGION: Record<string, string> = { shoulders: '肩部', neck: '颈部', arms: '上肢', trunk: '躯干', legs: '下肢' }
const FOCUS: Record<string, string> = { reach: '动作幅度', stability: '姿势稳定', coordination: '协调配合', rhythm: '动作节奏', general: '日常活动' }
const CAUTION: Record<string, string> = { overhead: '过顶', balance: '平衡', twist: '转体', bending: '俯身', weight_bearing: '支撑负荷' }
const PROGRAM: Record<string, string> = { baduanjin: '八段锦', taijiquan: '太极拳', wuqinxi: '五禽戏', yijinjing: '易筋经' }
const GOAL: Record<string, string> = { mobility: '肩颈活动', upper_limb: '上肢功能练习', daily: '日常锻炼', rehab_support: '康复辅助意向' }
const DIFF: Record<string, string> = { stiffness: '僵硬感', reach_difficulty: '抬手困难', soreness: '酸痛', sedentary: '久坐不适', none: '暂无明显困难' }

export const GROUP_LABELS: Readonly<Record<FeatureGroup, string>> = Object.freeze({ P: '画像与内容', H: '训练历史', R: '最近报告' })

const FIXED: Record<string, string> = {
  c_is_game: '内容类型为游戏', c_caution_count: '内容注意项数量', c_m1_missing: 'M1 姿态感知不可用', c_deepknee_s: '姿态测量：深屈膝持续时长',
  c_form_position: '章节在套路中的位置', x_region_overlap: '与所选部位重合的数量', x_region_recall: '所选部位被覆盖的比例',
  x_region_precision: '内容部位落在所选部位内的比例', x_region_f1: '与所选部位的整体匹配度', x_m1_region_selected_mean: 'M1 感知的所选部位参与度',
  x_pref_kind_match: '符合功法 / 游戏形式偏好', x_pref_mixed_game: '混合偏好下的游戏',
  h_practised_this_log: '练过该内容的次数', h_completion_this: '该章节完成率', h_score_this: '该章节跟练分', h_trend_this: '该章节分数趋势',
  h_recency_this: '最近练过该章节', h_practised_programme_log: '同功法其他章节练习量', h_next_in_programme: '承接已练的上一章节',
  h_novel: '尚未练过的新内容', h_game_played_this_log: '玩过该游戏的局数', h_game_completion_this: '该游戏完成率', h_focus_overlap_practised: '侧重与已练内容相同',
  r_focus_match: '对应最近报告的关注项', r_focus_need_weighted: '对应报告中分数偏低的项', r_same_subject: '报告所指的同一内容',
  r_same_programme: '报告所指的同一功法', r_worse_focus_match: '对应报告中变差的项',
}

export function featureLabel(name: string): string {
  if (FIXED[name]) return FIXED[name]
  let m: RegExpExecArray | null
  if ((m = /^c_prog_(\w+)$/.exec(name))) return `属于${PROGRAM[m[1]] ?? m[1]}`
  if ((m = /^c_region_(\w+)$/.exec(name))) return `内容涉及${REGION[m[1]] ?? m[1]}`
  if ((m = /^c_focus_(\w+)$/.exec(name))) return `内容侧重${FOCUS[m[1]] ?? m[1]}`
  if ((m = /^c_caution_(\w+)$/.exec(name))) return `内容注意项：${CAUTION[m[1]] ?? m[1]}`
  if ((m = /^c_m1_region_(\w+)$/.exec(name))) return `M1 姿态感知：${REGION[m[1]] ?? m[1]}参与`
  if ((m = /^c_m1_caution_(\w+)$/.exec(name))) return `M1 姿态感知：${CAUTION[m[1]] ?? m[1]}要求`
  if ((m = /^x_region_match_(\w+)$/.exec(name))) return `命中所选部位：${REGION[m[1]] ?? m[1]}`
  if ((m = /^x_goal_(\w+?)_focus_(\w+)$/.exec(name))) return `目标「${GOAL[m[1]] ?? m[1]}」× 内容侧重「${FOCUS[m[2]] ?? m[2]}」`
  if ((m = /^x_diff_(\w+?)_focus_(\w+)$/.exec(name))) return `「${DIFF[m[1]] ?? m[1]}」× 内容侧重「${FOCUS[m[2]] ?? m[2]}」`
  if ((m = /^x_diff_(\w+?)_caution_count$/.exec(name))) return `「${DIFF[m[1]] ?? m[1]}」× 注意项数量`
  return name
}

export interface ExplainedPart { feature: string; group: FeatureGroup; value: number; points: number }

/** Up to three reason sentences from the strongest positive contributions, one per reason family. */
export function reasonSentences(parts: readonly ExplainedPart[], profile: CoachProfile, entry: KnowledgeEntry): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (family: string, text: string) => { if (!seen.has(family) && out.length < 3) { seen.add(family); out.push(text) } }
  const positive = parts.filter(p => p.points > 0.05).sort((a, b) => b.points - a.points)
  for (const p of positive) {
    const f = p.feature
    let m: RegExpExecArray | null
    if (f.startsWith('x_region_') || f === 'x_m1_region_selected_mean') {
      const hit = entry.regions.filter((r: BodyRegion) => profile.regions.includes(r)).map(r => REGION[r])
      if (hit.length) push('region', `覆盖你关注的部位：${hit.join('、')}`)
    } else if ((m = /^x_goal_(\w+?)_focus_(\w+)$/.exec(f))) push('goal', `符合目标「${GOAL[m[1]] ?? m[1]}」：内容侧重${FOCUS[m[2]] ?? m[2]}`)
    else if ((m = /^x_diff_(\w+?)_focus_(\w+)$/.exec(f))) push('difficulty', `考虑到「${DIFF[m[1]] ?? m[1]}」，选择侧重${FOCUS[m[2]] ?? m[2]}的内容`)
    else if (f.startsWith('x_pref_')) push('preference', `符合你偏好的${entry.kind === 'game' ? '游戏' : '功法'}形式`)
    else if (f === 'h_next_in_programme') push('history', '承接你已练过的上一章节')
    else if (f === 'h_novel') push('history', '你还没有练过，可作为新内容')
    else if (f.startsWith('h_game_')) push('history', '你玩过这个游戏，可以继续')
    else if (f.startsWith('h_')) push('history', '与你最近的练习记录相衔接')
    else if (f.startsWith('r_')) push('report', '回应最近报告中的待关注项')
    else if ((m = /^c_m1_region_(\w+)$/.exec(f))) push('m1', `动作感知模型 M1 从示范姿态中识别到${REGION[m[1]] ?? m[1]}参与`)
    else if ((m = /^c_focus_(\w+)$/.exec(f))) push('content', `内容本身侧重${FOCUS[m[1]] ?? m[1]}`)
  }
  return out
}

import { SMART_TRAINING_PATH, START_TRAINING_PATH } from '../../app/routes'
import type { RecentReportSummary } from '../coachContext/types'
import { REQUIREMENTS } from '../workshop/catalog'
import type { RequirementId } from '../workshop/types'
import type { CoachAnswer, CoachPage, CoachPageContext, ReportDigest } from './types'

export type CoachIntentId =
  | 'how-to-do' | 'why-corrected' | 'how-am-i-doing' | 'what-to-watch'
  | 'report-overview' | 'biggest-issue' | 'vs-last' | 'next-focus'
  | 'recent-summary' | 'last-training' | 'what-next'
  | 'workshop-how' | 'workshop-requirements' | 'workshop-test'

interface IntentSpec {
  question: string
  /** Specific words: any one of them is enough to recognise the question. */
  anchors: ReadonlyArray<string>
  /** Generic words (怎么样, 现在 …): they only strengthen a match that already has an anchor. */
  boosters?: ReadonlyArray<string>
}

export const INTENTS: Readonly<Record<CoachIntentId, IntentSpec>> = Object.freeze({
  'how-to-do': { question: '这个动作怎么做？', anchors: ['怎么做', '怎么练', '要领', '怎样做', '如何做', '标准动作', '做法', '动作要求'] },
  'why-corrected': { question: '为什么刚才提示我动作不标准？', anchors: ['为什么', '提示', '纠正', '不标准', '不对', '错了', '哪里错'] },
  'how-am-i-doing': { question: '我现在做得怎么样？', anchors: ['做得', '进度', '几次', '多少次', '练得'], boosters: ['怎么样', '现在'] },
  'what-to-watch': { question: '我应该注意哪里？', anchors: ['注意', '留意', '小心', '关键'], boosters: ['哪里'] },
  'report-overview': { question: '我这次表现怎么样？', anchors: ['表现', '总结', '分数', '评分', '成绩', '结果'], boosters: ['怎么样', '这次'] },
  'biggest-issue': { question: '最大的问题是什么？', anchors: ['问题', '不足', '毛病', '不好', '缺点'], boosters: ['最大'] },
  'vs-last': { question: '和上次相比有进步吗？', anchors: ['进步', '对比', '比较', '退步', '提高', '变化'], boosters: ['上次'] },
  'next-focus': { question: '下次应该重点练什么？', anchors: ['下次', '重点', '接下来', '练什么', '改进', '怎么提高'] },
  'recent-summary': { question: '我最近训练怎么样？', anchors: ['最近', '这周', '本周', '一周', '近期', '坚持'], boosters: ['怎么样'] },
  'last-training': { question: '上次练了什么？', anchors: ['上次', '上一次', '练了什么', '最后一次', '昨天'] },
  'what-next': { question: '今天可以继续练什么？', anchors: ['今天', '继续', '练什么', '推荐', '建议'] },
  'workshop-how': { question: '怎么教 FormPilot 一个新动作？', anchors: ['创建', '新动作', '教', '添加', '做一个', '自定义'], boosters: ['怎么'] },
  'workshop-requirements': { question: '识别重点是什么意思？', anchors: ['识别重点', '要求', '阈值', '什么意思', '重点'] },
  'workshop-test': { question: '测试没通过怎么办？', anchors: ['测试', '没通过', '不准', '识别不到', '失败', '不计'] },
})

const PAGE_INTENTS: Readonly<Record<CoachPage, ReadonlyArray<CoachIntentId>>> = Object.freeze({
  training: ['how-to-do', 'why-corrected', 'how-am-i-doing', 'what-to-watch'],
  report: ['report-overview', 'biggest-issue', 'vs-last', 'next-focus'],
  home: ['recent-summary', 'last-training', 'what-next'],
  history: ['recent-summary', 'last-training', 'what-next'],
  workshop: ['workshop-how', 'workshop-requirements', 'workshop-test'],
})

export function suggestedIntents(context: CoachPageContext): ReadonlyArray<CoachIntentId> {
  return PAGE_INTENTS[context.page]
}

const TWO_D_NOTE = '这些判断只来自摄像头二维画面中的关节位置，仅供训练参考。'
const SAFETY_WORDS = ['疼', '痛', '受伤', '伤到', '扭伤', '医生', '康复', '病', '药', '头晕']
const GREETING_WORDS = ['你好', '您好', '嗨', 'hello', 'hi', '在吗']

function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

function normalized(text: string): string {
  return text.trim().toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, '')
}

export type CoachMatch =
  | { kind: 'intent'; id: CoachIntentId }
  | { kind: 'greeting' }
  | { kind: 'safety' }
  | { kind: 'unknown' }

/** Simple keyword matching over the questions this page can answer. Anything else is said to be out of scope. */
export function matchQuestion(text: string, context: CoachPageContext): CoachMatch {
  const input = normalized(text)
  if (!input) return { kind: 'unknown' }
  if (SAFETY_WORDS.some((word) => input.includes(word))) return { kind: 'safety' }
  const intents = PAGE_INTENTS[context.page]
  let best: { id: CoachIntentId; score: number } | undefined
  const hits = (words: ReadonlyArray<string> | undefined) => (words ?? []).reduce((sum, word) => sum + (input.includes(word) ? 1 + (word.length >= 3 ? 0.5 : 0) : 0), 0)
  for (const id of intents) {
    const anchors = hits(INTENTS[id].anchors)
    if (!anchors) continue
    const score = anchors + hits(INTENTS[id].boosters) * 0.5
    if (!best || score > best.score) best = { id, score }
  }
  if (best) return { kind: 'intent', id: best.id }
  if (GREETING_WORDS.some((word) => input.includes(word))) return { kind: 'greeting' }
  return { kind: 'unknown' }
}

// ---- answers ------------------------------------------------------------------------------------------------------

const WARM_UP_EXPLANATION: ReadonlyArray<[RegExp, string]> = [
  [/^ELBOW_TOO_BENT/, '识别到手肘弯曲，没有达到这个动作要求的伸直程度。'],
  [/^ARMS?_TOO_LOW/, '识别到手臂抬起的高度不够。'],
  [/TORSO|BODY_SWAY/, '识别到上身有明显的倾斜或晃动。'],
  [/^TOO_FAST$/, '这一次完成得比建议的速度快。'],
  [/ASYMMETRY|UNSYNCED|HEIGHT_GAP|SIDE_SEQUENCE/, '识别到左右两侧（或手和脚）的动作不同步。'],
  [/^DEPTH_INSUFFICIENT$/, '识别到下蹲深度没有达到要求。'],
  [/^KNEE_VALGUS$/, '识别到膝盖有向内扣的趋势。'],
  [/^KNEE_TOO_LOW/, '识别到抬膝的高度不够。'],
  [/STEP_TOO_SMALL|MOTION_TOO_SMALL|INCOMPLETE/, '识别到动作幅度不够，或没有完整回到起始位置。'],
  [/OUT_OF_FRAME|LOW_CONFIDENCE|FRAMING|POSE_LOST/, '摄像头暂时看不清你的关键部位，请调整站位。'],
]

const ROUTINE_REGION: Readonly<Record<string, string>> = { MISMATCH_ARMS: '上肢', MISMATCH_TORSO: '躯干', MISMATCH_LEGS: '下肢' }

function explainFeedback(code: string, kind: string): string {
  if (kind === 'routine') {
    if (code === 'BEHIND') return '你的动作比标准视频慢了一些，和视频的时间对不上。'
    if (code === 'AHEAD') return '你的动作比标准视频快了一些，和视频的时间对不上。'
    if (ROUTINE_REGION[code]) return `和示范视频同一时刻相比，${ROUTINE_REGION[code]}的姿态差异比较大。`
    if (code === 'MISMATCH') return '和示范视频同一时刻相比，整体姿态差异比较大。'
  }
  const requirement = /^REQUIREMENT_(.+)$/.exec(code)?.[1]?.toLowerCase().replaceAll('_', '-') as RequirementId | undefined
  if (requirement && requirement in REQUIREMENTS) return `这是你为这个动作设置的识别重点「${REQUIREMENTS[requirement].label}」：${REQUIREMENTS[requirement].description}`
  if (code === 'MOTION_TOO_SMALL' && kind === 'custom-action') return '这一次没有做到你示范的完成姿势，所以没有计次。'
  return WARM_UP_EXPLANATION.find(([pattern]) => pattern.test(code))?.[1] ?? '这是根据摄像头识别到的关节位置判断的。'
}

function trainingAnswer(id: CoachIntentId, context: Extract<CoachPageContext, { page: 'training' }>): CoachAnswer {
  const { live, guide } = context
  const exercise = live.currentExercise
  const metrics = live.sessionStats?.metrics ?? {}
  const state = live.sessionStats?.state
  const kind = live.currentMode.kind
  const name = exercise?.name ?? live.currentMode.title
  switch (id) {
    case 'how-to-do':
      return {
        text: `${name}${exercise?.position ? `（第 ${exercise.position} 项）` : ''}：${guide.howTo}。`,
        facts: guide.keyPoints.slice(0, 3).map((point, index) => ({ label: `要点 ${index + 1}`, value: point })),
        basis: kind === 'routine' ? '依据：标准视频这一段的动作要点' : kind === 'custom-action' ? '依据：你示范并保存的动作设置' : '依据：这个动作的示范要求',
      }
    case 'why-corrected': {
      const feedback = live.currentFeedback
      if (!feedback || feedback.tone !== 'warning') {
        return { text: '刚才没有需要纠正的提示，保持现在的节奏就好。出现提示时，我会解释它的原因。', basis: '依据：当前的实时反馈' }
      }
      return { text: `刚才提示「${feedback.message}」。${explainFeedback(feedback.code, kind)}${TWO_D_NOTE}`, basis: '依据：当前的实时反馈' }
    }
    case 'how-am-i-doing': {
      if (state === 'PREPARING' || state === 'COUNTDOWN') return { text: '还没有开始。站好后双手在胸前合拢，开始训练，我再告诉你进展。', basis: '依据：当前训练状态' }
      if (kind === 'routine') {
        const similarity = metrics.similarity
        const facts = (['arms', 'torso', 'legs'] as const).flatMap((region) => metrics[region] === null || metrics[region] === undefined ? [] : [{ label: ({ arms: '上肢', torso: '躯干', legs: '下肢' } as const)[region], value: `${metrics[region]}%` }])
        const offset = metrics.timingOffsetMs
        const rhythm = offset === null || offset === undefined ? '' : Math.abs(offset) < 800 ? '，节奏基本同步' : offset > 0 ? '，比视频快了一点' : '，比视频慢了一点'
        return {
          text: similarity === null || similarity === undefined ? '正在比对你和标准视频的动作，暂时还没有可靠的数据。' : `现在和示范视频的跟练相似度是 ${similarity}%${rhythm}。${metrics.coverage !== null && metrics.coverage !== undefined ? `已经跟练了 ${metrics.coverage}% 的内容。` : ''}`,
          facts,
          basis: '依据：实时跟练比对',
        }
      }
      const unit = live.sessionStats?.unit ?? '次'
      const done = `已经完成 ${metrics.progress ?? 0} / ${metrics.target ?? 0} ${unit}`
      if (kind === 'custom-action') {
        return { text: `${done}，其中 ${metrics.passed ?? 0} ${unit}识别重点都做到了。${metrics.position !== null && metrics.position !== undefined ? `现在动作进行到 ${metrics.position}%（100% 是你示范的完成姿势）。` : ''}`, basis: '依据：实时识别结果' }
      }
      const score = metrics.score
      return { text: `${done}${typeof score === 'number' && score > 0 ? `，当前动作得分 ${score}` : ''}。`, basis: '依据：实时识别结果' }
    }
    case 'what-to-watch': {
      if (kind === 'routine') {
        const regions = (['arms', 'torso', 'legs'] as const).filter((region) => typeof metrics[region] === 'number')
        const weakest = regions.sort((left, right) => (metrics[left] as number) - (metrics[right] as number))[0]
        if (weakest && (metrics[weakest] as number) < 70) {
          const label = ({ arms: '上肢', torso: '躯干', legs: '下肢' } as const)[weakest]
          return { text: `现在${label}和示范的一致度最低（${metrics[weakest]}%），对照视频调整${label}的幅度和方向。这一段的要点：${guide.howTo}。`, basis: '依据：实时跟练比对' }
        }
        return { text: `这一段的要点：${guide.howTo}。跟着视频的口令，动作和视频一起起落。`, basis: '依据：标准视频这一段的动作要点' }
      }
      const feedback = live.currentFeedback
      const lines = guide.keyPoints.length ? guide.keyPoints : guide.checks
      return {
        text: feedback && feedback.tone === 'warning' ? `先注意刚才的提示：${feedback.message}。` : `做${name}时重点注意：`,
        facts: lines.slice(0, 3).map((point, index) => ({ label: `${index + 1}`, value: point })),
        basis: kind === 'custom-action' ? '依据：你设置的识别重点' : '依据：这个动作会检查的项目',
      }
    }
    default:
      return fallback(context)
  }
}

function reportAnswer(id: CoachIntentId, digest: ReportDigest): CoachAnswer {
  const basis = `依据：${formatDay(digest.startedAt)} 的「${digest.title}」训练报告`
  switch (id) {
    case 'report-overview': {
      const parts = [`这次${digest.title}${digest.complete ? '' : '（未完整完成）'}：${digest.completionText}`]
      if (digest.result) parts.push(`${digest.result.label} ${digest.result.value}`)
      const text = `${parts.join('，')}。${digest.comparison ? `${digest.comparison.text}。` : ''}${digest.strengths[0] ? `做得好的地方：${digest.strengths[0]}` : ''}`
      return { text, basis }
    }
    case 'biggest-issue':
      return digest.biggestIssue
        ? { text: `最需要关注的是「${digest.biggestIssue.title}」${digest.biggestIssue.value ? `（${digest.biggestIssue.value}）` : ''}。${digest.biggestIssue.detail}${TWO_D_NOTE}`, basis }
        : { text: '这次报告没有列出需要优先纠正的问题，可以保持现在的练法。', basis }
    case 'vs-last':
      return digest.comparison
        ? { text: `${digest.comparison.text}。${digest.comparison.direction === 'up' ? '有进步，继续保持。' : digest.comparison.direction === 'down' ? '比上次差一些，可以先把下次重点练好。' : ''}`, basis }
        : { text: digest.comparisonReason ?? '这次没有可以对比的记录。', basis }
    case 'next-focus':
      return digest.nextFocus
        ? { text: `下次重点练「${digest.nextFocus.title}」。${digest.nextFocus.detail}${digest.nextFocus.target ? ` ${digest.nextFocus.target}` : ''}`, link: digest.nextFocus.href ? { label: '直接去练', href: digest.nextFocus.href } : undefined, basis }
        : { text: '这次没有需要优先纠正的问题，下次按原来的方式完整练一遍就好。', basis }
    default:
      return fallback({ page: 'report', digest })
  }
}

function historyAnswer(id: CoachIntentId, context: Extract<CoachPageContext, { page: 'home' | 'history' }>): CoachAnswer {
  const { recent, latest, week } = context
  const first: RecentReportSummary | undefined = recent[0]
  switch (id) {
    case 'recent-summary': {
      if (!recent.length) return { text: '还没有训练记录。可以从“开始训练”里选一种训练，练完我就能帮你总结。', link: { label: '去开始训练', href: START_TRAINING_PATH } }
      const weekText = week ? `本周完成了 ${week.count} 次训练${week.previous ? `，上周是 ${week.previous} 次` : ''}。` : ''
      return {
        text: `${weekText}最近的训练：`,
        facts: recent.slice(0, 3).map((item) => ({ label: `${formatDay(item.startedAt)} ${item.modeTitle}`, value: `${item.headline}${item.completed ? '' : '（未完成）'}` })),
        basis: '依据：我的训练中的记录',
      }
    }
    case 'last-training':
      return first
        ? { text: `上次是 ${formatDay(first.startedAt)} 的「${first.modeTitle}」${first.completed ? '' : '（没有完成）'}：${first.headline}。`, link: { label: '查看这次报告', href: first.reportPath }, basis: '依据：我的训练中的记录' }
        : { text: '还没有训练记录。', link: { label: '去开始训练', href: START_TRAINING_PATH } }
    case 'what-next': {
      if (latest?.nextFocus) {
        return { text: `上次「${latest.title}」的练习重点是「${latest.nextFocus.title}」，今天可以接着练。`, link: latest.nextFocus.href ? { label: '直接去练', href: latest.nextFocus.href } : { label: '去开始训练', href: START_TRAINING_PATH }, basis: `依据：${formatDay(latest.startedAt)} 的训练报告` }
      }
      if (!recent.length) return { text: '可以从热身训练开始：6 个热身动作，实时纠正，练完会生成报告。', link: { label: '开始热身训练', href: SMART_TRAINING_PATH } }
      const tried = new Set(recent.map((item) => item.modeId))
      const suggestion = !tried.has('smart-training') ? '热身训练' : ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'].find((modeId) => !tried.has(modeId))
      const name = suggestion === '热身训练' ? '热身训练' : suggestion ? ({ baduanjin: '八段锦', taijiquan: '太极拳', wuqinxi: '五禽戏', yijinjing: '易筋经' } as Record<string, string>)[suggestion] : null
      return {
        text: `${week?.count ? `这周已经练了 ${week.count} 次。` : '本周还没有训练。'}${name ? `今天可以试试「${name}」，换一种训练方式。` : '可以挑上次没做完的训练，完整练一遍。'}`,
        link: { label: '去开始训练', href: START_TRAINING_PATH },
        basis: '依据：我的训练中的记录',
      }
    }
    default:
      return fallback(context)
  }
}

function workshopAnswer(id: CoachIntentId): CoachAnswer {
  switch (id) {
    case 'workshop-how':
      return { text: '点“创建动作”，按四步来：填名称和计数方式 → 用摄像头记录开始姿势和完成姿势 → 选择识别重点 → 测试几次后保存。保存后在首页“我的动作”里就能直接训练。' }
    case 'workshop-requirements':
      return { text: '识别重点是每做完一次时检查的要求，比如“手臂保持伸直”“膝盖弯曲到合适位置”。阈值会参考你示范的完成姿势自动设定，也可以在高级设置里手动调整。' }
    case 'workshop-test':
      return { text: '测试没通过时可以这样试：先确认要求的身体部位完整入镜；再回到上一步，把完成姿势做得更明显后重新记录；或者在高级设置里把“到位”的阈值调低一些。' }
    default:
      return fallback({ page: 'workshop' })
  }
}

export function answerIntent(id: CoachIntentId, context: CoachPageContext): CoachAnswer {
  if (!PAGE_INTENTS[context.page].includes(id)) return fallback(context)
  if (context.page === 'training') return trainingAnswer(id, context)
  if (context.page === 'report') return reportAnswer(id, context.digest)
  if (context.page === 'workshop') return workshopAnswer(id)
  return historyAnswer(id, context)
}

export function fallback(context: CoachPageContext): CoachAnswer {
  return { text: `这个问题我还回答不了。我不是通用聊天助手，只根据你的训练数据回答问题，可以试试下面这些：${PAGE_INTENTS[context.page].map((id) => `“${INTENTS[id].question}”`).join('、')}。` }
}

export function greeting(context: CoachPageContext): string {
  switch (context.page) {
    case 'training': return `我在看你练「${context.live.currentExercise?.name ?? context.live.currentMode.title}」。有问题可以点下面的问题问我。`
    case 'report': return `这是「${context.digest.title}」的报告，我可以帮你看看重点。`
    case 'workshop': return '想教 FormPilot 一个新动作？我可以告诉你怎么做。'
    default: return '今天想练什么？我可以帮你回顾最近的训练。'
  }
}

export interface CoachReply {
  intent?: CoachIntentId
  answer: CoachAnswer
}

/** Free input: a matched question is answered like its chip; health questions and anything unknown are declined. */
export function reply(text: string, context: CoachPageContext): CoachReply {
  const match = matchQuestion(text, context)
  if (match.kind === 'intent') return { intent: match.id, answer: answerIntent(match.id, context) }
  if (match.kind === 'safety') return { answer: { text: '我只能根据动作识别数据给出训练提示，不能判断伤病或身体状况。如果训练中感到疼痛或不适，请立即停止，并咨询医生或专业人士。' } }
  if (match.kind === 'greeting') return { answer: { text: `你好！我是 FormPilot 教练。${greeting(context)}` } }
  return { answer: fallback(context) }
}

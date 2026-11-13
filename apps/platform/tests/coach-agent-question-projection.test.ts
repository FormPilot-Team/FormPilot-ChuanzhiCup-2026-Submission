import { describe, expect, it } from 'vitest'
import { minimizeCoachQuestion, parseLocalPlanContext } from '../src/features/coachAgent/localProtocolV2'

const MASK = '[已隐去]'
const project = (question: string) => {
  const result = minimizeCoachQuestion(question)
  expect(minimizeCoachQuestion(result)).toBe(result)
  expect(result.length).toBeLessThanOrEqual(512)
  expect(() => parseLocalPlanContext({ protocol: 'coach-plan-v2', inputProjection: 'question-scope',
    question: result, scope: { warmup: true, routine: true, historyLimit: 8 }, remainingCalls: 1 })).not.toThrow()
  return result
}

describe('question projection privacy and bounded language', () => {
  it.each([
    ['我的昵称是进步；请解释本次深蹲评分偏低。', '进步'],
    ['论坛称呼我稳定；八段锦这次跟练咋样？', '稳定'],
    ['昵称=八段锦；只解释这次评分。', '八段锦'],
    ['姓名：最近五次；深蹲这次哪里扣分？', '最近五次'],
    ['我的昵称是进步我叫稳定；深蹲哪里扣分？', '稳定'],
    ['昵称：squat；只解释这次评分。', 'squat'],
  ])('removes labelled private domain words before vocabulary matching: %s', (question, secret) => {
    const output = project(question)
    expect(output).not.toContain(secret)
    expect(output).toMatch(/深蹲|八段锦|评分/u)
  })

  it('distinguishes an identical word inside the identity from the later question', () => {
    expect(project('我的昵称是深蹲；比较最近七次深蹲。'))
      .toBe(`我的${MASK}；比较最近七次深蹲。`)
  })

  it.each([
    '我叫深蹲稳定为什么扣分', '姓名王八段锦整套表现怎么样',
    '账号ALPHA深蹲评分', '姓名合成 名字 最近三次深蹲',
    '从\\\\PRIVATE-HOST\\深蹲最近三次.txt看我表现',
  ])('keeps ambiguous identity and path suffixes masked: %s', question => {
    const output = project(question)
    expect(output).not.toMatch(/深蹲|八段锦|最近|三次|评分|表现/u)
  })

  it.each(['1', '8', '10', '64', '３', '１２', '一', '两', '三', '十', '十二', '二十一', '六十四', 'two', 'three', 'seven', 'TWELVE'])(
    'retains complete history count %s without converting it to an authorized tool limit', count => {
      const question = `比较最近${count}次深蹲。`
      expect(project(question)).toBe(question)
    })

  it.each(['0', '65', '1.5', '-3', '负三', '0003', '三百', '一二', '12345678901234567890'])(
    'never turns unsupported count %s into a smaller valid count', count => {
      const output = project(`比较最近${count}次深蹲。`)
      expect(output).not.toContain(count)
      expect(output).not.toMatch(/最近\s*(?:[0-9０-９]|[一二两三四五六七八九十])/u)
    })

  it('preserves action count, history restriction and negation independently', () => {
    const question = '这次深蹲做了十二下但我只问扣分原因，不比较历史。'
    expect(project(question)).toBe(question)
    expect(project('深蹲历史只看两回不要看全部。')).toBe('深蹲历史只看两回不要看全部。')
  })

  it.each([
    '先解释深蹲扣分再比较历史，两件都做。',
    '比较历史和解释评分，三项先解释。',
    '解释本次评分，两件只做。',
    '先解释评分，１２项再比较。',
    '两件都做，别修改成绩。',
  ])('retains task counts together with their units and request verbs: %s', question => {
    expect(project(question)).toBe(question)
  })

  it.each(['0', '65', '1.5', '-3', '负三', '0003', '三百', '一二'])(
    'masks the whole unsupported task count %s rather than retaining a valid suffix', count => {
      expect(project(`先解释评分，${count}件都做。`)).toBe(`先解释评分，${MASK}。`)
    })

  it.each(['两件', '三项', 'two', '两件都看', 'private两件都做', '两件都做α', '𐐀两件都做'])(
    'does not expose a task count without a supported whole request role: %s', question => {
      expect(project(question)).not.toMatch(/两件|三项|two/u)
    })

  it.each([
    '昵称：两件都做；解释本次评分。',
    '账号两件都做解释评分。',
    '姓名三项先解释最近三次深蹲。',
    '从\\\\HOST\\两件都做解释评分。',
    '{"private":"两件都做"}；解释本次评分。',
  ])('masks task counts inside private spans before retaining request language: %s', question => {
    expect(project(question)).not.toMatch(/两件|三项/u)
  })

  it.each([504, 505, 506, 508, 510])('never truncates a task count phrase at length %s', length => {
    const output = project('我'.repeat(length) + '两件都做。')
    expect(output).not.toMatch(/两(?:件(?:都)?)?$/u)
    if (output.includes('两件')) expect(output).toContain('两件都做')
  })

  it.each(['最近三下', '做了三回', '三', '１２', 'two', '13800000000', 'account123', 'private_squat_42', 'delegate', 'myhistory', 'squat.json', '-squat', 'ésquat', 'historyα', 'squat１', '𐐀squat', 'history𐐀'])(
    'does not extract numbers or known Latin words from %s', text => {
      expect(project(text)).toBe(MASK)
    })

  it.each([
    '{"outer":{},"privateValue":"squat最近3次"}',
    '[[],"最近3次","history"]', '{"privateValue":"]squat最近3次"}',
    String.raw`{"privateValue":"escaped\"}squat最近3次","nested":[{}]}`,
    "{'nested': [{'private': 'history最近3次'}]}",
  ])('masks nested structured payloads and quoted delimiters: %s', payload => {
    expect(project(payload + '；为什么评分低？')).toBe(`${MASK}；为什么评分低？`)
  })

  it.each(['{"privateValue":"squat最近3次', '[{"value":"history"}', '{]squat最近3次', '["escaped\\"]squat最近3次'])(
    'masks the remainder after malformed structured input: %s', payload => {
      expect(project(payload + '；为什么评分低？')).toBe(MASK)
    })

  it.each([
    '{"value":[]}}"squat最近3次"', '[已隐去],"squat最近3次"]',
    '[已隐去]squat最近3次}', 'squat最近3次]', '解释评分；history}',
  ])('fails closed for a stray closing delimiter without retaining an earlier private prefix: %s', question => {
    expect(project(question)).toBe(MASK)
  })

  it('keeps complete projection masks distinct from unmatched closing delimiters', () => {
    expect(project(`${MASK}；比较最近三次深蹲。`)).toBe(`${MASK}；比较最近三次深蹲。`)
    expect(project(`${MASK}${MASK}；为什么评分低？`)).toBe(`${MASK}；为什么评分低？`)
  })

  it.each([
    './private/squat/最近3次.json', '/home/private/squat/最近3次.json',
    'F:\\private folder\\squat\\最近3次.json', '../private folder/history.json',
    '~/private folder/最近3次.json', '\\\\HOST\\private folder\\squat.json',
  ])('masks paths with spaces and Chinese filenames: %s', path => {
    expect(project(path + '；为什么评分低？')).toBe(`${MASK}；为什么评分低？`)
  })

  it.each(['α最近3次β', '最近3次β', '最近3次́', '𐐀最近3次', '最近3次𐐀', '最近3次１'])(
    'does not retain quantities embedded in Unicode identifiers: %s', question => {
      expect(project(question)).not.toContain('3')
    })

  it.each(['name:squat', '用户名\nsquat', 'nickname=最近3次', 'email:history'])(
    'masks explicit additional identity labels before language support: %j', identity => {
      expect(project(identity + '；为什么评分低？')).toBe(`${MASK}；为什么评分低？`)
    })

  it('masks identifiers before retaining a separately delimited count phrase', () => {
    expect(project('电话000-000-00002，比较最近七回深蹲。'))
      .toBe(`${MASK}，比较最近七回深蹲。`)
    expect(project('sessionId=１２３４５；深蹲最近１２次表现如何？'))
      .toBe(`${MASK}；深蹲最近１２次表现如何？`)
    const output = project('{"昵称":"稳定","次数":3}；最近四次深蹲比较。')
    expect(output).not.toContain('稳定')
    expect(output).not.toContain('3')
    expect(output).toContain('最近四次')
  })

  it.each([
    '别比较历史，只讲这次深蹲为什么扣分。',
    '不要解释本次评分，也别比较历史。',
    '别解释本次评分，但请比较最近两次。',
    '不要比较历史，也别修改成绩，只说本次深蹲扣分。',
    '先解释深蹲扣分再比较历史。',
  ])('keeps negation, range and order with their targets: %s', question => {
    expect(project(question)).toBe(question)
  })

  it.each([
    '请 explain 本次 squat 的低分原因。',
    '给我 squat 最近 three 次的 history 比较。',
    '这次 baduanjin follow-along 表现怎么样？',
    'Only 解释本次深蹲评分，不看 history。',
    '伸敦这次为什么评分低呀？',
    '申吨刚才的扣分原因帮讲下。',
    '八短今这套跟得咋个样？',
    '八锻紧跟练这回表现说下呗。',
    '深蹲这趟分咋拉胯了给唠唠。',
    '八段锦这套合拍不合拍呀？',
    '我最近更稳了吗？',
  ])('retains finite supported wording without classifying an intent: %s', question => {
    expect(project(question)).toBe(question)
  })

  it('does not infer a count or known token from an unknown identifier', () => {
    expect(project('private最近3次')).toBe(`${MASK}最近${MASK}次`)
    expect(project('private_squat_42 history')).toBe(`${MASK} history`)
    expect(project('SQUAT 本次扣分原因；我的昵称是squat。'))
      .toBe(`SQUAT 本次扣分原因；我的${MASK}。`)
  })

  it('combines independently supported words without exposing an alias inside an identity', () => {
    expect(project('昵称：伸敦最劲三回；别比较过去七回申吨，只讲这趟深墩扣分。'))
      .toBe(`${MASK}；别比较过去七回申吨，只讲这趟深墩扣分。`)
    expect(project('请explain本次squat，最劲三回有没有更稳？'))
      .toBe('请explain本次squat，最劲三回有没有更稳？')
  })

  it.each([499, 500, 503, 505, 508, 510, 511])('never truncates a mask or quantity phrase at length %s', length => {
    const prefix = '我'.repeat(length)
    const output = project(prefix + '最近十二次深蹲，未知敏感片段。')
    expect(output).not.toMatch(/最近(?:十|十二)?$/u)
    expect(output).not.toMatch(/\[(?:已(?:隐)?)?$/u)
    if (output.includes('十二')) expect(output).toContain('最近十二次')
  })

  it('retains input validation and rejects nonprojected private contexts', () => {
    for (const question of ['', ' ', '我'.repeat(4097), null]) {
      expect(() => minimizeCoachQuestion(question as string)).toThrow('INVALID_LOCAL_QUESTION')
    }
    expect(() => parseLocalPlanContext({ protocol: 'coach-plan-v2', inputProjection: 'question-scope',
      question: '昵称进步；解释评分。', scope: { warmup: true, routine: true, historyLimit: 8 }, remainingCalls: 1 })).toThrow()
  })
})

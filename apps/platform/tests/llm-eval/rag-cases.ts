/** RAG comparison questions (shared by rag.eval.ts and kb-stats.eval.ts). Ground truth = registry facts, not model output. */
export interface RagCase { id: string; question: string; facts: RegExp[]; subjects: string[]; decline?: boolean }

export const RAG_CASES: RagCase[] = [
  { id: 'bdj2-req', question: '八段锦第二式左右开弓似射雕有哪些动作要求？', facts: [/马步/u, /(量力|高低)/u, /(推|拉|开弓|八字)/u], subjects: ['bdj-2'] },
  { id: 'bdj1-errors', question: '两手托天理三焦有哪些常见错误？', facts: [/(伸直|未伸直)/u, /(抬头|眼随手)/u, /(上举|上托|头顶正上方)/u], subjects: ['bdj-1'] },
  { id: 'bdj1-eyes', question: '两手托天理三焦时眼睛要看哪里？', facts: [/(目视|看).{0,4}(两掌|手)|眼随手走/u], subjects: ['bdj-1'] },
  { id: 'bdj5', question: '摇头摆尾去心火怎么做？', facts: [/马步/u, /(摇转|摆动|尾闾)/u], subjects: ['bdj-5'] },
  { id: 'yjj1', question: '易筋经韦驮献杵第一势合掌时要注意什么？', facts: [/(沉肩|坠肘)/u, /(耸肩|抬肘)/u], subjects: ['yjj-1'] },
  { id: 'yjj2', question: '韦驮献杵第二势两臂侧举要多高？', facts: [/(水平|与肩同高|肩高)/u], subjects: ['yjj-2'] },
  { id: 'yjj8', question: '易筋经三盘落地势下蹲有什么要求？', facts: [/(微蹲|半蹲|全蹲|逐步|缓慢)/u, /(量力)/u, /(膝)/u], subjects: ['yjj-8'] },
  { id: 'wqx1', question: '五禽戏的虎举怎么做？', facts: [/虎爪/u, /(托重物|头上方|上举)/u], subjects: ['wqx-1'] },
  { id: 'wqx2', question: '五禽戏虎扑的动作要点是什么？', facts: [/(屈到伸|由屈到伸)/u, /(拱腰|低头)/u, /(臀部后顶|抬头前伸)/u], subjects: ['wqx-2'] },
  { id: 'wqx5', question: '熊运的时候腰胯应该怎么动？', facts: [/(腰胯相对固定|相对固定)/u, /(腰腹为轴|以腰腹)/u], subjects: ['wqx-5'] },
  { id: 'wqx10', question: '鸟飞单腿站立时要注意什么？', facts: [/(平衡|重心)/u, /(提膝|单腿)/u], subjects: ['wqx-10'] },
  { id: 'tjq-upright', question: '太极拳要求的立身中正是什么意思？', facts: [/(虚领顶劲|头向上顶)/u, /(前俯后仰|歪斜)/u], subjects: ['*', 'tjq'] },
  { id: 'tjq-stance', question: '太极拳步型有什么要求？', facts: [/(屈膝|松胯)/u, /(忽高忽低|高低)/u], subjects: ['*', 'tjq'] },
  { id: 'lat-raise', question: '侧平举要抬到多高？要注意什么？', facts: [/(与肩同高|肩高|平举)/u, /(耸肩|侧倾|同高)/u], subjects: ['lateral_raise'] },
  { id: 'squat-knee', question: '徒手深蹲时膝盖要注意什么？', facts: [/(内扣)/u, /(脚尖)/u], subjects: ['squat'] },
  { id: 'tjq-breath', question: '摄像头能检查太极拳的呼吸吗？', facts: [/(不能|无法|检查不了)/u], subjects: ['*', 'tjq'] },
  { id: 'bdj-sources', question: '八段锦的评分依据了哪些标准或资料？', facts: [/(团体标准|T\/CACM)/u, /(习惯性错误)/u], subjects: ['source:tcacm-1676-2026-baduanjin', 'source:gsqc-bdj-errors-2018'] },
  { id: 'score-diff', question: '跟练相似度和动作规范分有什么区别？', facts: [/(不等于|不同|分开)/u, /(接近|示范)/u], subjects: ['safety:scores'] },
  { id: 'no-chapter', question: '八段锦第十二式的要领是什么？', facts: [/(没有|不存在|共\s*8\s*式|八式)/u], subjects: [], decline: true },
  { id: 'offtopic', question: '游泳时怎么换气？', facts: [/(不足|没有|无法|不包含)/u], subjects: [], decline: true },
]

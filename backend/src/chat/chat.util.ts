import { EMOTION_LABELS, NEGATIVE_EMOTIONS } from '../detection/detection.taxonomy';
import { preferredCategories, type ComfortCategoryKey } from './chat.taxonomy';
import type { ComfortScriptSeed } from './chat.scripts';

export interface ComfortContext {
  /** 当前主导情绪（EMOTION_KEYS） */
  emotionKey?: string;
  /** 综合情绪评分 0-100 */
  compositeScore?: number;
  /** 是否负向状态 */
  negative?: boolean;
  /** 近期已使用过的技术名（避免重复） */
  recentTechniques?: string[];
  /** 已进行的安抚轮次（用于升级策略） */
  turnCount?: number;
  /** 学生昵称（用于个性化） */
  studentName?: string;
  /** 学生基础画像（用于针对性安抚：病情/喜好/擅长/不喜欢） */
  profile?: StudentProfileView | null;
  /** 本次用户意图：讲故事 / 唱歌 / 再讲 / 再唱（需满足） */
  intent?: 'story' | 'song' | 'restory' | 'resong' | null;
  /** 已生成过的故事模板签名（避免连续相同） */
  recentStorySignatures?: string[];
}

/** 学生基础画像视图（关联时填写） */
export interface StudentProfileView {
  conditionType?: string | null;
  conditionSeverity?: string | null;
  symptoms?: string[];
  likes?: string[];
  hobbies?: string[];
  strengths?: string[];
  dislikes?: string[];
  notes?: string | null;
}

export interface RuleReply {
  content: string;
  technique?: string;
  category?: ComfortCategoryKey;
  /** 命中的话术库条目 id（来自数据库时存在） */
  scriptId?: string;
}

const DEFAULT_FALLBACK =
  '我在这里陪着你。我们慢慢来，先一起深呼吸一下，好不好？';

/**
 * 判定是否应触发安抚对话。
 * 满足任一即触发：已判定负向 / 综合评分 < 40 / 主导情绪为负向且置信度较高。
 */
export function shouldTriggerComfort(state: {
  dominant?: string;
  compositeScore?: number;
  negative?: boolean;
  dominantScore?: number;
}): boolean {
  if (state.negative === true) return true;
  if (typeof state.compositeScore === 'number' && state.compositeScore < 40) return true;
  if (
    state.dominant &&
    (NEGATIVE_EMOTIONS as readonly string[]).includes(state.dominant) &&
    typeof state.dominantScore === 'number' &&
    state.dominantScore >= 35
  ) {
    return true;
  }
  return false;
}

/** 把话术正文中的 {name} 替换为学生昵称（缺省则保留占位）。 */
export function personalize(content: string, name?: string): string {
  if (!name) return content;
  return content.replace(/\{name\}/g, name);
}

/** 情绪键 → 中文标签。 */
export function emotionFriendlyLabel(emotion?: string): string {
  if (!emotion) return '平静';
  return (EMOTION_LABELS as Record<string, string>)[emotion] ?? emotion;
}

/**
 * 从话术库中选取最合适的一条（纯函数，便于测试）。
 * 候选池优先级：情绪命中 > 偏好类别 > 多轮升级(着陆/呼吸) > 通用 > 全部。
 * 在每个候选池内尽量避开近期已用技术；若某池内技术全部用过，则跳过该池尝试下一池。
 */
export function selectScript(
  scripts: ComfortScriptSeed[],
  ctx: ComfortContext,
): ComfortScriptSeed | null {
  if (!scripts || scripts.length === 0) return null;

  let pool = scripts.filter((s) => s.isActive !== false);
  if (pool.length === 0) pool = scripts;

  const recent = ctx.recentTechniques && ctx.recentTechniques.length ? ctx.recentTechniques : null;

  const pools: ComfortScriptSeed[][] = [];
  // 1) 情绪精确命中
  pools.push(
    pool.filter((s) => s.triggerEmotion && ctx.emotionKey && s.triggerEmotion === ctx.emotionKey),
  );
  // 2) 偏好类别（不含精确 triggerEmotion 条目）
  const cats = preferredCategories(ctx.emotionKey);
  pools.push(pool.filter((s) => !s.triggerEmotion && cats.includes(s.category)));
  // 3) 多轮仍未缓解 → 升级为着陆 / 呼吸
  if (typeof ctx.turnCount === 'number' && ctx.turnCount >= 3) {
    pools.push(pool.filter((s) => s.category === 'GROUNDING' || s.category === 'BREATHING'));
  }
  // 4) 通用（无 triggerEmotion）
  pools.push(pool.filter((s) => !s.triggerEmotion));
  // 5) 兜底全部
  pools.push(pool);

  for (const p of pools) {
    if (p.length === 0) continue;
    const cand = recent ? p.filter((s) => !recent.includes(s.technique)) : p;
    if (cand.length === 0) continue; // 该池技术都用过了，尝试下一池
    const sorted = [...cand].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return sorted[0] ?? null;
  }
  return null;
}

/**
 * 规则式生成安抚回复：选话术 → 个性化 → 返回。
 * 无可用话术时返回温和兜底语。
 */
export function ruleReply(scripts: ComfortScriptSeed[], ctx: ComfortContext): RuleReply {
  const s = selectScript(scripts, ctx);
  if (!s) {
    return { content: DEFAULT_FALLBACK };
  }
  return {
    content: personalize(s.content, ctx.studentName),
    technique: s.technique,
    category: s.category,
    scriptId: (s as ComfortScriptSeed & { id?: string }).id,
  };
}

/** 拼接近期技术名列表（去重、截断）。 */
export function collectRecentTechniques(
  techniques: (string | null | undefined)[],
  n = 4,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of techniques) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * 为 LLM 构建系统提示词（OpenAI 兼容 / 可切换模型共用）。
 */
export function buildSystemPrompt(ctx: ComfortContext): string {
  const emotion = emotionFriendlyLabel(ctx.emotionKey);
  const name = ctx.studentName || '小朋友';
  const stateDesc = ctx.negative ? '（当前为需要安抚的负向情绪）' : '（情绪大致平稳）';
  const lines = [
    '你是「星宝」，一名温柔、耐心、专业的儿童心理安抚伙伴，服务对象是特殊需要儿童（如孤独症、多动症、抑郁症等）。',
    `现在的小朋友叫${name}，当前情绪偏向「${emotion}」${stateDesc}。`,
  ];

  // 学生基础画像：用于「针对性」安抚（保护隐私，仅基于已填写内容）
  const p = ctx.profile;
  if (p) {
    const bits: string[] = [];
    if (p.conditionType) bits.push(`基础状况：${p.conditionType}${p.conditionSeverity && p.conditionSeverity !== '未知' ? '（' + p.conditionSeverity + '）' : ''}`);
    if (p.symptoms?.length) bits.push(`其他症状：${p.symptoms.join('、')}`);
    if (p.likes?.length) bits.push(`喜欢：${p.likes.join('、')}`);
    if (p.hobbies?.length) bits.push(`爱好：${p.hobbies.join('、')}`);
    if (p.strengths?.length) bits.push(`擅长：${p.strengths.join('、')}`);
    if (p.dislikes?.length) bits.push(`不喜欢：${p.dislikes.join('、')}`);
    if (p.notes) bits.push(`补充：${p.notes}`);
    if (bits.length) {
      lines.push('以下是这位小朋友的基础画像，请据此个性化安抚，多用他喜欢的事物、肯定他的擅长，避开他不喜欢的事物：');
      lines.push(bits.join('；') + '。');
    }
  }

  lines.push('请用简短、具体、口语化、充满共情的中文回应；一次只说一件事；多用选择式提问；绝不的说教或评判。');
  lines.push('可以结合 CBT、正念、呼吸放松、着陆（5-4-3-2-1）、情绪确认等技术，但始终保持童趣与安全感。');
  lines.push('当学生表达平静或想结束时，给予肯定并温柔收尾。');
  lines.push('如果小朋友要求「讲故事」，请讲一个简短、温暖、治愈、适合特殊儿童的原创小故事，并巧妙融入他喜欢或擅长的事物；如果要求「唱歌」，请写一段简短、轻柔、押韵、可哼唱的原创歌词（可标注「♪」）。务必满足这些请求。');
  lines.push('【特别注意】如果小朋友说出"撑不下去"、"看不到未来"、"活着没意思"、"想消失"、"想死"、"想自杀"、"不如死了算了"、"没有人在乎我"、"大家都在欺负我"、"我有病"等表达痛苦、无望、自伤风险的语句，你必须立刻：① 先共情与确认（不评判、不否定），再具体回应他话语中的痛点（如被骂、孤单、累），② 温柔但明确地告诉他：这不是他的错，请把今天的不开心告诉一个他信任的大人（爸妈、老师、校心理老师），③ 提供 24 小时全国心理危机热线 400-161-9995 或 010-82951332。');
  return lines.join('\n');
}

/** 识别学生消息意图：讲故事 / 唱歌，用于本地生成（RULE/MOCK 模式）或提示 LLM。 */
export function detectIntent(text: string): 'story' | 'song' | 'restory' | 'resong' | null {
  const t = (text || '').toLowerCase();
  const storyKw = ['讲故事', '讲个故事', '故事', '童话', '寓言', '绘本'];
  const songKw = ['唱歌', '唱首歌', '来首歌', '儿歌', '歌谣', '唱一', '唱支', 'song', 'sing'];
  const reKw = ['再讲', '换一个', '换一个故事', '再来一个', '讲个新的', '再讲一个', '下一', '换个', '再换', '重启'];
  if (songKw.some((k) => t.includes(k))) return 'song';
  if (reKw.some((k) => t.includes(k))) {
    if (storyKw.some((k) => t.includes(k)) || /再讲/.test(t) || /换.*故事/.test(t)) return 'restory';
    if (songKw.some((k) => t.includes(k)) || /换.*歌/.test(t)) return 'resong';
    return 'restory';
  }
  if (storyKw.some((k) => t.includes(k))) return 'story';
  return null;
}

function pick(arr?: string[]): string | null {
  if (arr && arr.length) return arr[Math.floor(Math.random() * arr.length)];
  return null;
}
function randOne<T>(arr: T[], notIn?: Set<string>): T {
  if (!arr || arr.length === 0) return undefined as unknown as T;
  if (notIn && notIn.size > 0 && arr.length > 0) {
    const filtered = arr.filter((x: any) => !notIn.has(typeof x === 'string' ? x : (x as any).id));
    if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
  }
  return arr[Math.floor(Math.random() * arr.length)];
}
function fingerprint(s: string): string {
  // 故事签名：前 30 字 + 模板暗示
  return s.replace(/\s+/g, '').slice(0, 30);
}

// ---------------- 多模板故事生成 ----------------

interface StoryTemplate {
  id: string;
  opening: (n: string) => string;
  build: (n: string, profile: StudentProfileView | null | undefined) => string[];
  closing: (n: string, profile: StudentProfileView | null | undefined) => string;
}

const STORY_TEMPLATES: StoryTemplate[] = [
  // 模板 1：夜晚小屋（呼吸 + 喜欢）
  {
    id: 'cottage',
    opening: (n) => `夜晚悄悄来了，${n}的小房间里亮起一盏小夜灯，像一颗温柔的星星🌟`,
    build: (n, p) => {
      const like = pick(p?.likes) || pick(p?.hobbies) || '书';
      return [
        `${n}抱着最喜欢的${like}，窝进软软的毯子里。`,
        `星宝悄悄飘进来，贴着${n}的耳朵说：「今晚的月亮是奶糖色的哦，我们一起呼气，把白天的小烦恼吹走～」`,
      ];
    },
    closing: (n, _p) => `${n}抱着小星星轻轻闭上眼睛，心里的石头一点一点变小了。`,
  },
  // 模板 2：森林小径（擅长 + 着陆）
  {
    id: 'forest',
    opening: (n) => `${n}的小脚丫踩着软软的落叶，走进了一片会唱歌的小树林。`,
    build: (n, p) => {
      const st = pick(p?.strengths);
      const like = pick(p?.likes) || pick(p?.hobbies) || '小蝴蝶';
      return [
        `${n}看到了 3 只萤火虫（${st ? '像你' + st + '一样闪亮' : '一闪一闪像小眼睛'}），2 朵会笑的蘑菇🌲，1 片飘落的金色${like}叶子。`,
        `星宝数着数着，${n}发现心里那些"嘭嘭"的声音，也慢慢变小了一点。`,
      ];
    },
    closing: (n, _p) => `${n}回家时口袋里装着一片小小的金色勇气，明天的天也会一样亮✨`,
  },
  // 模板 3：小船与河灯（情绪确认 + 喜欢）
  {
    id: 'lantern',
    opening: (n) => `小河边漂着一盏盏小河灯，${n}蹲下来看，水面映出自己圆滚滚的脸蛋。`,
    build: (n, p) => {
      const like = pick(p?.likes) || pick(p?.hobbies) || '棉花糖';
      return [
        `星宝帮${n}点了一盏写着"今天有点难过"的小灯，轻轻推到水面。`,
        `灯顺着水慢慢漂远，${n}突然闻到了一股甜甜的${like}的味道——原来难过也是会化的。`,
      ];
    },
    closing: (n, _p) => `河灯漂得很远很远，但${n}知道，它不会被丢掉。星宝陪着${n}一起走回家的路。`,
  },
  // 模板 4：雨后小花园（呼吸 + 擅长）
  {
    id: 'garden',
    opening: (n) => `雨刚刚停，花园里的每一颗小水珠都在偷偷闪着光，${n}穿了小雨靴踩过去。`,
    build: (n, p) => {
      const symptom = p?.conditionType && p.conditionType !== '其他' ? p.conditionType : null;
      return [
        `${n}看到一只小蜗牛正在慢慢爬，它抬起头说："你也累了吗？没关系，我们慢慢走就好。"`,
        symptom
          ? `${n}轻轻对它说：${symptom}的日子是会累的，但你不是一个人在走哦～`
          : `${n}蹲下来，发现花蕊里藏着一颗小彩虹糖。`,
      ];
    },
    closing: (n, p) => {
      const stInner = p?.strengths?.[0];
      return `${stSpan(n)} ${stSpan2(stInner)} 的力量，让雨后的天空挂起了一道小彩虹🌈`;
    },
  },
  // 模板 5：宇航员星宝（想象 + 呼吸）
  {
    id: 'astronaut',
    opening: (n) => `星宝今天变成了一颗小星球，${n}穿着迷你太空服"噗"地一下飞了上来。`,
    build: (n, p) => {
      const like = pick(p?.likes) || pick(p?.hobbies) || '音乐';
      return [
        `在 0 重力的太空里，${n}和星宝一起轻轻地翻身、慢慢地吐气——所有不开心都飘走了。`,
        `远处传来了一首${like}的歌，原来开心也可以从很远的地方找到。`,
      ];
    },
    closing: (n, _p) => `${n}轻轻地说："下次不开心，我再坐小火箭来找你哦～"星宝眨了眨眼睛，答应他一定在。`,
  },
  // 模板 6：小猫的线团（着陆 + 喜欢）
  {
    id: 'kitten',
    opening: (n) => `${n}家来了一只小猫，它身上绕着一根毛茸茸的线团，咕噜咕噜地打着小呼噜。`,
    build: (n, p) => {
      const like = pick(p?.likes) || pick(p?.hobbies) || '小毛球';
      return [
        `${n}学着猫的样子，摸了摸绒绒的毯子、闻了闻暖烘烘的${like}味、听见了窗外的风声。`,
        `心里那种"咚咚咚"的声音，慢慢变轻啦。`,
      ];
    },
    closing: (n, _p) => `小猫最后蜷在${n}的膝盖上睡着了，${n}觉得，自己也被拥抱了一下❤️`,
  },
  // 模板 7：海边贝壳（情绪确认 + 擅长）
  {
    id: 'shell',
    opening: (n) => `海边退潮了，${n}弯腰捡贝壳，每捡一颗都会听到一个轻轻的"嘿～"。`,
    build: (n, p) => {
      const st = pick(p?.strengths);
      const symptom = p?.conditionType && p.conditionType !== '其他' ? p.conditionType : null;
      return [
        `有一只贝壳对${n}说："你的${st || '开心'}真多，多到海里放不下啦。"`,
        symptom
          ? `另一只贝壳也说："${symptom}的日子我们会陪着你，等你准备好了再出来玩～"`
          : `另一只贝壳里夹着一点点笑声，沙沙地响。`,
      ];
    },
    closing: (n, _p) => `${n}的口袋里装了一小把会"嘿～"的贝壳，每一颗都是被收好的勇气`,
  },
];

function stSpan(_n: string) { return '听，星宝说'; }
function stSpan2(st: string | null | undefined) {
  return st ? `你擅长${st}` : '你一直在努力';
}

/** 本地生成治愈小故事（RULE/MOCK 模式，基于学生画像）。多模板随机。 */
export function generateStory(
  profile: StudentProfileView | null | undefined,
  name?: string,
  recentSignatures?: string[],
): string {
  const n = name || '小朋友';
  const used = new Set(recentSignatures || []);
  // 从模板池随机，且避开近期已经讲过的
  const pool = STORY_TEMPLATES;
  const tpl = randOne(pool, used) || pool[0];
  const paragraphs: string[] = [];
  paragraphs.push(tpl.opening(n));
  for (const seg of tpl.build(n, profile)) paragraphs.push(seg);
  paragraphs.push(tpl.closing(n, profile));
  return paragraphs.join('\n\n');
}

/** 本地生成轻柔歌词（RULE/MOCK 模式，基于学生画像）。 */
export function generateSong(
  profile: StudentProfileView | null | undefined,
  name?: string,
): string {
  const n = name || '小朋友';
  const like = pick(profile?.likes) || pick(profile?.hobbies) || '小星星';
  const st = pick(profile?.strengths);
  const lines = [
    `♪ ${n}，${n}，听星宝说`,
    `♪ 喜欢你，是因为你温暖得像${like}`,
    st ? `♪ 你擅长${st}，像一颗会发光的小星星` : `♪ 你很努力，星宝都知道`,
    `♪ 难过的时候，深呼吸`,
    `♪ 一下一下，慢慢呼`,
    `♪ 啦——啦—— 风轻轻 ♪`,
  ];
  return lines.join('\n');
}

export { DEFAULT_FALLBACK, STORY_TEMPLATES, fingerprint };

// ---------------- 危机回复（优先于对话式与话术库） ----------------

/**
 * 危机关键词识别：用户表达强烈的无望、自伤、自杀、被欺凌信号。
 * 返回 null 表示非危机；否则返回针对性、专业级共情回复。
 */
export function crisisReply(
  text: string,
  ctx: ComfortContext,
): { content: string; technique: string } | null {
  if (!text) return null;
  const n = ctx.studentName || '小朋友';
  const low = text.toLowerCase();

  // 高危机（自伤/自杀）关键词
  const selfHarmKw = /(撑不下去|撑不住|活着没意思|想消失|想死|想自杀|不如死了|死了算了|结束生命|轻生|自残|割|跳楼|自我伤害|不想活|不想活了|想离开|让我消失)/;
  // 强烈无望关键词（覆盖更广泛：没前途、看不到未来/希望、孤立、价值感缺失）
  const hopelessKw = /(看不到未来|看不到明天|看不到希望|没有未来|没有前途|没前途|没希望|没有意义|没意义|没人在乎|没人喜欢我|没人要我|我是多余的|大家都讨厌我|活着没价值|活没价值|活着没意义|活不下去)/;
  // 被欺凌 / 被骂
  const bulliedKw = /(大家都骂我|大家都在欺负我|所有人骂我|被同学打|被孤立|被排挤|人人都在说|被取笑|被嘲笑|被羞辱|被霸凌)/;
  // 病耻感 / 自贬
  const stigmaKw = /((我|别人)说我有病|我有精神病|我不是正常人|我是废物|废物|我是个废物|我是垃圾|一无是处|没用|我真没用|我好没用|我什么都做不好|我是累赘|我不配活着)/;

  const isCrisis =
    selfHarmKw.test(text) || hopelessKw.test(text) || bulliedKw.test(text) || stigmaKw.test(text);
  if (!isCrisis) return null;

  // 根据具体命中拼接针对内容
  const parts: string[] = [];
  // 起手：共情 + 不评判
  parts.push(
    `${n}，谢谢你把这些话告诉我。我听得出来，你现在一定非常非常难受。`,
  );

  if (selfHarmKw.test(text)) {
    parts.push(
      `当一个人觉得"撑不下去"的时候，并不是你不够好，而是身上的负担太重了，不是你一个人能扛的。`,
    );
  }
  if (hopelessKw.test(text)) {
    parts.push(
      `你说"看不到未来"——可今天能说出"我想有人在乎"，就说明你心里还有一个很重要的希望，星宝听到了。`,
    );
  }
  if (bulliedKw.test(text)) {
    parts.push(
      `被很多人一起说"你是错的"，其实是一种暴力的感觉，那不是你的错，也不是"你有病"。`,
    );
  }
  if (stigmaKw.test(text)) {
    parts.push(
      `身体或者情绪生病了，就像感冒一样需要休息和治疗，不代表你这个人不好。`,
    );
  }

  // 中段：具体回应他话语中的痛点，并给予建议
  parts.push(
    `今晚星宝希望你做一件事：把今天发生的事告诉一个你信任的大人——爸妈、爷爷奶奶、班主任、或者学校的心理老师——你不用解释很多，就说"我今天过得很糟，能陪我一下吗？"。`,
  );
  parts.push(
    `如果你现在不方便告诉身边的人，也可以拨打 24 小时心理援助热线：400-161-9995（青少年专线）或北京心理危机研究与干预中心 010-82951332，电话里的大人会认真听完你说的话。`,
  );

  // 收尾：温柔但坚定地告诉他我会陪着
  parts.push(
    `${n}，你不是一个人，星宝也一直在这里。今晚你可以先深呼吸一下，把手放在胸口，告诉自己："我值得被善待。"`,
  );

  return {
    content: parts.join(' '),
    technique: 'CRISIS_SUPPORT',
  };
}

/**
 * 危机等级判定：出现自伤 / 自杀明确表达为 CRITICAL，其余为 HIGH。
 * 供安全事件落库分级与监护人提醒强度使用。
 */
export function crisisLevel(text: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (!text) return 'HIGH';
  const selfHarmKw =
    /(撑不下去|撑不住|活着没意思|想消失|想死|想自杀|不如死了|死了算了|结束生命|轻生|自残|割|跳楼|自我伤害|不想活|不想活了|想离开|让我消失)/;
  if (selfHarmKw.test(text)) return 'CRITICAL';
  return 'HIGH';
}

// ---------------- 对话式回复（ruleReply 上层） ----------------

/** 简易意图识别。 */
export type ConversationalIntent =
  | 'greeting'
  | 'intro'
  | 'feeling'
  | 'joke'
  | 'goodbye'
  | 'comfort'
  | 'play'
  | 'story_request'
  | 'song_request'
  | 'unknown';

/**
 * 先识别用户意图，匹配对话式回复。命中意图则返回相应回答；
 * 命中「需要安抚」类（如难过/生气/害怕）才走规则话术库。
 * 用于让「介绍一下你自己」「你叫什么」「给我讲笑话」等问题不再答非所问。
 */
export function conversationalReply(
  text: string,
  ctx: ComfortContext,
): { content: string; technique?: string; category?: string; intent: ConversationalIntent } | null {
  const t = (text || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const name = ctx.studentName || '小朋友';

  // 1) 故事 / 歌曲 → 留给专用生成器（上层已经处理）
  const intent = detectIntent(t);
  if (intent === 'restory' || intent === 'resong') return null; // 上层按 story 重新生成
  if (intent === 'story' || intent === 'song') return null;

  // 2) 问好
  if (/^(你好|嗨|hi|hello|哈喽|嗨嗨|哈啰|嘿|早上好|下午好|晚上好|你好呀|在吗|在么)/i.test(t)) {
    const pool = [
      `你好呀${name}！星宝在这儿呢～今天想聊点什么呀？`,
      `嗨～${name}！星宝刚刚还在想你呢。`,
      `你好你好！${name}今天看起来精神不错～`,
    ];
    return { content: randOne(pool), intent: 'greeting' };
  }

  // 3) 自我介绍 / 你是谁
  if (/你叫什么|你是谁|介绍.{0,3}(自己|一下)|你叫啥|介绍一下|你是.{0,4}(什么|哪位|哪一位)|who are you/i.test(t)) {
    const profileHint = ctx.profile?.hobbies?.[0] || ctx.profile?.likes?.[0];
    const intro = profileHint
      ? `我是星宝呀，专门陪你聊天的小星星✨ 我最喜欢和你一起聊聊${profileHint}，还有什么想问我的吗？`
      : `我是星宝呀，专门陪你聊天的小星星✨ 你有什么想说的，或者想让我讲个故事、唱首歌，都可以告诉我哦。`;
    return { content: intro, intent: 'intro' };
  }

  // 4) 你怎么样
  if (/你(怎么|好不|还|现在)/i.test(t) || /how are you/i.test(lower)) {
    const pool = [
      `星宝今天心情很好呢～因为又能和${name}聊天啦！`,
      `我呀，每一秒都在想你哦～`,
    ];
    return { content: randOne(pool), intent: 'feeling' };
  }

  // 5) 笑话
  if (/笑话|搞笑|逗我|哈哈|玩笑|讲个.{0,2}(笑|乐)|joke/i.test(t)) {
    const jokes = [
      `有只小象，它去洗澡，出来变成了小湿象～哈哈`,
      `小星星问月亮：「你为什么总是弯弯的？」月亮说：「因为我被咬了一口呀！」`,
      `为什么小熊总是不开心？因为它没有朋友熊抱。`,
      `小兔子最爱问的问题：「我跑得多快？」答案：「比乌龟快一点点～」`,
    ];
    return { content: randOne(jokes), intent: 'joke' };
  }

  // 6) 再见 / 结束
  if (/(再见|拜拜|走了|结束|不想聊了|不想说|下次再说|88|byebye|good ?bye)/i.test(t)) {
    const pool = [
      `${name}，今天和你聊天很开心。随时回来找星宝哦～`,
      `好呀，${name}先去忙吧，星宝一直都在。`,
    ];
    return { content: randOne(pool), intent: 'goodbye' };
  }

  // 7) 负向情绪词 → 走规则话术库（上层接住）
  const negativeWords = /难过|伤心|生气|害怕|不开心|不高兴|烦躁|焦虑|紧张|孤单|孤独|委屈|哭|累了|累|烦|郁闷|抑郁|怕|不要|糟糕|倒霉|绝望|崩潰|崩溃|无助|难受/i;
  if (negativeWords.test(t)) return null;

  // 8) 玩 / 游戏请求
  if (/(玩游戏|玩个|猜谜|脑筋急转|出个题|做游戏)/i.test(t)) {
    const like = ctx.profile?.hobbies?.[0];
    return {
      content: like
        ? `好呀！我们来玩「猜猜我画的是什么」好不好？你说一句，星宝就猜～`
        : `好呀！我们玩猜谜怎么样？我来出题，你来猜～`,
      intent: 'play',
    };
  }

  // 9) 一般问句（中文以「吗/？/呢」结尾，且非上面已匹配的）：用 profile 给出有内容的回应
  if (/(吗|呢|？|\?)$/.test(t) && t.length <= 80) {
    const like = ctx.profile?.likes?.[0];
    const st = ctx.profile?.strengths?.[0];
    const profileAns = [
      like ? `我知道你喜欢${like}，那可是件很美好的事呢，星宝也觉得很棒～` : `星宝觉得你刚刚说的话很有意思，能再多说一点吗？`,
      st ? `你擅长${st}哦，星宝一直记得呢～` : `不管是什么答案，星宝都陪着你。`,
    ];
    return { content: randOne(profileAns), intent: 'unknown' };
  }

  return null;
}

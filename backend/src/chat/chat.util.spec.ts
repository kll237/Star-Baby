import {
  shouldTriggerComfort,
  selectScript,
  ruleReply,
  personalize,
  collectRecentTechniques,
  buildSystemPrompt,
  emotionFriendlyLabel,
  DEFAULT_FALLBACK,
} from './chat.util';
import type { ComfortScriptSeed } from './chat.scripts';

const S: ComfortScriptSeed[] = [
  { category: 'VALIDATION', technique: '我看见你生气', triggerEmotion: 'angry', content: '{name}，我看见你生气', priority: 6 },
  { category: 'BREATHING', technique: '4-7-8 呼吸', triggerEmotion: 'angry', content: '{name}，我们呼吸', priority: 5 },
  { category: 'BREATHING', technique: '方块呼吸', content: '{name}，方块呼吸', priority: 3 },
  { category: 'GROUNDING', technique: '5-4-3-2-1 着陆', content: '{name}，着陆', priority: 4 },
  { category: 'ENCOURAGEMENT', technique: '你很勇敢', triggerEmotion: 'fear', content: '{name}，你很勇敢', priority: 5 },
  { category: 'VALIDATION', technique: '害怕也没关系', triggerEmotion: 'fear', content: '{name}，害怕没关系', priority: 6 },
];

describe('chat.util', () => {
  describe('shouldTriggerComfort', () => {
    it('负向状态触发', () => {
      expect(shouldTriggerComfort({ dominant: 'happy', negative: true })).toBe(true);
    });
    it('综合评分<40 触发', () => {
      expect(shouldTriggerComfort({ dominant: 'neutral', compositeScore: 30 })).toBe(true);
    });
    it('主导负向情绪且置信度≥35 触发', () => {
      expect(shouldTriggerComfort({ dominant: 'angry', dominantScore: 40, compositeScore: 55 })).toBe(true);
    });
    it('平稳状态不触发', () => {
      expect(shouldTriggerComfort({ dominant: 'neutral', compositeScore: 70, dominantScore: 60 })).toBe(false);
    });
  });

  describe('selectScript', () => {
    it('精确命中 triggerEmotion 且按优先级取最高', () => {
      const s = selectScript(S, { emotionKey: 'angry' });
      expect(s?.technique).toBe('我看见你生气'); // priority 6 > 5
    });
    it('无精确命中时回退到偏好类别', () => {
      const s = selectScript(S.filter((x) => x.triggerEmotion !== 'fear'), { emotionKey: 'fear' });
      expect(s?.category).toBe('GROUNDING'); // fear 偏好 GROUNDING>BREATHING>...
    });
    it('避开近期已用技术', () => {
      const s = selectScript(S, { emotionKey: 'angry', recentTechniques: ['我看见你生气', '4-7-8 呼吸'] });
      expect(s?.technique).not.toBe('我看见你生气');
      expect(s?.technique).not.toBe('4-7-8 呼吸');
    });
    it('多轮后升级为着陆/呼吸', () => {
      const s = selectScript(S.filter((x) => x.triggerEmotion === undefined), { emotionKey: 'neutral', turnCount: 4 });
      expect(['GROUNDING', 'BREATHING']).toContain(s?.category);
    });
    it('空库返回 null', () => {
      expect(selectScript([], { emotionKey: 'angry' })).toBeNull();
    });
  });

  describe('ruleReply', () => {
    it('个性化替换 {name}', () => {
      const r = ruleReply(S, { emotionKey: 'angry', studentName: '小明' });
      expect(r.content).toContain('小明');
      expect(r.content).not.toContain('{name}');
      expect(r.technique).toBe('我看见你生气');
    });
    it('无可用话术时返回兜底语', () => {
      const r = ruleReply([], { studentName: '小明' });
      expect(r.content).toBe(DEFAULT_FALLBACK);
    });
  });

  describe('helpers', () => {
    it('personalize 缺省昵称保留占位', () => {
      expect(personalize('hi {name}', undefined)).toBe('hi {name}');
    });
    it('emotionFriendlyLabel 未知情绪返回原值', () => {
      expect(emotionFriendlyLabel('angry')).toBe('愤怒');
      expect(emotionFriendlyLabel('zzz')).toBe('zzz');
    });
    it('collectRecentTechniques 去重并截断', () => {
      const out = collectRecentTechniques(['a', 'b', 'a', 'c', 'd', 'e'], 3);
      expect(out).toEqual(['a', 'b', 'c']);
    });
    it('buildSystemPrompt 含学生名与情绪', () => {
      const p = buildSystemPrompt({ studentName: '小明', emotionKey: 'fear', negative: true });
      expect(p).toContain('小明');
      expect(p).toContain('恐惧');
    });
  });
});

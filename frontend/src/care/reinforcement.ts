/**
 * 特征 4：正向强化可视化（不只是「出问题才介入」）。
 * 特殊儿童干预核心是正强化：在孩子「平静 / 配合 / 完成某个动作」时给即时正向反馈
 * （星宝庆祝动画 + 星星积分），积分累积到小奖励。这里负责星星积分的本地记录与读取。
 */
export interface StarEvent {
  ts: string;
  reason: string;
  stars: number;
}

export interface StarState {
  total: number;
  events: StarEvent[];
  /** 本周（按本地时间周一起算）获得的星星 */
  weekTotal: number;
}

const KEY = (studentId: string) => `sp_stars_${studentId}`;

function read(studentId: string): StarState {
  try {
    const s = localStorage.getItem(KEY(studentId));
    if (s) return JSON.parse(s) as StarState;
  } catch {
    /* ignore */
  }
  return { total: 0, events: [], weekTotal: 0 };
}

function write(studentId: string, st: StarState): void {
  localStorage.setItem(KEY(studentId), JSON.stringify(st));
}

function weekStartMs(): number {
  const d = new Date();
  const day = d.getDay(); // 0=周日
  const diff = (day + 6) % 7; // 距本周一
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

/** 奖励星星，返回更新后的状态。 */
export function awardStars(studentId: string, reason: string, stars = 1): StarState {
  const st = read(studentId);
  const ev: StarEvent = { ts: new Date().toISOString(), reason, stars };
  st.events.unshift(ev);
  if (st.events.length > 100) st.events.pop();
  st.total += stars;
  if (new Date(ev.ts).getTime() >= weekStartMs()) st.weekTotal += stars;
  write(studentId, st);
  return st;
}

export function getStars(studentId: string): StarState {
  return read(studentId);
}

/** 距离下一个奖励还差多少星星（每 10 颗一个小奖励）。 */
export const REWARD_EVERY = 10;
export function nextRewardAt(total: number): number {
  return REWARD_EVERY - (total % REWARD_EVERY);
}

/**
 * 判断当前帧是否构成「值得奖励的正向时刻」。
 * 规则：持续性平静（已平静若干毫秒）/ 明确高兴 / 完成配合性动作（拍手、挥手、指认、静坐）。
 */
export function isPositiveMoment(opts: {
  dominant: string;
  behavior: string;
  calmMs: number;
}): { hit: boolean; reason?: string } {
  if (opts.dominant === 'happy') return { hit: true, reason: '露出笑容' };
  if (opts.behavior === 'clap') return { hit: true, reason: '主动拍手' };
  if (opts.behavior === 'wave') return { hit: true, reason: '主动打招呼' };
  if (opts.behavior === 'point') return { hit: true, reason: '主动指认表达' };
  if (opts.behavior === 'sit_still' && opts.calmMs >= 10000)
    return { hit: true, reason: '安静配合 10 秒' };
  if (opts.dominant === 'neutral' && opts.calmMs >= 15000)
    return { hit: true, reason: '持续平静 15 秒' };
  return { hit: false };
}

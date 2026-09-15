/**
 * 特征 7：风险分级客户端辅助（颜色 / 标签 / 一键联系动作映射）。
 * 与后端 RISK_SOP 同源；颜色采用柔和暖橙—琥珀—陶土，避免对自闭症儿童造成刺眼红色闪烁。
 */
import type { RiskLevel, RiskSopItem } from '@/api/types';

export const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  yellow: '#f1c40f',
  orange: '#e8833a',
  red: '#d9603b',
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  yellow: '黄色 · 关注',
  orange: '橙色 · 需介入',
  red: '红色 · 紧急',
};

export const RISK_LEVEL_ORDER: RiskLevel[] = ['yellow', 'orange', 'red'];

/** 把后端 SOP 的 action 映射成前端可执行的一键联系动作。 */
export function contactActionLabel(action: string): string {
  switch (action) {
    case 'call':
      return '📞 立即联系';
    case 'notify':
      return '🔔 通知';
    default:
      return '联系';
  }
}

/** 本地保存的一键联系号码（家长/班主任/校医），可在设置中填写。 */
export interface EmergencyContacts {
  parentPhone?: string;
  teacherPhone?: string;
  nursePhone?: string;
}

const CONTACT_KEY = 'sp_emergency_contacts';

export function getContacts(): EmergencyContacts {
  try {
    const s = localStorage.getItem(CONTACT_KEY);
    return s ? (JSON.parse(s) as EmergencyContacts) : {};
  } catch {
    return {};
  }
}

export function saveContacts(c: EmergencyContacts): void {
  localStorage.setItem(CONTACT_KEY, JSON.stringify(c));
}

/** 把 SOP 的 role 映射到本地联系号码。 */
export function phoneForRole(role: string, c: EmergencyContacts): string | undefined {
  if (role.includes('家长')) return c.parentPhone;
  if (role.includes('班主任') || role.includes('老师')) return c.teacherPhone;
  if (role.includes('校医')) return c.nursePhone;
  return undefined;
}

export function sopForLevel(sop: Record<RiskLevel, RiskSopItem>, level: RiskLevel): RiskSopItem {
  return sop[level] ?? sop.yellow;
}

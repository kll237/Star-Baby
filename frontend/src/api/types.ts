export type Role = 'PARENT' | 'TEACHER';
export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';

export interface SafeUser {
  id: string;
  account: string;
  nickname: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  createdAt: string;
  privacyConsentAt: string | null;
  privacyConsentVersion: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface Student {
  id: string;
  name: string;
  gender?: Gender;
  birthDate?: string;
  avatarUrl?: string;
  remarks?: string;
  status?: string;
  createdAt: string;
  profile?: StudentProfile;
  faceDescriptors?: { id: string; angle: string; createdAt: string; livenessPassed: boolean }[];
}

/** 学生基础画像（关联时填写，用于星宝针对性安抚） */
export interface StudentProfile {
  conditionType?: string | null;
  conditionSeverity?: string | null;
  symptoms?: string[];
  likes?: string[];
  hobbies?: string[];
  strengths?: string[];
  dislikes?: string[];
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 学生目录条目（仅摘要，保护隐私） */
export interface StudentDirectoryItem {
  id: string;
  name: string;
  gender: Gender;
  birthDate: string | null;
  avatarUrl: string | null;
  conditionType: string | null;
}

export type ConditionType = '抑郁症' | '自闭症' | '多动症' | '焦虑症' | '其他';
export type ConditionSeverity = '未知' | '轻度' | '中度' | '重度';
export const CONDITION_TYPES: ConditionType[] = ['抑郁症', '自闭症', '多动症', '焦虑症', '其他'];
export const CONDITION_SEVERITIES: ConditionSeverity[] = ['未知', '轻度', '中度', '重度'];

export type ProfilePayload = Partial<StudentProfile>;
export type AssociatePayload = ProfilePayload & { consent?: boolean };

export interface FaceLoginResult {
  matched: boolean;
  studentId?: string;
  studentName?: string;
  confidence: number;
  threshold: number;
  accessToken?: string;
}

export interface RegisterPayload {
  account: string;
  password: string;
  nickname: string;
  phone: string;
  email: string;
  role: Role;
  smsCode: string;
  privacyConsent: boolean;
  privacyVersion: string;
}

export interface LoginPayload {
  account: string;
  password: string;
  remember?: boolean;
}

export interface CreateStudentPayload {
  name: string;
  gender?: Gender;
  birthDate?: string;
  avatarUrl?: string;
  remarks?: string;
  consent?: boolean;
}

export interface RegisterFacePayload {
  studentId: string;
  livenessPassed: boolean;
  algorithm?: string;
  vectors: { angle: string; vector: number[] }[];
}

// ---------------- 阶段二：检测 ----------------
export interface DetectionSession {
  id: string;
  source: string;
  status: string;
  fps?: number | null;
  startedAt: string;
  endedAt?: string | null;
}

export interface EmotionFrameView {
  id: string;
  ts: string;
  scores: Record<string, number>;
  dominant: string;
  compositeScore: number;
  negative: boolean;
}

export interface BehaviorEventView {
  id: string;
  ts: string;
  behavior: string;
  behaviorLabel: string;
  confidence: number;
  source: string;
}

export interface SessionDetail {
  session: DetectionSession;
  frames: EmotionFrameView[];
  behaviors: BehaviorEventView[];
}

export interface BehaviorStats {
  [behavior: string]: { count: number; avgConfidence: number };
}

// ---------------- 阶段三：智能聊天安抚 ----------------
export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  technique?: string | null;
  audioUrl?: string | null;
  feedback?: FeedbackKind;
  createdAt: string;
}

export interface ChatSessionView {
  id: string;
  studentId: string;
  triggerEmotion?: string | null;
  triggerSource: string;
  status: string;
  llmProvider: string;
  startedAt: string;
  endedAt?: string | null;
  messageCount: number;
  summary?: string | null;
}

export interface StartChatResult {
  session: ChatSessionView;
  messages: ChatMessageView[];
}

export interface SendChatResult {
  userMessage: ChatMessageView;
  assistantMessage: ChatMessageView;
  tts: { engine: string };
}

export interface ComfortScriptView {
  id: string;
  category: string;
  technique: string;
  triggerEmotion?: string | null;
  content: string;
  followUp?: string | null;
  tone?: string;
  tags: string[];
  priority: number;
  isActive: boolean;
}

export interface MediaStatus {
  tts: 'browser' | 'server';
  asr: 'browser' | 'server';
  llm: { provider: string; configured: boolean; available: string[] };
}

export interface ChatTriggerPayload {
  studentId: string;
  emotionKey?: string;
  compositeScore?: number;
  dominantScore?: number;
}

// ---------------- 阶段四：家长/教师数据看板与报告 ----------------
export interface TrendBucket {
  bucket: string;
  frameCount: number;
  avgCompositeScore: number;
  negativeRatio: number;
  negativeCount: number;
  dominantCounts: Record<string, number>;
}

export interface EmotionSummary {
  frameCount: number;
  negativeCount: number;
  negativeRatio: number;
  avgCompositeScore: number;
  bestScore: number;
  worstScore: number;
  dominantDistribution: Record<string, number>;
}

export interface RiskBurst {
  start: string;
  end: string;
  durationSec: number;
  frameCount: number;
  negativeCount: number;
  peakNegativeScore: number;
  avgCompositeScore: number;
  dominant?: string;
}

export interface ComfortStats {
  sessionCount: number;
  activeCount: number;
  endedCount: number;
  triggerSourceDistribution: Record<string, number>;
  totalMessages: number;
  avgMessageCount: number;
}

export interface InterventionEffect {
  negativeBursts: number;
  comfortTriggered: number;
  coverageRate: number;
  avgMessagesWhenTriggered: number;
}

export interface RecoveryStat {
  episodes: number;
  recovered: number;
  recoveryRate: number;
  avgPreScore: number;
  avgPostScore: number;
  avgDelta: number;
}

export type RiskLevel = 'yellow' | 'orange' | 'red';

export interface RiskLevelStat {
  yellow: number;
  orange: number;
  red: number;
  total: number;
  topBehaviors: { behavior: string; label: string; level: RiskLevel; count: number }[];
}

export interface WeeklyNarrative {
  narrative: string;
  highlights: string[];
}

export interface RiskSopContact {
  role: string;
  action: string;
}
export interface RiskSopItem {
  level: RiskLevel;
  label: string;
  color: string;
  steps: string[];
  contacts: RiskSopContact[];
}

export interface DashboardData {
  studentId: string;
  period: { from: string; to: string; type: string };
  summary: EmotionSummary;
  trend: TrendBucket[];
  riskBursts: RiskBurst[];
  comfortStats: ComfortStats;
  intervention: InterventionEffect;
  behaviorStats: BehaviorStats;
  recovery: RecoveryStat;
  riskLevels: RiskLevelStat;
  narrative: WeeklyNarrative;
}

export interface ReportRecordView {
  id: string;
  type: string;
  format: string;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  generatedById?: string | null;
}

export interface ReportQuery {
  period?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  from?: string;
  to?: string;
  granularity?: 'day' | 'week' | 'month';
}

// ---------------- 阶段五：专业心理建议引擎与知识库 ----------------
export type KnowledgeCategory =
  | 'EMOTION_REGULATION'
  | 'SOCIAL_SKILL'
  | 'BEHAVIOR_INTERVENTION'
  | 'SENSORY_INTEGRATION'
  | 'COMMUNICATION'
  | 'FAMILY_LIFE'
  | 'SCHOOL_ADAPTATION'
  | 'CRISIS_INTERVENTION'
  | 'PARENT_GUIDANCE'
  | 'TEACHER_STRATEGY'
  | 'COGNITIVE_TRAINING'
  | 'ROUTINE_BUILDING';

export type AdviceSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AdviceTarget = 'ALL' | 'PARENT' | 'TEACHER' | 'STUDENT';

export interface KnowledgeView {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  summary?: string | null;
  source?: string | null;
  severity: AdviceSeverity;
  target: AdviceTarget;
  applicableEmotions: string[];
  applicableBehaviors: string[];
  tags: string[];
  reference?: string | null;
  priority: number;
  isActive: boolean;
}

export interface KnowledgeQuery {
  category?: string;
  target?: AdviceTarget;
  severity?: AdviceSeverity;
  keyword?: string;
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}

export interface KnowledgeListResult {
  total: number;
  items: KnowledgeView[];
}

export interface ScoredKnowledge extends KnowledgeView {
  score: number;
  matchReasons: string[];
}

export interface AdviceResult {
  severity: AdviceSeverity;
  summary: string;
  topItems: ScoredKnowledge[];
  byCategory: Record<string, ScoredKnowledge[]>;
  generatedAt: string;
}

export interface GenerateAdviceResult {
  result: AdviceResult;
  recordId: string;
  from: string;
  to: string;
}

export interface AdviceRecordView {
  id: string;
  studentId: string;
  severity: AdviceSeverity;
  summary: string;
  itemCount: number;
  createdAt: string;
}

export interface GenerateAdviceQuery {
  period?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  from?: string;
  to?: string;
  target?: AdviceTarget;
  topN?: number;
}

// ---------------- 阶段六：桌宠硬件接口（WebSocket + MQTT） ----------------
export type PetMood =
  | 'happy'
  | 'calm'
  | 'sad'
  | 'anxious'
  | 'angry'
  | 'alert'
  | 'celebrate'
  | 'sleep';
export type PetAnimation =
  | 'idle'
  | 'bounce'
  | 'dance'
  | 'sway'
  | 'shake'
  | 'hug'
  | 'alert'
  | 'cheer'
  | 'spin';
export type DeskPetDeviceType = 'VIRTUAL' | 'ROBOT' | 'SCREEN';
export type DeskPetEventType = 'detection' | 'risk' | 'comfort' | 'advice' | 'command' | 'heartbeat';

export interface PetReaction {
  mood: PetMood;
  animation: PetAnimation;
  message?: string | null;
  intensity?: number;
  ts: string;
}

export interface DeskPetEventView {
  id?: string;
  studentId: string;
  type: DeskPetEventType;
  reaction: PetReaction;
  source?: string | null;
  createdAt?: string;
}

export interface DeskPetFeed {
  studentId: string;
  connected: boolean;
  mqtt: { connected: boolean; mode: 'remote' | 'local'; url: string | null };
  reaction: PetReaction | null;
  type: DeskPetEventType | null;
}

export interface DeskPetDeviceView {
  id: string;
  deviceId: string;
  name: string;
  studentId: string;
  type: DeskPetDeviceType;
  topicPrefix: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

// ---------------- 危机安全事件 / 监护人通知 / 摘要 / 反馈 ----------------
export type SafetyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SafetyEventView {
  id: string;
  studentId: string;
  sessionId?: string | null;
  level: SafetyLevel;
  sourceText: string;
  replySummary: string;
  category: string;
  notifyStatus: string;
  notifiedAt?: string | null;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
  handledBy?: string | null;
  resolved: boolean;
  resolvedAt?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedStudentId?: string | null;
  read: boolean;
  createdAt: string;
}

export interface ChatSummary {
  periodDays: number;
  totalSessions: number;
  crisisEvents: number;
  techniqueBreakdown: { technique: string | null; _count: number }[];
  lastActiveAt: string | null;
}

export type FeedbackKind = 'LIKE' | 'DISLIKE' | null;

// ---------------- 危机告警闭环（监护人验证） ----------------
export type AlertChannel = 'SMS' | 'EMAIL' | 'INAPP';
export type AlertLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertKind = 'CRISIS' | 'RISK' | 'SUMMARY';
export type AlertStatus = 'PENDING' | 'SENT' | 'FAILED';

/** 触达记录（短信 / 邮件 / 站内信） */
export interface AlertLogView {
  id: string;
  userId: string;
  studentId: string;
  channel: AlertChannel;
  level: AlertLevel;
  kind: AlertKind;
  title: string;
  body: string;
  status: AlertStatus;
  error?: string;
  sentAt?: string | null;
  createdAt: string;
}

/** 监护人联系方式（手机号 / 邮箱已脱敏） */
export interface GuardianContactView {
  userId: string;
  name: string;
  role: string;
  isOwner: boolean;
  phone: string;
  email: string;
  hasPhone: boolean;
  hasEmail: boolean;
}

// ---------------- 知情同意 ----------------
export type ConsentAction = 'SIGNED' | 'REVOKED' | 'RESIGNED';

export interface ConsentRecordView {
  id: string;
  studentId: string;
  guardianId: string;
  guardian: { nickname: string; role: string };
  action: ConsentAction;
  version: string;
  createdAt: string;
}

import axios from 'axios';
import type {
  SafeUser,
  TokenPair,
  Student,
  StudentProfile,
  StudentDirectoryItem,
  ProfilePayload,
  AssociatePayload,
  FaceLoginResult,
  RegisterPayload,
  LoginPayload,
  CreateStudentPayload,
  RegisterFacePayload,
  DetectionSession,
  SessionDetail,
  BehaviorStats,
  StartChatResult,
  SendChatResult,
  ChatMessageView,
  ChatSessionView,
  ComfortScriptView,
  MediaStatus,
  DashboardData,
  ReportRecordView,
  ReportQuery,
  ComfortStats,
  InterventionEffect,
  DeskPetFeed,
  DeskPetDeviceView,
  DeskPetEventView,
  DeskPetEventType,
  DeskPetDeviceType,
  PetReaction,
  RiskLevel,
  RiskLevelStat,
  RiskSopItem,
  KnowledgeView,
  KnowledgeQuery,
  KnowledgeListResult,
  GenerateAdviceResult,
  AdviceRecordView,
  GenerateAdviceQuery,
  SafetyEventView,
  AppNotification,
  ChatSummary,
  FeedbackKind,
  AlertLogView,
  GuardianContactView,
  ConsentRecordView,
} from './types';

const BASE = import.meta.env.VITE_API_BASE || '/api';

const http = axios.create({ baseURL: BASE, timeout: 15000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('sp_token');
  if (token) cfg.headers = cfg.headers || {};
  if (token) (cfg.headers as any).Authorization = `Bearer ${token}`;
  return cfg;
});

// 401 统一处理：token 失效（过期/无效）时先尝试用 refresh token 无感换新，
// 换新成功则自动重试原请求（用户完全察觉不到）；refresh 也失效才清登录态跳登录页。
// 避免「停留在看板但每个接口都 401、摄像头永远打不开」的死循环。
let authRedirected = false;
let refreshingPromise: Promise<void> | null = null;

function clearAuthAndRedirectToLogin() {
  if (authRedirected) return;
  authRedirected = true;
  localStorage.removeItem('sp_token');
  localStorage.removeItem('sp_refresh');
  localStorage.removeItem('sp_user');
  localStorage.removeItem('sp_student');
  const back = encodeURIComponent(location.pathname + location.search);
  location.href = `/login?redirect=${back}`;
}

async function refreshAndRetry(original: any): Promise<any> {
  const rt = localStorage.getItem('sp_refresh');
  // 没有 refresh token（如学生端长令牌场景）或已重试过 → 直接跳登录
  if (!rt) {
    clearAuthAndRedirectToLogin();
    return Promise.reject(original.__err);
  }
  // 并发 401 时只发一次刷新请求
  if (!refreshingPromise) {
    refreshingPromise = http
      .post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken: rt })
      .then((resp) => {
        localStorage.setItem('sp_token', resp.data.accessToken);
        localStorage.setItem('sp_refresh', resp.data.refreshToken);
      })
      .finally(() => {
        refreshingPromise = null;
      });
  }
  try {
    await refreshingPromise;
  } catch {
    clearAuthAndRedirectToLogin();
    return Promise.reject(original.__err);
  }
  const token = localStorage.getItem('sp_token');
  original.headers = original.headers || {};
  original.headers.Authorization = `Bearer ${token}`;
  return http(original);
}

http.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url || '';
    const isAuthEndpoint =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/logout') ||
      url.includes('/auth/forgot') ||
      url.includes('/auth/reset');
    if (status === 401 && !isAuthEndpoint) {
      const original = error.config;
      if (original && !original._retry) {
        original._retry = true;
        original.__err = error;
        return refreshAndRetry(original);
      }
      clearAuthAndRedirectToLogin();
    }
    return Promise.reject(error);
  },
);

export const api = {
  // 短信
  sendSms: (phone: string, purpose: 'REGISTER' | 'RESET_PASSWORD') =>
    http.post<{ success: true; devCode?: string }>('/sms/send', { phone, purpose }),

  // 认证
  register: (data: RegisterPayload) => http.post<{ user: SafeUser; tokens: TokenPair }>('/auth/register', data),
  login: (data: LoginPayload) => http.post<{ tokens: TokenPair; user: SafeUser }>('/auth/login', data),
  refresh: (refreshToken: string) => http.post<TokenPair>('/auth/refresh', { refreshToken }),
  me: () => http.get<SafeUser>('/auth/me'),
  logout: (refreshToken?: string) => http.post('/auth/logout', { refreshToken }),
  forgotPassword: (phone: string) =>
    http.post<{ success: true; devCode?: string }>('/auth/forgot-password', { phone }),
  resetPassword: (phone: string, smsCode: string, newPassword: string) =>
    http.post('/auth/reset-password', { phone, smsCode, newPassword }),

  // 学生
  listStudents: () => http.get<Student[]>('/students'),
  getStudent: (id: string) => http.get<Student>(`/students/${id}`),
  createStudent: (data: CreateStudentPayload) => http.post<Student>('/students', data),
  updateStudent: (id: string, data: Partial<CreateStudentPayload>) => http.put<Student>(`/students/${id}`, data),
  deleteStudent: (id: string) => http.delete(`/students/${id}`),
  linkGuardian: (studentId: string, guardianAccount: string) =>
    http.post('/students/link', { studentId, guardianAccount }),

  // 学生目录 + 关联 + 画像
  listStudentDirectory: () => http.get<StudentDirectoryItem[]>('/students/directory'),
  associateStudent: (studentId: string, data: AssociatePayload) =>
    http.post<Student>(`/students/${studentId}/associate`, data),
  getStudentProfile: (studentId: string) => http.get<StudentProfile | null>(`/students/${studentId}/profile`),
  updateStudentProfile: (studentId: string, data: ProfilePayload) =>
    http.put<StudentProfile>(`/students/${studentId}/profile`, data),

  // 人脸
  registerFace: (data: RegisterFacePayload) => http.post<{ count: number }>('/face/register', data),
  faceLogin: (vector: number[]) => http.post<FaceLoginResult>('/face/login', { vector }),
  faceVerify: (studentId: string, vector: number[]) =>
    http.post<FaceLoginResult>('/face/verify', { studentId, vector }),
  demoStudentLogin: () =>
    http.post<FaceLoginResult & { accessToken?: string }>('/face/demo-student-login'),

  // 阶段二：检测
  createSession: (studentId: string, source?: 'CAMERA' | 'VIDEO_UPLOAD', deviceInfo?: string) =>
    http.post<{ sessionId: string; studentId: string }>('/detection/sessions', { studentId, source, deviceInfo }),
  appendFrame: (payload: {
    sessionId: string;
    emotionScores: Record<string, number>;
    behaviors?: { behavior: string; confidence: number; source?: string }[];
    ts?: number;
  }) => http.post('/detection/sessions/frames', payload),
  endSession: (sessionId: string, fps?: number) =>
    http.patch('/detection/sessions/end', { sessionId, fps }),
  listSessions: (studentId: string, params?: { from?: string; to?: string; limit?: number }) =>
    http.get<DetectionSession[]>('/detection/students/' + studentId + '/sessions', { params }),
  getSession: (studentId: string, sessionId: string) =>
    http.get<SessionDetail>(`/detection/students/${studentId}/sessions/${sessionId}`),
  behaviorStats: (studentId: string, from?: string, to?: string) =>
    http.get<BehaviorStats>('/detection/students/' + studentId + '/behavior-stats', { params: { from, to } }),

  // 阶段三：智能聊天安抚
  startChat: (studentId: string, dto?: { triggerEmotion?: string; triggerSource?: 'DETECTION' | 'MANUAL'; llmProvider?: string }) =>
    http.post<StartChatResult>('/chat/sessions', { studentId, ...dto }),
  sendChat: (sessionId: string, content: string) =>
    http.post<SendChatResult>('/chat/sessions/' + sessionId + '/messages', { content }),
  listChatSessions: (studentId: string, limit?: number) =>
    http.get<ChatSessionView[]>('/chat/students/' + studentId + '/sessions', { params: { limit } }),
  getChatSession: (sessionId: string) =>
    http.get<{ session: ChatSessionView; messages: ChatMessageView[] }>('/chat/sessions/' + sessionId),
  endChat: (sessionId: string, summary?: string) =>
    http.patch<ChatSessionView>('/chat/sessions/' + sessionId + '/end', { summary }),
  listScripts: (category?: string, includeInactive?: boolean) =>
    http.get<ComfortScriptView[]>('/chat/scripts', { params: { category, includeInactive } }),
  seedScripts: () => http.post<{ count: number }>('/chat/scripts/seed'),
  setLlmProvider: (provider: 'RULE' | 'MOCK' | 'OPENAI' | 'ZHIPU') =>
    http.post<MediaStatus['llm']>('/chat/llm/provider', { provider }),
  getMedia: () => http.get<MediaStatus>('/chat/media'),

  // 危机安全事件（监护人可见，闭环留痕）
  listSafetyEvents: (studentId: string, unack?: boolean) =>
    http.get<SafetyEventView[]>('/chat/students/' + studentId + '/safety-events', { params: { unack } }),
  ackSafetyEvent: (id: string, note?: string) =>
    http.patch('/chat/safety-events/' + id + '/ack', { note }),
  // 家长端聊天趋势摘要
  getChatSummary: (studentId: string) =>
    http.get<ChatSummary>('/chat/students/' + studentId + '/chat-summary'),
  // 回复质量反馈 👍/👎
  setMessageFeedback: (messageId: string, feedback: FeedbackKind) =>
    http.post('/chat/messages/' + messageId + '/feedback', { feedback }),
  // 服务端 TTS（前端"服务端语音"开关调用，返回 audioUrl）
  synthesizeTts: (text: string) =>
    http.post<{ engine: string; audioUrl?: string; voiceHint?: string }>('/chat/tts', { text }),
  // 监护人站内信（危机告警红点）
  myNotifications: (unread?: boolean) =>
    http.get<AppNotification[]>('/chat/my-notifications', { params: { unread } }),
  markNotificationRead: (id: string) => http.patch('/chat/notifications/' + id + '/read'),

  // 危机告警闭环（监护人验证：演示触发 / 触达记录 / 监护人联系方式）
  alertApi: {
    demoTrigger: (studentId: string, scenario: 'CRISIS' | 'SELF_HARM' = 'CRISIS') =>
      http.post<{ ok: boolean; scenario: string; safetyEventId?: string; message: string }>(
        '/alerts/demo-trigger',
        { studentId, scenario },
      ),
    listLogs: (studentId: string) =>
      http.get<AlertLogView[]>('/alerts/logs', { params: { studentId } }),
    getContacts: (studentId: string) =>
      http.get<GuardianContactView[]>('/alerts/contacts', { params: { studentId } }),
  },

  // 知情同意（撤回 / 重新签署 / 历史记录）
  consentApi: {
    listRecords: (studentId: string) =>
      http.get<ConsentRecordView[]>('/students/' + studentId + '/consent-records'),
    revoke: (studentId: string) =>
      http.post<{ ok: boolean; consentAt: null }>('/students/' + studentId + '/consent/revoke'),
    reSign: (studentId: string) =>
      http.post<{ ok: boolean; consentAt: string }>('/students/' + studentId + '/consent/re-sign'),
  },

  // 阶段四：家长/教师数据看板与报告
  reportDashboard: (studentId: string, params?: ReportQuery) =>
    http.get<DashboardData>('/reports/students/' + studentId + '/dashboard', { params }),
  reportTrend: (studentId: string, params?: ReportQuery) =>
    http.get<{ studentId: string; period: DashboardData['period']; trend: DashboardData['trend'] }>(
      '/reports/students/' + studentId + '/trend',
      { params },
    ),
  reportRisk: (studentId: string, params?: ReportQuery) =>
    http.get<{ studentId: string; riskBursts: DashboardData['riskBursts']; negativeRatio: number }>(
      '/reports/students/' + studentId + '/risk-events',
      { params },
    ),
  reportComfort: (studentId: string, params?: ReportQuery) =>
    http.get<{ studentId: string; comfortStats: ComfortStats; intervention: InterventionEffect }>(
      '/reports/students/' + studentId + '/comfort-stats',
      { params },
    ),
  reportIntervention: (studentId: string, params?: ReportQuery) =>
    http.get<{ studentId: string; intervention: InterventionEffect; comfortStats: ComfortStats }>(
      '/reports/students/' + studentId + '/intervention',
      { params },
    ),
  reportWeeklyNarrative: (studentId: string, params?: ReportQuery) =>
    http.get<{ studentId: string; period: DashboardData['period']; narrative: string; highlights: string[] }>(
      '/reports/students/' + studentId + '/weekly-narrative',
      { params },
    ),
  reportRiskSummary: (studentId: string, params?: ReportQuery) =>
    http.get<{
      studentId: string;
      period: DashboardData['period'];
      riskLevels: RiskLevelStat;
      sop: Record<RiskLevel, RiskSopItem>;
    }>('/reports/students/' + studentId + '/risk-summary', { params }),
  listReportRecords: (studentId: string) =>
    http.get<ReportRecordView[]>('/reports/students/' + studentId + '/records'),
  exportReport: (studentId: string, dto: { format: 'JSON' | 'CSV'; period?: ReportQuery['period']; from?: string; to?: string; granularity?: ReportQuery['granularity'] }) =>
    http.post('/reports/students/' + studentId + '/export', dto, { responseType: 'blob' }),

  // 阶段五：专业心理建议引擎与知识库
  generateAdvice: (studentId: string, dto: GenerateAdviceQuery) =>
    http.post<GenerateAdviceResult>('/advice/students/' + studentId + '/generate', dto),
  listAdviceRecords: (studentId: string) =>
    http.get<AdviceRecordView[]>('/advice/students/' + studentId + '/records'),
  advicePrompt: (studentId: string, dto: GenerateAdviceQuery) =>
    http.post<{ prompt: string }>('/advice/students/' + studentId + '/prompt', dto),
  listKnowledge: (q?: KnowledgeQuery) =>
    http.get<KnowledgeListResult>('/advice/knowledge', { params: q }),
  seedKnowledge: () => http.get<{ inserted: number; total: number }>('/advice/knowledge/seed'),
  countKnowledge: () => http.get<{ count: number }>('/advice/knowledge/count'),

  // 阶段六：桌宠硬件接口（WebSocket + MQTT）
  registerDeskPetDevice: (dto: { deviceId: string; studentId: string; name?: string; type?: DeskPetDeviceType; topicPrefix?: string }) =>
    http.post<DeskPetDeviceView>('/deskpet/devices', dto),
  listDeskPetDevices: (studentId?: string, includeInactive?: boolean) =>
    http.get<DeskPetDeviceView[]>('/deskpet/devices', { params: { studentId, includeInactive } }),
  getDeskPetDevice: (id: string) => http.get<DeskPetDeviceView>('/deskpet/devices/' + id),
  updateDeskPetDevice: (
    id: string,
    dto: Partial<{ name: string; type: DeskPetDeviceType; topicPrefix: string; isActive: boolean }>,
  ) => http.patch<DeskPetDeviceView>('/deskpet/devices/' + id, dto),
  removeDeskPetDevice: (id: string) => http.delete('/deskpet/devices/' + id),
  deskPetFeed: (studentId: string) => http.get<DeskPetFeed>('/deskpet/students/' + studentId + '/feed'),
  deskPetMqttStatus: (studentId: string) =>
    http.get<{ connected: boolean; mode: 'remote' | 'local'; url: string | null }>(
      '/deskpet/students/' + studentId + '/mqtt-status',
    ),
  deskPetCommand: (studentId: string, dto: { action: string; deviceId?: string }) =>
    http.post('/deskpet/students/' + studentId + '/command', dto),
  deskPetEvents: (studentId: string, limit?: number) =>
    http.get<DeskPetEventView[]>('/deskpet/students/' + studentId + '/events', { params: { limit } }),
};

export default api;

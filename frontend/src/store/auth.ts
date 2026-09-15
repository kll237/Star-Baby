import { defineStore } from 'pinia';
import api from '@/api';
import type { SafeUser, TokenPair } from '@/api/types';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: SafeUser | null;
  studentId: string | null; // 学生端已识别登录的学生
  studentName: string | null; // 学生端已登录学生姓名（用于「欢迎进入 XX」提示）
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem('sp_token'),
    refreshToken: localStorage.getItem('sp_refresh'),
    user: JSON.parse(localStorage.getItem('sp_user') || 'null'),
    studentId: localStorage.getItem('sp_student'),
    studentName: localStorage.getItem('sp_student_name'),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => s.user?.role,
    studentName: (s) => s.studentName,
  },
  actions: {
    setSession(tokens: TokenPair, user: SafeUser) {
      this.token = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.user = user;
      localStorage.setItem('sp_token', tokens.accessToken);
      localStorage.setItem('sp_refresh', tokens.refreshToken);
      localStorage.setItem('sp_user', JSON.stringify(user));
    },
    setStudent(studentId: string, studentName?: string | null) {
      this.studentId = studentId;
      this.studentName = studentName ?? null;
      localStorage.setItem('sp_student', studentId);
      if (studentName) localStorage.setItem('sp_student_name', studentName);
      else localStorage.removeItem('sp_student_name');
    },
    /** 学生端人脸登录成功后写入学生令牌（用于检测/WS 鉴权） */
    setStudentSession(accessToken: string, studentId: string, studentName?: string | null) {
      this.token = accessToken;
      this.studentId = studentId;
      this.studentName = studentName ?? null;
      this.user = null;
      localStorage.setItem('sp_token', accessToken);
      localStorage.setItem('sp_student', studentId);
      if (studentName) localStorage.setItem('sp_student_name', studentName);
      else localStorage.removeItem('sp_student_name');
      localStorage.removeItem('sp_user');
    },
    async logout() {
      try {
        await api.logout(this.refreshToken || undefined);
      } catch {
        /* 忽略 */
      }
      this.token = null;
      this.refreshToken = null;
      this.user = null;
      this.studentId = null;
      this.studentName = null;
      localStorage.removeItem('sp_token');
      localStorage.removeItem('sp_refresh');
      localStorage.removeItem('sp_user');
      localStorage.removeItem('sp_student');
    },
  },
});

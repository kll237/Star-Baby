<template>
  <div class="center-screen login-bg">
    <!-- 背景视频（用户上传素材） -->
    <video
      class="login-video"
      src="/backgrounds/bg-login.mp4"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
    ></video>
    <div class="login-overlay"></div>

    <div class="card login-card" style="width: 420px; max-width: 100%; position: relative; z-index: 1">
      <h1 class="title">家长 / 教师登录</h1>
      <p class="subtitle">星宝守护 · 用账号密码进入管理端</p>

      <div class="label">账号</div>
      <input v-model="form.account" class="input" placeholder="请输入账号" />

      <div class="label" style="margin-top: 14px">密码</div>
      <input v-model="form.password" type="password" class="input" placeholder="请输入密码" />

      <label class="hint" style="display: flex; gap: 8px; align-items: center; margin: 14px 0">
        <input type="checkbox" v-model="form.remember" /> 记住登录（7 天内免登录）
      </label>

      <button class="btn" style="width: 100%" :disabled="loading" @click="submit">
        {{ loading ? '登录中…' : '登录' }}
      </button>

      <div class="row" style="margin-top: 18px; justify-content: space-between">
        <button class="btn ghost" style="min-height: 44px; font-size: 16px" @click="go('forgot')">忘记密码</button>
        <button class="btn ghost" style="min-height: 44px; font-size: 16px" @click="go('register')">注册账号</button>
      </div>
      <button class="btn secondary" style="width: 100%; margin-top: 14px" @click="go('face-login')">
        🧒 我是小朋友（刷脸进入）
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api from '@/api';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const toast = useToast();
const form = reactive({ account: '', password: '', remember: true });
const loading = ref(false);

async function submit() {
  if (!form.account || !form.password) {
    toast.warn('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    const { data } = await api.login({ ...form });
    auth.setSession(data.tokens, data.user);
    toast.success('登录成功');
    const back = route.query.redirect ? decodeURIComponent(String(route.query.redirect)) : '/dashboard';
    router.push(back);
  } catch (e: any) {
    toast.error(e?.response?.data?.message || '登录失败，请检查账号密码');
  } finally {
    loading.value = false;
  }
}

function go(name: string) {
  router.push({ name });
}
</script>

<style scoped>
.login-bg {
  position: relative;
  overflow: hidden;
  /* 兜底底色：与视频主色协调 */
  background: linear-gradient(135deg, #f7c8d3 0%, #d8b4f8 50%, #ffd5a0 100%);
}

.login-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  pointer-events: none;
}

.login-overlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at center,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0.35) 60%,
      rgba(180, 130, 200, 0.45) 100%);
}

.login-card {
  backdrop-filter: blur(6px);
  background: rgba(255, 255, 255, 0.82) !important;
  box-shadow: 0 18px 48px rgba(120, 70, 160, 0.25);
}
</style>

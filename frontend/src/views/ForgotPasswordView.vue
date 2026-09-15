<template>
  <div class="center-screen">
    <div class="card" style="width: 440px; max-width: 100%">
      <h1 class="title">找回密码</h1>
      <p class="subtitle">通过手机短信验证码重置密码</p>

      <div class="label">手机号</div>
      <div class="row">
        <input v-model="phone" class="input" style="flex: 1" placeholder="注册时使用的手机号" />
        <button class="btn secondary" style="min-height: 52px" :disabled="smsLoading" @click="sendSms">
          {{ smsText }}
        </button>
      </div>
      <p v-if="devCode" class="hint">（开发模式验证码：{{ devCode }}）</p>

      <div class="label" style="margin-top: 12px">短信验证码</div>
      <input v-model="smsCode" class="input" placeholder="6 位验证码" />

      <div class="label" style="margin-top: 12px">新密码</div>
      <input v-model="newPassword" type="password" class="input" placeholder="至少 8 位" />

      <button class="btn" style="width: 100%; margin-top: 18px" :disabled="loading" @click="submit">
        {{ loading ? '提交中…' : '重置密码' }}
      </button>
      <div v-if="error" class="error">{{ error }}</div>
      <button class="btn ghost" style="width: 100%; margin-top: 12px; min-height: 44px; font-size: 16px" @click="router.push('/login')">
        返回登录
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';

const router = useRouter();
const phone = ref('');
const smsCode = ref('');
const newPassword = ref('');
const loading = ref(false);
const smsLoading = ref(false);
const smsText = ref('获取验证码');
const devCode = ref('');
const error = ref('');

async function sendSms() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    error.value = '请输入正确的手机号';
    return;
  }
  smsLoading.value = true;
  try {
    const { data } = await api.forgotPassword(phone.value);
    devCode.value = data.devCode || '';
    smsText.value = '已发送';
  } catch (e: any) {
    error.value = e?.response?.data?.message || '发送失败';
  } finally {
    smsLoading.value = false;
  }
}

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await api.resetPassword(phone.value, smsCode.value, newPassword.value);
    router.push('/login');
  } catch (e: any) {
    error.value = e?.response?.data?.message || '重置失败';
  } finally {
    loading.value = false;
  }
}
</script>

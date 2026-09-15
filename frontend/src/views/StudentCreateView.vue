<template>
  <div class="center-screen">
    <div class="card" style="width: 440px; max-width: 100%">
      <h1 class="title">新建学生</h1>
      <p class="subtitle">学生端无密码，由人脸登录</p>

      <div class="label">姓名</div>
      <input v-model="form.name" class="input" placeholder="学生姓名" />

      <div class="label" style="margin-top: 12px">性别</div>
      <div class="row">
        <button class="btn ghost" :class="{ active: form.gender === 'MALE' }" @click="form.gender = 'MALE'">男</button>
        <button class="btn ghost" :class="{ active: form.gender === 'FEMALE' }" @click="form.gender = 'FEMALE'">女</button>
        <button class="btn ghost" :class="{ active: form.gender === 'UNKNOWN' }" @click="form.gender = 'UNKNOWN'">未知</button>
      </div>

      <div class="label" style="margin-top: 12px">出生日期（可选）</div>
      <input v-model="form.birthDate" type="date" class="input" />

      <label class="consent">
        <input type="checkbox" v-model="consent" />
        <span>我已阅读并同意《儿童心理健康数据知情同意书》，作为监护人授权平台处理该学生的相关情绪与行为数据。</span>
      </label>
      <button class="btn" style="width: 100%; margin-top: 20px" :disabled="loading || !consent" @click="submit">
        {{ loading ? '保存中…' : '保存并继续' }}
      </button>
      <div v-if="error" class="error">{{ error }}</div>
      <button class="btn ghost" style="width: 100%; margin-top: 12px; min-height: 44px; font-size: 16px" @click="router.push('/students')">
        返回
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import type { Gender } from '@/api/types';

const router = useRouter();
const form = reactive<{ name: string; gender: Gender; birthDate: string }>({
  name: '',
  gender: 'UNKNOWN',
  birthDate: '',
});
const loading = ref(false);
const error = ref('');
const consent = ref(false);

async function submit() {
  error.value = '';
  if (!form.name) {
    error.value = '请输入姓名';
    return;
  }
  loading.value = true;
  try {
    const { data } = await api.createStudent({
      name: form.name,
      gender: form.gender,
      birthDate: form.birthDate || undefined,
      consent: consent.value,
    });
    router.push(`/students/${data.id}/profile`);
  } catch (e: any) {
    error.value = e?.response?.data?.message || '创建失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.btn.ghost.active {
  border-color: var(--color-primary-dark);
  background: #fff3e6;
}
.consent {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 18px;
  font-size: 13px;
  color: #8a6d4b;
  line-height: 1.5;
}
.consent input {
  margin-top: 3px;
}
</style>

<template>
  <div style="max-width: 760px; margin: 0 auto; padding: 24px">
    <div class="row" style="justify-content: space-between; align-items: center; margin-bottom: 14px">
      <div>
        <h1 class="title" style="margin: 0">{{ studentName }} · 基础画像</h1>
        <p class="subtitle" style="margin: 4px 0 0">这些信息用于星宝「针对性」安抚，仅关联家长/教师可见</p>
      </div>
      <button class="btn ghost" style="min-height: 44px" @click="router.push('/students')">返回</button>
    </div>

    <div v-if="loading" class="card hint">加载中…</div>
    <div v-else class="card">
      <ProfileFields v-model="profile" />
      <button class="btn" style="width: 100%; margin-top: 18px" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存画像' }}
      </button>
      <div v-if="saved" class="ok">已保存 ✓</div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api from '@/api';
import ProfileFields from '@/components/ProfileFields.vue';
import type { ProfilePayload } from '@/api/types';

const router = useRouter();
const route = useRoute();
const id = route.params.id as string;
const studentName = ref('学生');
const profile = ref<ProfilePayload>({
  conditionType: '其他',
  conditionSeverity: '未知',
  symptoms: [],
  likes: [],
  hobbies: [],
  strengths: [],
  dislikes: [],
  notes: '',
});
const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  try {
    const stu = await api.getStudent(id);
    studentName.value = stu.data.name;
    const { data } = await api.getStudentProfile(id);
    if (data) {
      profile.value = {
        conditionType: data.conditionType ?? '其他',
        conditionSeverity: data.conditionSeverity ?? '未知',
        symptoms: data.symptoms || [],
        likes: data.likes || [],
        hobbies: data.hobbies || [],
        strengths: data.strengths || [],
        dislikes: data.dislikes || [],
        notes: data.notes ?? '',
      };
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = '';
  saved.value = false;
  saving.value = true;
  try {
    await api.updateStudentProfile(id, profile.value);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (e: any) {
    error.value = e?.response?.data?.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.ok {
  margin-top: 10px;
  color: #3aa757;
  font-weight: 600;
}
</style>

<template>
  <div class="sl-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="sl-bg-overlay"></div>
    <div style="max-width: 880px; margin: 0 auto; padding: 24px; position: relative; z-index: 1">
      <div class="card sl-head" style="margin-bottom: 18px; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(8px); border-radius: 14px; padding: 16px 20px">
        <div class="row" style="justify-content: space-between; align-items: center">
          <div>
            <h1 class="title" style="margin: 0">我的学生</h1>
            <p class="subtitle" style="margin: 4px 0 0">为每位学生采集人脸，或关联已注册的学生</p>
          </div>
          <div class="row">
            <button class="btn ghost" style="min-height: 44px" @click="router.push(workbenchRoute)">← {{ workbenchLabel }}</button>
            <button class="btn ghost" style="min-height: 44px" @click="auth.logout(); router.push('/login')">退出</button>
            <button class="btn ghost" style="min-height: 44px" @click="router.push('/students/associate')">🔗 关联学生</button>
            <button class="btn" style="min-height: 44px" @click="router.push('/students/new')">＋ 新建学生</button>
          </div>
        </div>
      </div>

      <StateBlock
        v-if="uiState !== 'ready'"
        :state="uiState"
        loading-text="正在加载学生列表…"
        empty-text="还没有学生，点击「新建学生」或「关联学生」开始吧。"
        error-text="学生列表加载失败"
        @retry="load"
      />

      <div v-for="s in students" :key="s.id" class="card" style="margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.88); backdrop-filter: blur(6px); position: relative; z-index: 1">
        <div>
          <div style="font-size: 20px; font-weight: 700">
            {{ s.name }}
            <span v-if="s.profile?.conditionType" class="badge">{{ s.profile.conditionType }}<template v-if="s.profile.conditionSeverity && s.profile.conditionSeverity !== '未知'">·{{ s.profile.conditionSeverity }}</template></span>
          </div>
          <div class="hint">
            性别：{{ genderText(s.gender) }} ｜ 已注册人脸：{{ s.faceDescriptors?.length || 0 }} 组
          </div>
        </div>
        <div class="row">
          <button class="btn ghost" style="min-height: 44px" @click="router.push(`/students/${s.id}/profile`)">画像</button>
          <button
            class="btn ghost"
            style="min-height: 44px"
            :disabled="(s.faceDescriptors?.length || 0) > 0"
            @click="router.push(`/students/${s.id}/face-register`)"
          >
            {{ (s.faceDescriptors?.length || 0) > 0 ? '已注册' : '人脸注册' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import { useAuthStore } from '@/store/auth';
import type { Student, Gender } from '@/api/types';
import StateBlock from '@/components/StateBlock.vue';

const router = useRouter();
const auth = useAuthStore();
const students = ref<Student[]>([]);

// 返回工作台：家长 → 家长工作台，教师 → 教师工作台
const workbenchRoute = computed(() =>
  auth.role === 'TEACHER' ? '/dashboard' : '/parent/dashboard'
);
const workbenchLabel = computed(() =>
  auth.role === 'TEACHER' ? '返回教师工作台' : '返回家长工作台'
);
const loading = ref(false);
const error = ref('');
// 背景图（用户上传素材）
const bgUrl = '/backgrounds/bg-students.jpg';

const uiState = computed<'loading' | 'empty' | 'error' | 'ready'>(() => {
  if (loading.value) return 'loading';
  if (error.value) return 'error';
  if (students.value.length === 0) return 'empty';
  return 'ready';
});

function genderText(g?: Gender) {
  return g === 'MALE' ? '男' : g === 'FEMALE' ? '女' : '未知';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await api.listStudents();
    students.value = data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || '网络异常';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.badge {
  display: inline-block;
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #9a5a1f;
  background: #fff0df;
  border-radius: 999px;
  padding: 1px 10px;
  vertical-align: middle;
}
/* 我的学生背景图 */
.sl-with-bg {
  position: relative;
  min-height: 100vh;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
.sl-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg,
      rgba(255, 240, 230, 0.35) 0%,
      rgba(255, 230, 245, 0.28) 50%,
      rgba(220, 200, 240, 0.30) 100%);
}
</style>

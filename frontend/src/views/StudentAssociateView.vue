<template>
  <div style="max-width: 760px; margin: 0 auto; padding: 24px">
    <div class="row" style="justify-content: space-between; align-items: center; margin-bottom: 14px">
      <div>
        <h1 class="title" style="margin: 0">关联学生</h1>
        <p class="subtitle" style="margin: 4px 0 0">选择一位已注册的学生，填写 TA 的基础画像后即可查看状态</p>
      </div>
      <button class="btn ghost" style="min-height: 44px" @click="router.push('/students')">返回</button>
    </div>

    <div v-if="!selected" class="card">
      <input v-model="q" class="input" placeholder="搜索学生姓名…" />
      <div v-if="loading" class="hint" style="margin-top: 12px">加载中…</div>
      <div v-else-if="filtered.length === 0" class="hint" style="margin-top: 12px">
        暂无可关联的学生。若你的孩子/学生还未注册，请先到「我的学生」新建。
      </div>
      <div
        v-for="s in filtered"
        :key="s.id"
        class="stu"
      >
        <div>
          <div style="font-weight: 700; font-size: 17px">{{ s.name }}</div>
          <div class="hint">
            {{ genderText(s.gender) }} ｜ {{ s.conditionType ? '状况：' + s.conditionType : '未填写基础状况' }}
          </div>
        </div>
        <button class="btn" style="min-height: 40px" @click="selected = s">选择关联</button>
      </div>
    </div>

    <div v-else class="card">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h2 class="title" style="margin: 0; font-size: 18px">关联：{{ selected.name }}</h2>
        <button class="btn ghost" style="min-height: 36px" @click="selected = null">重新选择</button>
      </div>
      <p class="subtitle" style="margin: 6px 0 14px">
        填写基础状况与喜好，星宝就能「针对 TA」进行安抚、讲故事、唱歌。
      </p>
      <ProfileFields v-model="profile" />
      <label class="consent">
        <input type="checkbox" v-model="consent" />
        <span>我已阅读并同意《儿童心理健康数据知情同意书》，作为监护人授权平台在关联与安抚过程中处理该学生的相关情绪与行为数据。</span>
      </label>
      <button class="btn" style="width: 100%; margin-top: 18px" :disabled="saving || !consent" @click="submit">
        {{ saving ? '关联中…' : '确认关联' }}
      </button>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import ProfileFields from '@/components/ProfileFields.vue';
import type { StudentDirectoryItem, Gender, ProfilePayload } from '@/api/types';

const router = useRouter();
const list = ref<StudentDirectoryItem[]>([]);
const q = ref('');
const loading = ref(false);
const selected = ref<StudentDirectoryItem | null>(null);
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
const saving = ref(false);
const error = ref('');
const consent = ref(false);

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase();
  if (!k) return list.value;
  return list.value.filter((s) => s.name.toLowerCase().includes(k));
});

function genderText(g: Gender) {
  return g === 'MALE' ? '男' : g === 'FEMALE' ? '女' : '未知';
}

onMounted(async () => {
  loading.value = true;
  try {
    const { data } = await api.listStudentDirectory();
    list.value = data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载学生目录失败';
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!selected.value) return;
  if (!consent.value) {
    error.value = '请先勾选知情同意书';
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    await api.associateStudent(selected.value.id, { ...profile.value, consent: consent.value });
    router.push('/students');
  } catch (e: any) {
    error.value = e?.response?.data?.message || '关联失败';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.input {
  width: 100%;
  border: 1px solid #f0d3b3;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 15px;
  outline: none;
  font-family: inherit;
}
.stu {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid #f3e2cc;
  border-radius: 12px;
  margin-top: 10px;
}
.consent {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 16px;
  font-size: 13px;
  color: #8a6d4b;
  line-height: 1.5;
}
.consent input {
  margin-top: 3px;
}
</style>

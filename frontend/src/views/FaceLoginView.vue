<template>
  <div class="center-screen">
    <div class="card" style="width: 520px; max-width: 100%; text-align: center">
      <h1 class="title">小朋友，刷脸进入 👋</h1>
      <p class="subtitle">看着摄像头，点击按钮就能进入啦</p>

      <video ref="videoEl" class="video-frame" autoplay muted playsinline></video>

      <button class="btn" style="width: 100%; margin-top: 14px" :disabled="busy" @click="faceLogin">
        {{ busy ? '识别中…' : '🌟 刷脸进入' }}
      </button>

      <div v-if="msg" class="hint" style="margin-top: 10px">{{ msg }}</div>
      <div v-if="error" class="error">{{ error }}</div>

      <!-- 登录失败回退：选择账号 + 人脸二次验证 -->
      <div v-if="showFallback" class="card" style="margin-top: 16px; text-align: left; background: #fffaf3">
        <div class="label">没有识别出来？输入你的学生编号再试一次</div>
        <input v-model="fallbackId" class="input" placeholder="学生编号（家长/老师提供）" />
        <button class="btn secondary" style="width: 100%; margin-top: 10px" :disabled="busy" @click="faceVerify">
          人脸二次验证
        </button>
      </div>

      <!-- 演示学生免刷脸直登：摄像头坏了也能用，仅命中「演示学生-小明」 -->
      <button class="btn" style="margin-top: 12px; min-height: 44px; font-size: 16px; background: #ffd9a8" @click="demoLogin">
        🎀 演示学生·小明 免刷脸进入（摄像头坏了也能用）
      </button>

      <button class="btn ghost" style="margin-top: 16px; min-height: 44px; font-size: 16px" @click="goAdult">
        我是家长 / 教师
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import { detectDescriptor, loadFaceModels } from '@/utils/face';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const videoEl = ref<HTMLVideoElement | null>(null);
const busy = ref(false);
const msg = ref('');
const error = ref('');
const showFallback = ref(false);
const fallbackId = ref('');
let stream: MediaStream | null = null;

onMounted(async () => {
  try {
    await loadFaceModels();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    if (videoEl.value) {
      videoEl.value.srcObject = stream;
      await videoEl.value.play();
    }
  } catch (e: any) {
    // 摄像头不可用（如设备损坏）不阻断演示入口，仅温和提示
    error.value = '';
    msg.value = '未检测到摄像头，可直接点击下方「免刷脸进入」体验演示学生端';
  }
});

onUnmounted(() => stream?.getTracks().forEach((t) => t.stop()));

async function faceLogin() {
  if (!videoEl.value) return;
  busy.value = true;
  error.value = '';
  msg.value = '';
  try {
    const res = await detectDescriptor(videoEl.value);
    if (!res) {
      error.value = '没有看到脸，请正对摄像头再试';
      return;
    }
    const { data } = await api.faceLogin(res.descriptor);
    if (data.matched && data.studentId && data.accessToken) {
      auth.setStudentSession(data.accessToken, data.studentId, data.studentName);
      welcomeStudent(data.studentId, data.studentName);
      router.push('/student/dashboard');
    } else {
      showFallback.value = true;
      msg.value = `未匹配到账号（置信度 ${data.confidence}），可输入编号后二次验证`;
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || '识别失败';
  } finally {
    busy.value = false;
  }
}

async function faceVerify() {
  if (!videoEl.value || !fallbackId.value) {
    error.value = '请输入学生编号';
    return;
  }
  busy.value = true;
  try {
    const res = await detectDescriptor(videoEl.value);
    if (!res) {
      error.value = '没有看到脸，请正对摄像头再试';
      return;
    }
    const { data } = await api.faceVerify(fallbackId.value, res.descriptor);
    if (data.matched && data.studentId && data.accessToken) {
      auth.setStudentSession(data.accessToken, data.studentId, data.studentName);
      welcomeStudent(data.studentId, data.studentName);
      router.push('/student/dashboard');
    } else {
      error.value = `验证未通过（置信度 ${data.confidence}）`;
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || '验证失败';
  } finally {
    busy.value = false;
  }
}

function goAdult() {
  router.push('/login');
}

/** 刷脸/免刷脸登录成功那一刻，在登录屏明确提示「欢迎进入 XX」，
 *  并写入与看板去重一致的 sessionStorage 键，避免进入看板后重复弹。 */
function welcomeStudent(studentId: string, studentName?: string) {
  if (!studentName) return;
  sessionStorage.setItem(`sg_welcomed_${studentId}`, '1');
  toast.success(`欢迎进入 ${studentName} 👋`);
}

async function demoLogin() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.demoStudentLogin();
    if (data.matched && data.studentId && data.accessToken) {
      auth.setStudentSession(data.accessToken, data.studentId, data.studentName);
      welcomeStudent(data.studentId, data.studentName);
      router.push('/student/dashboard');
    } else {
      error.value = '演示学生未预置，请先在家长端创建「演示学生-小明」';
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || '演示登录失败';
  } finally {
    busy.value = false;
  }
}
</script>

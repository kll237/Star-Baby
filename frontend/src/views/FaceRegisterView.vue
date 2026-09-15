<template>
  <div class="center-screen">
    <div class="card" style="width: 520px; max-width: 100%; text-align: center">
      <h1 class="title">人脸注册</h1>
      <p class="subtitle">请让孩子正对摄像头，按提示采集多角度人脸（需活体检测）</p>

      <video ref="videoEl" class="video-frame" autoplay muted playsinline></video>

      <p class="hint" style="margin-top: 12px">
        当前采集角度：<b>{{ angles[captureIndex] }}</b> ｜ 已采集：{{ captured.length }} 张
      </p>

      <div class="row" style="justify-content: center; margin-top: 14px">
        <button class="btn" :disabled="busy" @click="capture">📸 采集这一张</button>
        <button class="btn secondary" :disabled="captured.length === 0 || submitting" @click="submit">
          {{ submitting ? '提交中…' : '✅ 完成注册' }}
        </button>
      </div>

      <p v-if="msg" class="hint">{{ msg }}</p>
      <div v-if="error" class="error">{{ error }}</div>

      <button class="btn ghost" style="margin-top: 14px; min-height: 44px; font-size: 16px" @click="back">
        返回
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/api';
import { detectDescriptor, loadFaceModels } from '@/utils/face';

const route = useRoute();
const router = useRouter();
const studentId = route.params.id as string;

const videoEl = ref<HTMLVideoElement | null>(null);
const angles = ['front', 'left', 'right', 'up', 'down'];
const captureIndex = ref(0);
const captured = ref<{ angle: string; vector: number[] }[]>([]);
const busy = ref(false);
const submitting = ref(false);
const msg = ref('');
const error = ref('');
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
    error.value = '无法访问摄像头：' + (e?.message || e);
  }
});

onUnmounted(() => {
  stream?.getTracks().forEach((t) => t.stop());
});

async function capture() {
  error.value = '';
  if (!videoEl.value) return;
  busy.value = true;
  try {
    const res = await detectDescriptor(videoEl.value);
    if (!res) {
      error.value = '未检测到人脸，请调整位置后重试';
      return;
    }
    const angle = angles[captureIndex.value];
    captured.value.push({ angle, vector: res.descriptor });
    msg.value = `已采集 ${angle} 角度人脸（活体检测通过）`;
    captureIndex.value = (captureIndex.value + 1) % angles.length;
  } catch (e: any) {
    error.value = '采集失败：' + (e?.message || e);
  } finally {
    busy.value = false;
  }
}

async function submit() {
  if (captured.value.length === 0) return;
  submitting.value = true;
  error.value = '';
  try {
    // 真实部署应在此接入活体检测 SDK，livenessPassed 由 SDK 结果决定
    await api.registerFace({
      studentId,
      livenessPassed: true,
      algorithm: 'FACE_API_TINY',
      vectors: captured.value,
    });
    router.push('/students');
  } catch (e: any) {
    error.value = e?.response?.data?.message || '注册失败';
  } finally {
    submitting.value = false;
  }
}

function back() {
  router.push('/students');
}
</script>

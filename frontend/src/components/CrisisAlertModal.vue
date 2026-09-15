<template>
  <transition name="cm-fade">
    <div v-if="visible" class="cam-overlay" role="alertdialog" aria-modal="true">
      <div class="cam-modal">
        <div class="cam-icon">⚠️</div>
        <div class="cam-tag">紧急危机预警</div>
        <h2 class="cam-title">{{ payload?.title || '紧急事件' }}</h2>
        <div class="cam-meta" v-if="payload?.studentName">
          学生：{{ payload.studentName }}
          <span v-if="payload?.kind"> · {{ kindLabel(payload.kind) }}</span>
        </div>
        <p class="cam-body">{{ payload?.body || '' }}</p>
        <button class="cam-btn" @click="$emit('acknowledge')">我已了解</button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  payload?: {
    title: string;
    body: string;
    studentName?: string;
    kind?: string;
  } | null;
}>();

defineEmits<{ (e: 'acknowledge'): void }>();

function kindLabel(k?: string): string {
  return (
    { CRISIS: '危机', RISK: '风险', SELF_INJURY: '自伤', HIGH_RISK: '高危' } as Record<string, string>
  )[k || ''] || k || '';
}
</script>

<style scoped>
.cam-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(120, 20, 10, 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cam-modal {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 20px;
  border-top: 8px solid #e74c3c;
  padding: 28px 26px 24px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  animation: cam-pop 0.28s ease;
}
@keyframes cam-pop {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.cam-icon { font-size: 44px; }
.cam-tag {
  display: inline-block;
  margin: 8px 0 4px;
  background: #fdeaea;
  color: #e74c3c;
  font-size: 12px;
  font-weight: 700;
  border-radius: 10px;
  padding: 2px 12px;
}
.cam-title {
  font-size: 22px;
  font-weight: 800;
  color: #c0392b;
  margin: 6px 0 8px;
}
.cam-meta { font-size: 13px; color: #777; margin-bottom: 10px; }
.cam-body {
  font-size: 15px;
  line-height: 1.8;
  color: #333;
  background: #fff7f6;
  border: 1px solid #f6d6d2;
  border-radius: 12px;
  padding: 12px 14px;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 18px;
}
.cam-btn {
  width: 100%;
  min-height: 52px;
  border: none;
  border-radius: 14px;
  background: #e74c3c;
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
}
.cam-btn:active { transform: scale(0.98); }

.cm-fade-enter-active,
.cm-fade-leave-active { transition: opacity 0.2s ease; }
.cm-fade-enter-from,
.cm-fade-leave-to { opacity: 0; }
</style>

<template>
  <div class="toast-host" aria-live="polite">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.type"
        @click="dismiss(t.id)"
      >
        <span class="ico">{{ icon(t.type) }}</span>
        <span class="msg">{{ t.msg }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { useToast, type ToastItem } from '@/composables/useToast';

const { toasts, dismiss } = useToast();

function icon(type: ToastItem['type']) {
  return type === 'success' ? '✓' : type === 'warn' ? '!' : type === 'error' ? '✕' : 'ℹ';
}
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  width: max-content;
  max-width: 92vw;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  backdrop-filter: blur(4px);
}
.toast .ico {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.28);
  font-weight: 800;
  flex: 0 0 auto;
}
.toast.info { background: linear-gradient(135deg, #54a0ff, #3b82f6); }
.toast.success { background: linear-gradient(135deg, #2ecc71, #27ae60); }
.toast.warn { background: linear-gradient(135deg, #f1c40f, #e0a800); color: #4a3a00; }
.toast.warn .ico { background: rgba(0, 0, 0, 0.12); }
.toast.error { background: linear-gradient(135deg, #ff7a59, #e8675f); }

.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

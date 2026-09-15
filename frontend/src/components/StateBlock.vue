<template>
  <div class="state-block" :class="state">
    <div v-if="state === 'loading'" class="sb-loading">
      <span class="spinner"></span>
      <p>{{ loadingText }}</p>
    </div>

    <div v-else-if="state === 'empty'" class="sb-empty">
      <div class="sb-emoji">🗂️</div>
      <p>{{ emptyText }}</p>
      <slot name="empty-action" />
    </div>

    <div v-else-if="state === 'error'" class="sb-error">
      <div class="sb-emoji">⚠️</div>
      <p>{{ errorText || '加载失败，请稍后再试' }}</p>
      <button class="sb-retry" @click="$emit('retry')">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  state: 'loading' | 'empty' | 'error' | 'ready';
  loadingText?: string;
  emptyText?: string;
  errorText?: string;
}>();

defineEmits<{ (e: 'retry'): void }>();
</script>

<style scoped>
.state-block {
  padding: 48px 20px;
  text-align: center;
  color: var(--color-text-soft);
}
.sb-emoji {
  font-size: 44px;
  margin-bottom: 10px;
}
.state-block p {
  font-size: 16px;
  margin: 0;
}
.sb-loading .spinner {
  display: inline-block;
  width: 34px;
  height: 34px;
  border: 4px solid #ffe3c9;
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin-bottom: 12px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.sb-error .sb-emoji {
  color: var(--color-danger);
}
.sb-retry {
  margin-top: 14px;
  border: 2px solid var(--color-primary);
  background: #fff;
  color: var(--color-primary-dark);
  border-radius: 12px;
  padding: 8px 22px;
  font-weight: 700;
  cursor: pointer;
}
</style>

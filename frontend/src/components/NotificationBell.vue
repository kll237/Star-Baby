<template>
  <div class="nb">
    <button class="nb-bell" @click.stop="toggle" :title="unread > 0 ? `你有 ${unread} 条未读通知` : '通知'">
      🔔
      <span v-if="unread > 0" class="nb-dot">{{ unread > 99 ? '99+' : unread }}</span>
    </button>

    <div v-if="open" class="nb-panel" @click.stop>
      <div class="nb-head">
        <span>通知中心</span>
        <button class="nb-link" :disabled="unread === 0" @click="markAll">全部已读</button>
      </div>
      <div v-if="loading" class="nb-hint">加载中…</div>
      <div v-else-if="items.length === 0" class="nb-empty">暂时没有通知 🎉</div>
      <ul v-else class="nb-list">
        <li
          v-for="n in items"
          :key="n.id"
          class="nb-item"
          :class="{ unread: !n.read }"
          @click="readOne(n)"
        >
          <div class="nb-item-top">
            <span class="nb-title">{{ n.title }}</span>
            <span class="nb-time">{{ fmt(n.createdAt) }}</span>
          </div>
          <div class="nb-body">{{ n.body }}</div>
          <span v-if="!n.read" class="nb-badge">未读</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import api from '@/api';
import type { AppNotification } from '@/api/types';
import { useNotifyStore } from '@/store/notify';

const open = ref(false);
const loading = ref(false);
const items = ref<AppNotification[]>([]);
const unread = ref(0);
const notify = useNotifyStore();

// 收到任意告警时刷新未读红点（如危机短信/邮件触达后）
watch(
  () => notify.lastAlertAt,
  () => {
    loadUnread();
    if (open.value) refresh();
  },
);

async function refresh() {
  try {
    const res = await api.myNotifications();
    items.value = res.data;
    unread.value = res.data.filter((n) => !n.read).length;
  } catch (e) {
    console.warn('通知加载失败', e);
  }
}

async function loadUnread() {
  try {
    const res = await api.myNotifications(true);
    unread.value = res.data.length;
  } catch {
    /* ignore */
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value) refresh();
}

async function readOne(n: AppNotification) {
  if (n.read) return;
  try {
    await api.markNotificationRead(n.id);
    n.read = true;
    unread.value = Math.max(0, unread.value - 1);
  } catch (e) {
    console.warn('标记已读失败', e);
  }
}

async function markAll() {
  for (const n of items.value) {
    if (!n.read) {
      try {
        await api.markNotificationRead(n.id);
        n.read = true;
      } catch {
        /* ignore */
      }
    }
  }
  unread.value = 0;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function onDocClick() {
  if (open.value) open.value = false;
}

onMounted(() => {
  loadUnread();
  document.addEventListener('click', onDocClick);
});
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

// 暴露给父组件主动刷新（如处理完安全事件后）
defineExpose({ refresh, loadUnread });
</script>

<style scoped>
.nb {
  position: relative;
  display: inline-block;
}
.nb-bell {
  position: relative;
  border: 1px solid #ffd9a8;
  background: #fff7ef;
  border-radius: 10px;
  width: 40px;
  height: 36px;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
.nb-dot {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #e74c3c;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nb-panel {
  position: absolute;
  right: 0;
  top: 44px;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #f0d3b3;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  z-index: 50;
}
.nb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #f5f0e8;
  font-weight: 600;
  font-size: 14px;
  color: #5b3a14;
}
.nb-link {
  border: none;
  background: none;
  color: #ff7a59;
  cursor: pointer;
  font-size: 12px;
}
.nb-link:disabled {
  color: #ccc;
  cursor: not-allowed;
}
.nb-hint,
.nb-empty {
  padding: 20px;
  text-align: center;
  color: #aaa;
  font-size: 13px;
}
.nb-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.nb-item {
  padding: 10px 12px;
  border-bottom: 1px solid #f7f2ea;
  cursor: pointer;
  position: relative;
}
.nb-item.unread {
  background: #fff8f2;
}
.nb-item:hover {
  background: #fff1e6;
}
.nb-item-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.nb-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.nb-time {
  font-size: 11px;
  color: #aaa;
  flex-shrink: 0;
}
.nb-body {
  font-size: 12px;
  color: #777;
  margin-top: 4px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.nb-badge {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 10px;
  color: #e74c3c;
  background: #fdeaea;
  border-radius: 8px;
  padding: 1px 6px;
}
</style>

<template>
  <nav class="mb-tabbar">
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="{ name: item.to }"
      class="mb-tab"
      :class="{ active: $route.name === item.to }"
    >
      <span class="mb-ico">{{ item.icon }}</span>
      <span class="mb-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
const items = [
  { to: 'student-dashboard', icon: '📷', label: '情绪检测' },
  { to: 'student-comfort', icon: '💬', label: '和星宝聊' },
  { to: 'deskpet', icon: '🐾', label: '桌面星宝' },
];
</script>

<style scoped>
.mb-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 8000;
  display: none; /* 仅在窄屏显示，见媒体查询 */
  justify-content: space-around;
  align-items: center;
  height: 60px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.mb-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-decoration: none;
  color: #9aa3ad;
  font-size: 12px;
}
.mb-tab.active {
  color: var(--color-primary-dark);
}
.mb-ico {
  font-size: 22px;
}
@media (max-width: 720px) {
  .mb-tabbar {
    display: flex;
  }
}
</style>

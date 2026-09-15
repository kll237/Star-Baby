<template>
  <router-view />
  <ToastHost />
  <AppearanceControl />
  <CrisisAlertModal
    :visible="!!notify.latestEmergency"
    :payload="notify.latestEmergency"
    @acknowledge="notify.acknowledge()"
  />
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import ToastHost from '@/components/ToastHost.vue';
import AppearanceControl from '@/components/AppearanceControl.vue';
import CrisisAlertModal from '@/components/CrisisAlertModal.vue';
import { useAuthStore } from '@/store/auth';
import { useNotifyStore } from '@/store/notify';
import { useToast } from '@/composables/useToast';
import { connectAlerts, disconnectAlerts } from '@/utils/alerts';

const auth = useAuthStore();
const notify = useNotifyStore();
const toast = useToast();

onMounted(() => {
  if (auth.token) connectAlerts(auth.token);
});

// 登录态变化：登录后连接，登出后断开并清空告警
watch(
  () => auth.token,
  (token, old) => {
    if (token && token !== old) connectAlerts(token);
    if (!token) {
      disconnectAlerts();
      notify.clear();
    }
  },
);

// 非紧急告警（危机 / 风险）以非阻塞 toast 提示
watch(
  () => notify.latestCrisis,
  (p) => {
    if (p) toast.error(`危机预警 · ${p.studentName || ''}：${p.title}`);
  },
);
watch(
  () => notify.latestRisk,
  (p) => {
    if (p) toast.warn(`风险提示 · ${p.studentName || ''}：${p.title}`);
  },
);
</script>

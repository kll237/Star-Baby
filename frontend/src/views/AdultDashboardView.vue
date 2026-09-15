<template>
  <div class="adult-with-bg" :style="{ backgroundImage: `url(${bgUrl})` }">
    <div class="adult-bg-overlay"></div>
    <div style="max-width: 960px; margin: 0 auto; padding: 24px; position: relative; z-index: 1">
      <div class="card adult-head" style="margin-bottom: 18px; position: relative; z-index: 2; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(8px); border-radius: 14px; padding: 16px 20px">
        <div class="row" style="justify-content: space-between; align-items: center">
          <div>
            <h1 class="title" style="margin: 0">家长 / 教师工作台</h1>
            <p class="subtitle" style="margin: 4px 0 0">
              欢迎，{{ auth.user?.nickname || '用户' }}（{{ auth.role === 'PARENT' ? '家长' : '教师' }}）
            </p>
          </div>
          <div class="row" style="flex-wrap: wrap">
            <button class="btn ghost" style="min-height: 44px" @click="router.push('/students')">我的学生</button>
            <button class="btn ghost" style="min-height: 44px" @click="router.push('/parent/dashboard')">数据看板</button>
            <button class="btn ghost" style="min-height: 44px" @click="router.push('/parent/advice')">专业建议</button>
            <button class="btn ghost" style="min-height: 44px" @click="router.push('/deskpet')">桌面星宝</button>
            <NotificationBell />
            <button class="btn ghost" style="min-height: 44px" @click="auth.logout(); router.push('/login')">退出</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px; position: relative; z-index: 1; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(6px)">
        <h2 style="margin-top: 0">阶段一已完成 ✅</h2>
        <p class="hint">双端用户体系：注册 / 登录 / 人脸注册 / 1:N 人脸识别登录 / 短信验证 / 登录锁定。</p>
      </div>

      <div class="card" style="margin-bottom: 16px; background: rgba(243, 248, 255, 0.92); position: relative; z-index: 1; backdrop-filter: blur(6px)">
        <h2 style="margin-top: 0">阶段进度</h2>
        <ul class="hint" style="line-height: 1.9">
          <li>阶段一～四：双端用户体系 / 实时检测 / 智能聊天安抚 / 数据看板与报告 ✅</li>
          <li>阶段五：专业心理建议引擎与知识库（≥200 条循证知识 / 画像驱动建议生成）✅ <router-link to="/parent/advice">进入</router-link></li>
          <li>阶段六：桌宠硬件接口与虚拟桌宠</li>
          <li>阶段七：部署优化 / 安全加固 / 性能测试</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/store/auth';
import NotificationBell from '@/components/NotificationBell.vue';

const router = useRouter();
const auth = useAuthStore();
// 背景图（用户上传素材）
const bgUrl = '/backgrounds/bg-workbench.jpg';
</script>

<style scoped>
.adult-with-bg {
  position: relative;
  min-height: 100vh;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
.adult-bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg,
      rgba(255, 240, 235, 0.35) 0%,
      rgba(255, 230, 245, 0.25) 40%,
      rgba(220, 200, 240, 0.30) 100%);
}
</style>

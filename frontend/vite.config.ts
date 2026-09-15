import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // 该环境沙箱会拦截 dist 目录删除（safe-delete），故关闭 outDir 清空，改为原地覆盖
  build: {
    outDir: 'dist_tmp2',
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期将 API 请求代理到后端（后端已启用全局 /api 前缀，故不重写路径）
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
      // 实时检测 WebSocket（命名空间 /detection）
      '/detection': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      // 桌宠 WebSocket 网关（命名空间 /deskpet）
      '/deskpet': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

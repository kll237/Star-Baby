<template>
  <div class="ac-root">
    <button class="ac-fab" :title="open ? '收起外观设置' : '外观与无障碍设置'" @click="open = !open">
      <span v-if="!open">⚙</span>
      <span v-else>✕</span>
    </button>

    <transition name="ac-panel">
      <div v-if="open" class="ac-panel" role="dialog" aria-label="外观与无障碍设置">
        <div class="ac-title">外观 / 无障碍</div>

        <div class="ac-row">
          <label>背景强度</label>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            :value="a.intensity"
            :disabled="a.simpleMode"
            @input="onIntensity($event)"
          />
          <span class="ac-val">{{ a.simpleMode ? '简洁' : a.intensity + '%' }}</span>
        </div>

        <div class="ac-row">
          <label>简洁模式</label>
          <button class="ac-switch" :class="{ on: a.simpleMode }" @click="toggleSimple">
            <span class="knob"></span>
          </button>
        </div>

        <div class="ac-row">
          <label>减少动效</label>
          <button class="ac-switch" :class="{ on: a.reducedMotion }" @click="toggleMotion">
            <span class="knob"></span>
          </button>
        </div>

        <p class="ac-hint">背景只作装饰，不会遮挡任何功能区域。</p>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAppearance } from '@/composables/useAppearance';

const a = useAppearance();
const open = ref(false);

function onIntensity(e: Event) {
  a.intensity = Number((e.target as HTMLInputElement).value);
}
function toggleSimple() {
  a.simpleMode = !a.simpleMode;
}
function toggleMotion() {
  a.reducedMotion = !a.reducedMotion;
}
</script>

<style scoped>
.ac-root {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.ac-fab {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 22px rgba(255, 159, 67, 0.35);
  font-size: 24px;
  cursor: pointer;
  color: #f08a1d;
}
.ac-fab:active {
  transform: scale(0.94);
}
.ac-panel {
  width: 260px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 16px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.22);
  padding: 16px 18px;
  backdrop-filter: blur(8px);
}
.ac-title {
  font-weight: 800;
  font-size: 16px;
  margin-bottom: 12px;
  color: #34495e;
}
.ac-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
}
.ac-row label {
  flex: 0 0 72px;
  font-size: 14px;
  font-weight: 600;
  color: #555;
}
.ac-row input[type='range'] {
  flex: 1;
  accent-color: #ff9f43;
}
.ac-val {
  flex: 0 0 44px;
  text-align: right;
  font-size: 13px;
  color: #888;
}
.ac-switch {
  width: 46px;
  height: 26px;
  border-radius: 999px;
  border: none;
  background: #d8d8d8;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  flex: 0 0 auto;
}
.ac-switch.on {
  background: #2ecc71;
}
.ac-switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.2s;
}
.ac-switch.on .knob {
  left: 23px;
}
.ac-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #9aa3ad;
  line-height: 1.5;
}
.ac-panel-enter-active,
.ac-panel-leave-active {
  transition: all 0.22s ease;
}
.ac-panel-enter-from,
.ac-panel-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>

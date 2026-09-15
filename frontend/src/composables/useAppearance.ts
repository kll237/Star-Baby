import { reactive, watch } from 'vue';

/**
 * 全局外观设置（单例）：
 * - intensity：背景强度 0~100（100=原图全显，0=几乎被纯色蒙层盖住）
 * - simpleMode：简洁模式（一键把背景压到很淡，降低视觉干扰，适合低光/敏感用户）
 * - reducedMotion：减少动效（无障碍，呼应 global.css 的 .reduced-motion）
 * 三者持久化到 localStorage，并在 <html> 上挂 class / CSS 变量，由 global.css 的
 * `html.bg-adjusted ...` 规则统一接管各页面背景蒙层。
 */

const KEY = 'sp_appearance';

const state = reactive({
  intensity: 100,
  simpleMode: false,
  reducedMotion: false,
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof saved.intensity === 'number') state.intensity = saved.intensity;
    if (typeof saved.simpleMode === 'boolean') state.simpleMode = saved.simpleMode;
    if (typeof saved.reducedMotion === 'boolean') state.reducedMotion = saved.reducedMotion;
  } catch {
    /* ignore */
  }
}

function apply() {
  const root = document.documentElement;
  root.classList.toggle('reduced-motion', state.reducedMotion);

  const adjusted = state.simpleMode || state.intensity < 100;
  root.classList.toggle('bg-adjusted', adjusted);

  // simpleMode 强制把背景压淡；否则按滑块比例
  const t = state.simpleMode ? 0.2 : state.intensity / 100; // 1 全显 .. 0.2 很淡
  const alpha = (0.8 - 0.5 * t).toFixed(3); // intensity100 -> 0.30, simple/0 -> 0.70
  root.style.setProperty('--bg-overlay-alpha', alpha);
}

function persist() {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      intensity: state.intensity,
      simpleMode: state.simpleMode,
      reducedMotion: state.reducedMotion,
    }),
  );
}

load();
apply();

watch(state, () => {
  apply();
  persist();
}, { deep: true });

export function useAppearance() {
  return state;
}

import { reactive } from 'vue';

/** 全局轻提示（Toast）单例队列 */
export interface ToastItem {
  id: number;
  msg: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

const toasts = reactive<ToastItem[]>([]);
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function push(msg: string, type: ToastItem['type'] = 'info', timeout = 2600): number {
  const id = ++seq;
  toasts.push({ id, msg, type });
  timers.set(
    id,
    setTimeout(() => dismiss(id), type === 'error' ? 3800 : timeout),
  );
  return id;
}

export function useToast() {
  return {
    toasts,
    dismiss,
    push,
    info: (m: string) => push(m, 'info'),
    success: (m: string) => push(m, 'success'),
    warn: (m: string) => push(m, 'warn'),
    error: (m: string) => push(m, 'error'),
  };
}

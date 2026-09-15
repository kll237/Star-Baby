/**
 * 特征 5：降低摄像头依赖 + 明确「本地优先」隐私承诺。
 * - 提供「纯行为/定时抽样」模式：不开摄像头，仅按固定间隔记录在场与行为（降低设备与隐私门槛）。
 * - 明确数据最小化、本地优先、不出本机的承诺文案（也写入 README 与产品说明）。
 */

export const PRIVACY_PROMISE = {
  title: '数据本地优先 · 最小化 · 不出本机',
  points: [
    '所有情绪与行为识别均在本机浏览器/本机服务完成，视频流不离开这台设备。',
    '只采集「情绪评分」与「行为标签」这类最小必要数据，不保存任何原始人脸画面。',
    'Redis 不可用时自动降级为本地内存，不会把数据外发到第三方。',
    '家长/老师可随时切换「纯行为模式」，完全不使用摄像头。',
    '账号与数据归创建者所有，可随时导出或删除。',
  ],
};

const NO_CAM_MODE_KEY = 'sp_no_camera_mode';

export function getNoCameraMode(): boolean {
  try {
    return localStorage.getItem(NO_CAM_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNoCameraMode(on: boolean): void {
  localStorage.setItem(NO_CAM_MODE_KEY, on ? '1' : '0');
}

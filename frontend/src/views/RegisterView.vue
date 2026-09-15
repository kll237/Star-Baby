<template>
  <div class="center-screen">
    <div class="card" style="width: 460px; max-width: 100%">
      <h1 class="title">注册家长 / 教师账号</h1>
      <p class="subtitle">账号唯一，密码加密存储，手机需短信验证</p>

      <div class="label">昵称</div>
      <input v-model="form.nickname" class="input" placeholder="如：小明妈妈" />

      <div class="label" style="margin-top: 12px">登录账号</div>
      <input v-model="form.account" class="input" placeholder="字母/数字，4-32 位" />

      <div class="label" style="margin-top: 12px">密码</div>
      <input v-model="form.password" type="password" class="input" placeholder="至少 8 位" />

      <div class="label" style="margin-top: 12px">邮箱</div>
      <input v-model="form.email" class="input" placeholder="用于危机触达与账号找回" />
      <p v-if="errors.email" class="err">{{ errors.email }}</p>

      <div class="label" style="margin-top: 12px">手机号</div>
      <div class="row">
        <input v-model="form.phone" class="input" style="flex: 1" placeholder="11 位手机号" />
        <button class="btn secondary" style="min-height: 52px" :disabled="smsLoading" @click="sendSms">
          {{ smsText }}
        </button>
      </div>

      <div class="label" style="margin-top: 12px">短信验证码</div>
      <input v-model="form.smsCode" class="input" placeholder="6 位验证码" />
      <p v-if="devCode" class="hint">（开发模式验证码：{{ devCode }}）</p>

      <div class="label" style="margin-top: 12px">我是</div>
      <div class="row">
        <button class="btn ghost" :class="{ 'btn--active': form.role === 'PARENT' }" @click="form.role = 'PARENT'">
          👪 家长
        </button>
        <button class="btn ghost" :class="{ 'btn--active': form.role === 'TEACHER' }" @click="form.role = 'TEACHER'">
          🧑‍🏫 教师
        </button>
      </div>

      <!-- 隐私协议（必须展开并滚动到底方可勾选） -->
      <div class="privacy">
        <button class="privacy-toggle" :class="{ open: privacyExpanded }" @click="togglePrivacy">
          <span>📄 《星宝守护儿童心理健康服务隐私协议》</span>
          <span class="caret">{{ privacyExpanded ? '▲ 收起' : '▼ 展开' }}</span>
        </button>
        <div v-show="privacyExpanded" ref="agreementBox" class="privacy-text" @scroll="onAgreementScroll">
          <h3>一、前言</h3>
          <p>「星宝守护」是一款面向特殊需要儿童（如孤独症、多动症、情绪障碍等）及其家长 / 教师情绪与行为监测、安抚与干预的辅助工具。我们深知未成年人心理健康数据的高度敏感性，本着「最小必要、监护人知情同意、可撤回」的原则制定本协议，请您（作为儿童的法定监护人或授权照护者）在注册前仔细阅读并充分理解。</p>

          <h3>二、我们收集的数据</h3>
          <p>为向您提供情绪识别、风险预警与安抚服务，在您及儿童授权范围内，我们可能收集以下数据：</p>
          <ul>
            <li>账号信息：登录账号、昵称、密码（加密存储）、手机号、邮箱；</li>
            <li>儿童基础画像：年龄、性别、健康状况类型与程度、症状、喜好、擅长与需要回避的事项（由监护人填写，用于针对性安抚）；</li>
            <li>情绪与行为数据：通过摄像头 / 上传视频采集的面部表情、情绪评分、行为事件及对应时间戳；</li>
            <li>对话内容：儿童与「星宝」安抚对话的文本记录（用于危机识别与后续干预分析）；</li>
            <li>设备与日志：用于问题排查的必要运行日志。</li>
          </ul>
          <p>我们仅收集实现服务目的所必需的数据，不收集与服务无关的敏感信息。</p>

          <h3>三、监护人同意与未成年人保护</h3>
          <p>本服务的使用以监护人明确知情同意为前提。您确认：您是该儿童的法定监护人或已获监护人授权，有权代表其作出数据处理同意。当儿童达到可理解年龄时，我们建议由监护人陪同其了解本服务。任何涉及儿童的数据处理，均以「有利于儿童最大利益」为准则。</p>

          <h3>四、危机升级与触达方式</h3>
          <p>当系统识别到儿童可能处于自伤、伤人等高危状态时，将触发危机升级流程，并依据您在系统中登记的联系方式，通过以下渠道向监护人触达预警：</p>
          <ul>
            <li>短信（SMS）：向您预留的手机号发送紧急提醒；</li>
            <li>电子邮件：向您预留的邮箱发送详细说明与处置建议；</li>
            <li>站内信 / App 推送：在应用内展示紧急告警，并标记未读红点。</li>
          </ul>
          <p>上述触达可能需要调用第三方短信 / 邮件服务商。请您确保预留的手机号与邮箱真实有效，以便在第一时间接收预警。</p>

          <h3>五、数据存储与保留</h3>
          <p>我们将采用加密传输与存储措施保护您的数据。情绪 / 行为监测数据默认保留不超过 24 个月；达到保留期限或您撤回同意后，我们将在合理期限内对数据进行匿名化或删除，法律法规另有规定的除外。</p>

          <h3>六、同意的撤回</h3>
          <p>您有权随时撤回对本协议的同意。撤回同意后，我们将停止基于同意的处理活动（如继续情绪监测与危机触达），但撤回前已进行的、为儿童安全所必需的处理不受影响。您可在「知情同意」管理页一键撤回或重新签署。</p>

          <h3>七、第三方处理者</h3>
          <p>为提供短信、邮件、语音合成（TTS）、人脸识别等能力，我们可能将必要数据（如手机号、邮箱、音频文本）提供给相应的第三方服务提供商。我们仅与其共享实现功能所需的最小数据，并通过协议要求其履行同等水平的保密与安全义务。</p>

          <h3>八、您的权利</h3>
          <p>在法律允许范围内，您有权查询、更正、复制、删除您的个人信息，并有权注销账号。如需帮助，可通过应用内反馈或客服渠道联系我们。</p>

          <h3>九、协议版本</h3>
          <p>本协议版本为 v1.0。我们可能因法律法规或服务调整更新本协议，更新后将再次征得您的同意。勾选下方「我已阅读并同意」，即表示您理解并同意上述全部内容（版本 v1.0）。</p>
          <p class="privacy-end">——— 协议正文结束，感谢您的阅读 ———</p>
        </div>
        <p v-if="privacyExpanded && !privacyRead" class="privacy-tip">请滚动阅读至协议底部，方可勾选同意。</p>
        <label class="privacy-check" :class="{ disabled: !privacyExpanded || !privacyRead }">
          <input type="checkbox" v-model="form.privacyConsent" :disabled="!privacyExpanded || !privacyRead" />
          我已完整阅读并同意《星宝守护儿童心理健康服务隐私协议》（v1.0）
        </label>
        <p v-if="errors.privacy" class="err">{{ errors.privacy }}</p>
      </div>

    <button class="btn" style="width: 100%; margin-top: 20px" :disabled="loading" @click="submit">
      {{ loading ? '注册中…' : '注册' }}
    </button>
    <p v-if="ok" class="hint" style="text-align:center;color:#3aa757">
      注册成功，正在进入「关联学生」…
    </p>
    <button class="btn ghost" style="width: 100%; margin-top: 12px; min-height: 44px; font-size: 16px" @click="router.push('/login')">
      返回登录
    </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const form = reactive({
  nickname: '',
  account: '',
  password: '',
  email: '',
  phone: '',
  smsCode: '',
  role: 'PARENT' as 'PARENT' | 'TEACHER',
  privacyConsent: false,
  privacyVersion: '1.0',
});
const loading = ref(false);
const smsLoading = ref(false);
const smsText = ref('获取验证码');
const devCode = ref('');
const ok = ref(false);
const errors = reactive<{ email: string; privacy: string }>({ email: '', privacy: '' });

// 隐私协议：展开 + 滚动到底才允许勾选
const privacyExpanded = ref(false);
const privacyRead = ref(false);
const agreementBox = ref<HTMLElement | null>(null);

function onAgreementScroll() {
  const el = agreementBox.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
    privacyRead.value = true;
  }
}

async function togglePrivacy() {
  privacyExpanded.value = !privacyExpanded.value;
  if (!privacyExpanded.value) return;
  // 兜底：若协议容器未产生滚动条（大屏 / 极小字号 / 浏览器缩放），
  // scroll 事件永远不会触发，会导致用户永久无法勾选同意。此时视为已完整可见。
  await nextTick();
  const el = agreementBox.value;
  if (el && el.scrollHeight <= el.clientHeight + 4) {
    privacyRead.value = true;
  }
}

async function sendSms() {
  if (!/^1[3-9]\d{9}$/.test(form.phone)) {
    toast.warn('请输入正确的手机号');
    return;
  }
  smsLoading.value = true;
  try {
    const { data } = await api.sendSms(form.phone, 'REGISTER');
    devCode.value = data.devCode || '';
    smsText.value = '已发送';
    toast.success('验证码已发送' + (data.devCode ? `（开发码：${data.devCode}）` : ''));
  } catch (e: any) {
    toast.error(e?.response?.data?.message || '发送失败');
  } finally {
    smsLoading.value = false;
  }
}

async function submit() {
  ok.value = false;
  errors.email = '';
  errors.privacy = '';

  // 邮箱校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = '请输入有效的邮箱地址';
  }
  // 隐私协议校验
  if (!form.privacyConsent) {
    errors.privacy = '请先展开并阅读《隐私协议》，勾选同意后方可注册';
  }
  if (errors.email || errors.privacy) {
    toast.warn('请检查表单填写');
    return;
  }

  loading.value = true;
  try {
    const { data } = await api.register({ ...form });
    // 注册即登录，直接进入「关联学生」流程
    auth.setSession(data.tokens, data.user);
    ok.value = true;
    toast.success('注册成功');
    setTimeout(() => router.push('/students/associate'), 600);
  } catch (e: any) {
    toast.error(e?.response?.data?.message || '注册失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.btn--active {
  border-color: var(--color-primary-dark);
  background: #fff3e6;
}
.privacy {
  margin-top: 18px;
  border: 1px solid #ffe3c9;
  border-radius: 14px;
  background: #fffdfb;
  overflow: hidden;
}
.privacy-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  background: #fff7ef;
  border: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: #5b3a14;
  text-align: left;
}
.privacy-toggle .caret {
  font-size: 12px;
  color: var(--color-primary-dark);
  flex-shrink: 0;
}
.privacy-text {
  max-height: 240px;
  overflow-y: auto;
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.8;
  color: #555;
  background: #fff;
}
.privacy-text h3 {
  font-size: 14px;
  color: #5b3a14;
  margin: 14px 0 6px;
}
.privacy-text h3:first-child {
  margin-top: 0;
}
.privacy-text p,
.privacy-text ul {
  margin: 6px 0;
}
.privacy-text ul {
  padding-left: 18px;
}
.privacy-end {
  text-align: center;
  color: #bbb;
  margin-top: 16px;
}
.privacy-tip {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: #e67e22;
  background: #fff8f1;
}
.privacy-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  font-size: 13px;
  color: #444;
  cursor: pointer;
}
.privacy-check.disabled {
  color: #bbb;
  cursor: not-allowed;
}
.privacy-check input {
  margin-top: 2px;
  flex-shrink: 0;
}
</style>

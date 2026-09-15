<template>
  <div class="profile-fields">
    <div class="row-2">
      <div>
        <div class="label">基础状况（病情类型）</div>
        <select v-model="form.conditionType" class="input" @change="emitAll">
          <option v-for="c in CONDITION_TYPES" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div>
        <div class="label">程度</div>
        <select v-model="form.conditionSeverity" class="input" @change="emitAll">
          <option v-for="s in CONDITION_SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
    </div>

    <div class="label" style="margin-top: 12px">其他特殊症状</div>
    <TagInput :model-value="form.symptoms || []" placeholder="如：易焦虑、睡眠不好，回车添加" @update:model-value="set('symptoms', $event)" />

    <div class="label" style="margin-top: 12px">喜欢什么</div>
    <TagInput :model-value="form.likes || []" placeholder="如：恐龙、草莓，回车添加" @update:model-value="set('likes', $event)" />

    <div class="label" style="margin-top: 12px">爱好什么</div>
    <TagInput :model-value="form.hobbies || []" placeholder="如：画画、拼图，回车添加" @update:model-value="set('hobbies', $event)" />

    <div class="label" style="margin-top: 12px">擅长什么</div>
    <TagInput :model-value="form.strengths || []" placeholder="如：记数字、跑步，回车添加" @update:model-value="set('strengths', $event)" />

    <div class="label" style="margin-top: 12px">不喜欢什么</div>
    <TagInput :model-value="form.dislikes || []" placeholder="如：吵闹、打针，回车添加" @update:model-value="set('dislikes', $event)" />

    <div class="label" style="margin-top: 12px">补充说明</div>
    <textarea v-model="form.notes" class="input" rows="2" placeholder="其他需要星宝知道的信息" @input="emitAll"></textarea>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import TagInput from './TagInput.vue';
import { CONDITION_TYPES, CONDITION_SEVERITIES, type ProfilePayload } from '@/api/types';

const props = defineProps<{ modelValue: ProfilePayload }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: ProfilePayload): void }>();

function clone(v: ProfilePayload): ProfilePayload {
  return {
    conditionType: v.conditionType ?? '其他',
    conditionSeverity: v.conditionSeverity ?? '未知',
    symptoms: [...(v.symptoms || [])],
    likes: [...(v.likes || [])],
    hobbies: [...(v.hobbies || [])],
    strengths: [...(v.strengths || [])],
    dislikes: [...(v.dislikes || [])],
    notes: v.notes ?? '',
  };
}

const form = reactive<ProfilePayload>(clone(props.modelValue));

watch(
  () => props.modelValue,
  (v) => Object.assign(form, clone(v)),
  { deep: true },
);

function set(key: keyof ProfilePayload, val: string[]) {
  (form as any)[key] = val;
  emitAll();
}
function emitAll() {
  emit('update:modelValue', {
    conditionType: form.conditionType,
    conditionSeverity: form.conditionSeverity,
    symptoms: [...(form.symptoms || [])],
    likes: [...(form.likes || [])],
    hobbies: [...(form.hobbies || [])],
    strengths: [...(form.strengths || [])],
    dislikes: [...(form.dislikes || [])],
    notes: form.notes || '',
  });
}
</script>

<style scoped>
.label {
  font-size: 13px;
  color: var(--color-text-soft);
  margin-bottom: 4px;
}
.input {
  width: 100%;
  border: 1px solid #f0d3b3;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  background: #fff;
  resize: vertical;
}
.input:focus {
  border-color: #ff9e57;
}
.row-2 {
  display: flex;
  gap: 12px;
}
.row-2 > div {
  flex: 1;
}
</style>

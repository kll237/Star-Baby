<template>
  <div class="tag-input">
    <span v-for="(t, i) in modelValue" :key="i" class="chip">
      {{ t }}
      <button type="button" class="chip-x" @click="remove(i)" aria-label="删除">×</button>
    </span>
    <input
      class="tag-box"
      :placeholder="placeholder"
      v-model="draft"
      @keydown.enter.prevent="add"
      @keydown.comma.prevent="add"
      @blur="add"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string[]; placeholder?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>();
const draft = ref('');

function sync(next: string[]) {
  emit('update:modelValue', next);
}
function add() {
  const v = draft.value.trim().replace(/,$/, '').trim();
  if (!v) return;
  if (!props.modelValue.includes(v)) sync([...props.modelValue, v]);
  draft.value = '';
}
function remove(i: number) {
  sync(props.modelValue.filter((_, idx) => idx !== i));
}
</script>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  border: 1px solid #f0d3b3;
  border-radius: 12px;
  padding: 8px 10px;
  min-height: 44px;
  background: #fff;
}
.tag-input:focus-within {
  border-color: #ff9e57;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fff0df;
  color: #9a5a1f;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 13px;
}
.chip-x {
  border: none;
  background: transparent;
  color: #9a5a1f;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0 2px;
}
.tag-box {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  background: transparent;
}
</style>

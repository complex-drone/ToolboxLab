<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { formatBytes } from '@/utils/format'

/**
 * 通用文件拖拽上传区：支持拖拽与点击选择
 */
const props = defineProps({
  /** 接受的文件类型，如 "image/*" 或 ".pdf,.txt" */
  accept: { type: String, default: '' },
  /** 是否允许多选 */
  multiple: { type: Boolean, default: false },
  /** 单文件大小上限（MB） */
  maxSizeMB: { type: Number, default: 20 },
  /** 自定义提示文案（已翻译），缺省用公共文案 */
  hint: { type: String, default: '' },
})

const emit = defineEmits(['files', 'error'])

const { t } = useI18n()
const toast = useToast()

const dragging = ref(false)
const inputRef = ref(null)

const maxSizeLabel = computed(() => `${props.maxSizeMB} MB`)

function validateAndEmit(fileList) {
  const files = Array.from(fileList || [])
  if (files.length === 0) return
  const valid = []
  for (const file of files) {
    if (file.size > props.maxSizeMB * 1024 * 1024) {
      toast.error(t('toolsCommon.fileTooLarge', { size: maxSizeLabel.value }))
      emit('error', { file, reason: 'too-large' })
      continue
    }
    valid.push(file)
  }
  if (valid.length > 0) {
    emit('files', props.multiple ? valid : valid[0])
  }
}

function onDrop(e) {
  dragging.value = false
  validateAndEmit(e.dataTransfer?.files)
}

function onPick(e) {
  validateAndEmit(e.target.files)
  // 允许重复选择同一文件
  e.target.value = ''
}

function openPicker() {
  inputRef.value?.click()
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ dragging }"
    role="button"
    tabindex="0"
    :aria-label="hint || t('toolsCommon.dropHint')"
    @click="openPicker"
    @keydown.enter.prevent="openPicker"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="inputRef"
      type="file"
      class="hidden"
      :accept="accept"
      :multiple="multiple"
      @change="onPick"
    />
    <div class="drop-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </div>
    <p class="drop-hint">{{ hint || t('toolsCommon.dropHint') }}</p>
    <p class="drop-limit">{{ t('toolsCommon.maxSizeHint', { size: maxSizeLabel }) }}</p>
  </div>
</template>

<style scoped>
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 28px 16px;
  border: 2px dashed rgba(148, 163, 184, 0.5);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
  outline: none;
}

.drop-zone:hover,
.drop-zone:focus-visible {
  border-color: rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.05);
}

.drop-zone.dragging {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  transform: scale(1.01);
}

.hidden {
  display: none;
}

.drop-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.1);
  margin-bottom: 4px;
}

.drop-icon svg {
  width: 22px;
  height: 22px;
}

.drop-hint {
  font-size: 14px;
  font-weight: 500;
  color: #475569;
}

.drop-limit {
  font-size: 12px;
  color: #94a3b8;
}
</style>

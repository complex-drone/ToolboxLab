<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyText } from '@/utils/clipboard'
import { useToast } from '@/composables/useToast'

/**
 * 通用复制按钮：复制指定文本并给出 Toast 反馈
 */
const props = defineProps({
  /** 要复制的文本 */
  text: { type: String, default: '' },
  /** 按钮文案（已翻译），缺省显示「复制」 */
  label: { type: String, default: '' },
  /** 是否为小尺寸图标按钮 */
  compact: { type: Boolean, default: false },
  /** 复制成功的提示文案（已翻译），缺省用公共文案 */
  successMessage: { type: String, default: '' },
  /** 是否禁用 */
  disabled: { type: Boolean, default: false },
})

const { t } = useI18n()
const toast = useToast()
const copying = ref(false)

async function handleCopy() {
  if (!props.text || copying.value) return
  copying.value = true
  try {
    const ok = await copyText(props.text)
    if (ok) {
      toast.success(props.successMessage || t('toolsCommon.copied'))
    } else {
      toast.error(t('toolsCommon.copyFailed'))
    }
  } catch {
    toast.error(t('toolsCommon.copyFailed'))
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="copy-btn"
    :class="{ compact, ghost: !compact }"
    :disabled="disabled || !text"
    :aria-label="label || t('toolsCommon.copy')"
    @click="handleCopy"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
    <span v-if="label && !compact">{{ label }}</span>
  </button>
</template>

<style scoped>
.copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
}

.copy-btn svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.copy-btn.compact {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.75);
  color: #64748b;
}

.copy-btn.compact:hover:not(:disabled) {
  border-color: rgba(59, 130, 246, 0.5);
  color: #2563eb;
  background: rgba(59, 130, 246, 0.08);
}

.copy-btn.ghost {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.75);
  color: #64748b;
}

.copy-btn.ghost:hover:not(:disabled) {
  border-color: rgba(59, 130, 246, 0.5);
  color: #2563eb;
  background: rgba(59, 130, 246, 0.08);
}

.copy-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.copy-btn:active:not(:disabled) {
  transform: scale(0.97);
}
</style>

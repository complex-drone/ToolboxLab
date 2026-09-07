<script setup>
import { reactive, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useCancellableDebounceFn } from '@/composables/useCancellableDebounceFn'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t } = useI18n()

/** 支持的进制与对应的 BigInt 前缀、语言包键 */
const BASES = [2, 8, 10, 16]
const BASE_META = {
  2: { prefix: '0b', nameKey: 'binary' },
  8: { prefix: '0o', nameKey: 'octal' },
  10: { prefix: '', nameKey: 'decimal' },
  16: { prefix: '0x', nameKey: 'hexadecimal' },
}

/** 各进制合法数字（去掉符号与分隔符后） */
const DIGIT_RE = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-f]+$/,
}

/** 显示偏好持久化 */
const config = useStorage('tool-radix-converter-config', {
  uppercaseHex: false,
  grouping: true,
})

/** 各进制输入框文本（含显示用的分组空格） */
const inputs = reactive({ 2: '0', 8: '0', 10: '0', 16: '0' })
/** 各进制的行内错误提示 */
const errors = reactive({ 2: '', 8: '', 10: '', 16: '' })
/** 当前正在编辑的进制（该输入框不回写，避免覆盖光标） */
const editingBase = ref(null)

/** 最近一次解析成功的 BigInt 值；无有效值时为 null */
let current = 0n

/** 去掉空格 / 下划线等视觉分隔符，便于解析带分组的显示文本 */
function normalize(raw) {
  return String(raw).replace(/[\s_]/g, '')
}

/**
 * 将字符串按指定进制解析为 BigInt（支持 - 前缀）
 * @returns {bigint|null} 空输入返回 null
 * @throws 字符非法或格式错误时抛出异常
 */
function parseInBase(raw, base) {
  const s = normalize(raw)
  if (s === '') return null
  const m = /^(-?)([0-9a-zA-Z]+)$/.exec(s)
  if (!m) throw new Error('format')
  const digits = m[2].toLowerCase()
  if (!DIGIT_RE[base].test(digits)) throw new Error('chars')
  const sign = m[1] === '-' ? -1n : 1n
  const prefix = BASE_META[base].prefix
  return sign * BigInt(prefix + digits)
}

/** 每 4 位插入一个空格（从右往左分组，不动符号位） */
function groupDigits(digits) {
  if (!config.value.grouping || digits.length <= 4) return digits
  return digits.replace(/\B(?=(.{4})+$)/g, ' ')
}

/** BigInt 转指定进制的显示文本（含符号、大小写、分组） */
function formatInBase(big, base) {
  const neg = big < 0n
  const abs = (neg ? -big : big).toString(base)
  const cased = base === 16 && config.value.uppercaseHex ? abs.toUpperCase() : abs
  return (neg ? '-' : '') + groupDigits(cased)
}

/** 立即以当前编辑进制为准同步其余进制 */
function syncNow() {
  const base = editingBase.value
  if (base === null) return
  let big
  try {
    big = parseInBase(inputs[base], base)
  } catch (e) {
    const baseName = t(`tools.radixConverter.${BASE_META[base].nameKey}`)
    errors[base] =
      e && e.message === 'chars'
        ? t('tools.radixConverter.invalidForBase', { base: baseName })
        : t('tools.radixConverter.invalidInput')
    return
  }
  errors[base] = ''
  if (big === null) {
    // 输入被清空：同步清空其余进制
    current = null
    for (const b of BASES) {
      if (b !== base) {
        inputs[b] = ''
        errors[b] = ''
      }
    }
    return
  }
  current = big
  for (const b of BASES) {
    if (b === base) continue
    inputs[b] = formatInBase(big, b)
    errors[b] = ''
  }
}

const debouncedSync = useCancellableDebounceFn(syncNow, 300)

function onInput(base, event) {
  editingBase.value = base
  inputs[base] = event.target.value
  errors[base] = ''
  debouncedSync()
}

/** 清空全部输入 */
function clearAll() {
  debouncedSync.cancel()
  editingBase.value = null
  current = null
  for (const b of BASES) {
    inputs[b] = ''
    errors[b] = ''
  }
}

// 显示偏好变化时，按最近有效值刷新非编辑中的输入框
watch(
  () => [config.value.uppercaseHex, config.value.grouping],
  () => {
    if (current === null) return
    for (const b of BASES) {
      if (b === editingBase.value) continue
      inputs[b] = formatInBase(current, b)
    }
  }
)

onBeforeUnmount(() => {
  debouncedSync.cancel()
})
</script>

<template>
  <ToolPage tool-id="radixConverter">
    <!-- 显示选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.options') }}</h2>
      <div class="flex flex-wrap gap-x-6 gap-y-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            v-model="config.uppercaseHex"
            type="checkbox"
            class="accent-blue-600"
          />
          {{ t('tools.radixConverter.hexCase') }}
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input v-model="config.grouping" type="checkbox" class="accent-blue-600" />
          {{ t('tools.radixConverter.grouping') }}
        </label>
      </div>
    </section>

    <!-- 四进制同步输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.radixConverter.converter') }}</h2>
        <button type="button" class="btn-ghost" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="space-y-4">
        <div v-for="b in BASES" :key="b">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <span class="chip">
              {{ t(`tools.radixConverter.${BASE_META[b].nameKey}`) }}
              <span class="font-mono text-xs text-slate-400">· {{ b }}</span>
            </span>
            <CopyButton :text="inputs[b]" compact :disabled="!inputs[b]" />
          </div>
          <input
            :value="inputs[b]"
            type="text"
            class="input-base w-full font-mono"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            :aria-label="t(`tools.radixConverter.${BASE_META[b].nameKey}`)"
            :placeholder="t('tools.radixConverter.placeholder', { base: t(`tools.radixConverter.${BASE_META[b].nameKey}`) })"
            @input="onInput(b, $event)"
          />
          <p v-if="errors[b]" class="mt-1 text-sm text-red-600">{{ errors[b] }}</p>
        </div>
      </div>

      <p class="mt-4 text-xs text-slate-400">
        {{ t('tools.radixConverter.negativeHint') }}
      </p>
    </section>
  </ToolPage>
</template>

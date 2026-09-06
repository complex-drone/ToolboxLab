<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { clampInt } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { randomInt } from '@/utils/random'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/** 类型 / 数量 / 长度 / 分隔符 持久化 */
const config = useStorage('tool-uuid-generator-config', {
  type: 'v4',
  count: 5,
  nanoLength: 21,
  separator: 'newline',
})

const TYPES = [
  { value: 'v4', labelKey: 'typeV4', descKey: 'v4Desc' },
  { value: 'v7', labelKey: 'typeV7', descKey: 'v7Desc' },
  { value: 'nanoid', labelKey: 'typeNano', descKey: 'nanoDesc' },
]

/** 分隔符字符映射放在 JS 里，避免语言包出现换行符等特殊内容 */
const SEPARATORS = [
  { value: 'newline', labelKey: 'sepNewline', char: '\n' },
  { value: 'comma', labelKey: 'sepComma', char: ',' },
  { value: 'space', labelKey: 'sepSpace', char: ' ' },
]

/** NanoID 字母表：62 个 URL 安全字符（默认字母表） */
const NANO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const COUNT_MIN = 1
const COUNT_MAX = 100
const NANO_MIN = 10
const NANO_MAX = 64
const COUNT_FALLBACK = 5
const NANO_FALLBACK = 21


function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** UUID v4：优先 crypto.randomUUID，不可用时降级为手写 v4 算法 */
function uuidV4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // 环境异常时降级到手写实现
    }
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = toHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** UUID v7：48 位毫秒时间戳（大端）+ 随机位，符合 RFC 9562 */
function uuidV7() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const ts = Date.now()
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = toHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** NanoID：用加密级 randomInt（拒绝采样）取字母表索引 */
function nanoId(length) {
  let id = ''
  for (let i = 0; i < length; i++) {
    id += NANO_ALPHABET[randomInt(NANO_ALPHABET.length)]
  }
  return id
}

const ids = ref([])

/**
 * 生成一批 ID
 * @param {boolean} silent - 为 true 时不弹成功提示（首次进入页面）
 */
function generate(silent = false) {
  try {
    config.value.count = clampInt(config.value.count, COUNT_MIN, COUNT_MAX, COUNT_FALLBACK)
    config.value.nanoLength = clampInt(config.value.nanoLength, NANO_MIN, NANO_MAX, NANO_FALLBACK)
    const list = []
    for (let i = 0; i < config.value.count; i++) {
      if (config.value.type === 'v7') {
        list.push(uuidV7())
      } else if (config.value.type === 'nanoid') {
        list.push(nanoId(config.value.nanoLength))
      } else {
        list.push(uuidV4())
      }
    }
    ids.value = list
    if (!silent) {
      toast.success(t('tools.uuidGenerator.toastGenerated', { n: list.length }))
    }
  } catch {
    ids.value = []
    toast.error(t('toolsCommon.error'))
  }
}

onMounted(() => generate(true))

// 设置变化时自动重新生成
watch(
  () => [config.value.type, config.value.count, config.value.nanoLength],
  () => generate()
)

const activeType = computed(() => TYPES.find(tp => tp.value === config.value.type) || TYPES[0])
const activeTypeDesc = computed(() => t(`tools.uuidGenerator.${activeType.value.descKey}`))

const allText = computed(() => {
  const sep = SEPARATORS.find(s => s.value === config.value.separator)
  return ids.value.join(sep ? sep.char : '\n')
})
</script>

<template>
  <ToolPage tool-id="uuidGenerator">
    <!-- 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.settings') }}</h2>

      <span class="label-base">{{ t('tools.uuidGenerator.type') }}</span>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('tools.uuidGenerator.type')">
        <button
          v-for="tp in TYPES"
          :key="tp.value"
          type="button"
          class="btn-ghost"
          :class="config.type === tp.value ? '!border-blue-600 !bg-blue-600 !text-white' : ''"
          :aria-pressed="config.type === tp.value ? 'true' : 'false'"
          @click="config.type = tp.value"
        >
          {{ t(`tools.uuidGenerator.${tp.labelKey}`) }}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">{{ activeTypeDesc }}</p>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <!-- 数量：数字输入 + 滑块 -->
        <div>
          <label class="label-base" for="uuid-count">
            {{ t('tools.uuidGenerator.count') }}: {{ config.count }}
          </label>
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0">
              <input
                id="uuid-count"
                v-model.number="config.count"
                type="number"
                :min="COUNT_MIN"
                :max="COUNT_MAX"
                class="input-base font-mono text-center"
                :aria-label="t('tools.uuidGenerator.count')"
              />
            </div>
            <input
              v-model.number="config.count"
              type="range"
              :min="COUNT_MIN"
              :max="COUNT_MAX"
              class="min-w-0 flex-1 accent-blue-600"
              :aria-label="t('tools.uuidGenerator.count')"
            />
          </div>
        </div>

        <!-- NanoID 长度：数字输入 + 滑块 -->
        <div v-if="config.type === 'nanoid'">
          <label class="label-base" for="uuid-nano-len">
            {{ t('tools.uuidGenerator.nanoLength') }}: {{ config.nanoLength }}
          </label>
          <div class="flex items-center gap-3">
            <div class="w-20 shrink-0">
              <input
                id="uuid-nano-len"
                v-model.number="config.nanoLength"
                type="number"
                :min="NANO_MIN"
                :max="NANO_MAX"
                class="input-base font-mono text-center"
                :aria-label="t('tools.uuidGenerator.nanoLength')"
              />
            </div>
            <input
              v-model.number="config.nanoLength"
              type="range"
              :min="NANO_MIN"
              :max="NANO_MAX"
              class="min-w-0 flex-1 accent-blue-600"
              :aria-label="t('tools.uuidGenerator.nanoLength')"
            />
          </div>
        </div>
      </div>
      <p v-if="config.type === 'nanoid'" class="mt-2 text-xs text-slate-400">
        {{ t('tools.uuidGenerator.nanoHint') }}
      </p>

      <div class="mt-4">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="generate()">
          {{ t('tools.uuidGenerator.generate') }}
        </button>
      </div>
    </section>

    <!-- 结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.uuidGenerator.results') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm text-slate-500 shrink-0" for="uuid-sep">
            {{ t('tools.uuidGenerator.separator') }}
          </label>
          <div class="w-28">
            <select id="uuid-sep" v-model="config.separator" class="input-base">
              <option v-for="s in SEPARATORS" :key="s.value" :value="s.value">
                {{ t(`tools.uuidGenerator.${s.labelKey}`) }}
              </option>
            </select>
          </div>
          <CopyButton
            :text="allText"
            :label="t('toolsCommon.copyAll')"
            :disabled="ids.length === 0"
          />
        </div>
      </div>

      <p v-if="ids.length === 0" class="text-sm text-slate-400">
        {{ t('tools.uuidGenerator.emptyHint') }}
      </p>
      <ol v-else class="space-y-2">
        <li
          v-for="(id, i) in ids"
          :key="id + '-' + i"
          class="flex items-center gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
        >
          <span class="w-6 shrink-0 text-right font-mono text-xs text-slate-400">{{ i + 1 }}</span>
          <code class="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">{{ id }}</code>
          <CopyButton :text="id" compact :label="t('toolsCommon.copy')" />
        </li>
      </ol>
    </section>
  </ToolPage>
</template>

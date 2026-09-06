<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { sampleWithoutReplacement, randomInt } from '@/utils/random'
import { useToast } from '@/composables/useToast'

/**
 * 抽签 / 决策工具：
 * - 多行输入选项（每行一个，空行忽略）
 * - 老虎机滚动动画：结果区快速轮换选项，间隔 50ms 逐渐放缓到 200ms，
 *   总时长约 2 秒后停在 crypto 安全抽出的选中项（放大高亮）
 * - 支持一次抽取多个（不重复，sampleWithoutReplacement）
 * - 历史记录持久化（最新在上，上限 50 条），可一键清空
 */
const { t } = useI18n()
const toast = useToast()

const HISTORY_LIMIT = 50
const SPIN_TOTAL_MS = 2000
const SPIN_START_DELAY_MS = 50
const SPIN_END_DELAY_MS = 200
const SPIN_ACCELERATION = 1.13

/** 选项与抽取数量一并持久化，方便下次继续使用 */
const config = useStorage('tool-random-picker-config', {
  optionsText: '火锅\n烧烤\n寿司\n汉堡\n面条',
  count: 1,
})

/** 历史记录持久化：最新在上，最多 50 条 */
const history = useStorage('tool-random-picker-history', [])

const optionsText = ref(
  typeof config.value.optionsText === 'string' ? config.value.optionsText : ''
)
const count = ref(Number(config.value.count) >= 1 ? Math.floor(Number(config.value.count)) : 1)

const options = computed(() =>
  optionsText.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
)

const error = ref('')
const isSpinning = ref(false)
/** 滚动动画期间轮换显示的选项 */
const displayItem = ref('')
/** 最终抽中项 */
const winners = ref([])
let spinTimer = null

function showError(message) {
  error.value = message
  toast.error(message)
}

function start() {
  if (isSpinning.value) return
  error.value = ''
  winners.value = []
  displayItem.value = ''

  const pool = options.value
  if (pool.length === 0) {
    showError(t('tools.randomPicker.noOptions'))
    return
  }

  let n = Math.floor(Number(count.value))
  if (!Number.isFinite(n) || n < 1) {
    n = 1
    count.value = 1
  }
  if (n > pool.length) {
    showError(t('tools.randomPicker.countTooLarge', { n: pool.length }))
    return
  }

  let picked = []
  try {
    picked = sampleWithoutReplacement(pool, n)
  } catch {
    showError(t('toolsCommon.error'))
    return
  }

  isSpinning.value = true
  spinAnimation(picked, pool)
}

/** 老虎机滚动：间隔从 50ms 逐渐放缓到 200ms，约 2 秒后停在结果上 */
function spinAnimation(picked, pool) {
  let elapsed = 0
  let delay = SPIN_START_DELAY_MS
  const tick = () => {
    if (!isSpinning.value) return
    try {
      displayItem.value = pool[randomInt(pool.length)]
    } catch {
      displayItem.value = ''
    }
    elapsed += delay
    if (elapsed >= SPIN_TOTAL_MS) {
      finish(picked)
      return
    }
    delay = Math.min(SPIN_END_DELAY_MS, delay * SPIN_ACCELERATION)
    spinTimer = setTimeout(tick, delay)
  }
  spinTimer = setTimeout(tick, delay)
}

function finish(picked) {
  spinTimer = null
  isSpinning.value = false
  displayItem.value = ''
  winners.value = picked
  pushHistory(picked)
  toast.success(t('tools.randomPicker.drawDone'))
}

function pad2(num) {
  return String(num).padStart(2, '0')
}

function formatTime(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

function pushHistory(picked) {
  try {
    const entry = {
      time: formatTime(new Date()),
      items: [...picked],
    }
    const next = [entry, ...history.value]
    history.value = next.slice(0, HISTORY_LIMIT)
  } catch {
    // 历史写入失败不影响抽取结果
  }
}

function clearHistory() {
  history.value = []
  toast.info(t('tools.randomPicker.historyCleared'))
}

function onCountBlur() {
  const poolLength = options.value.length
  let n = Math.floor(Number(count.value))
  if (!Number.isFinite(n) || n < 1) n = 1
  if (poolLength > 0 && n > poolLength) n = poolLength
  count.value = n
}

const optionCount = computed(() => options.value.length)
const historyCount = computed(() => history.value.length)

onBeforeUnmount(() => {
  if (spinTimer) {
    clearTimeout(spinTimer)
    spinTimer = null
  }
  isSpinning.value = false
})

// 持久化选项与数量（输入变化时写入）
function persistConfig() {
  config.value = {
    optionsText: optionsText.value,
    count: count.value,
  }
}
</script>

<template>
  <ToolPage tool-id="randomPicker">
    <!-- 选项输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <label class="label-base mb-0" for="picker-options">{{ t('tools.randomPicker.optionsLabel') }}</label>
        <span class="chip">{{ t('toolsCommon.total') }} {{ optionCount }} {{ t('toolsCommon.items') }}</span>
      </div>
      <textarea
        id="picker-options"
        v-model="optionsText"
        rows="7"
        class="input-base resize-y leading-relaxed"
        :placeholder="t('tools.randomPicker.optionsPlaceholder')"
        :aria-label="t('tools.randomPicker.optionsLabel')"
        @input="persistConfig"
      ></textarea>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.randomPicker.optionsHint') }}</p>
    </section>

    <!-- 抽取设置与按钮 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-32">
          <label class="label-base" for="picker-count">{{ t('tools.randomPicker.countLabel') }}</label>
          <input
            id="picker-count"
            v-model.number="count"
            type="number"
            min="1"
            :max="Math.max(optionCount, 1)"
            class="input-base"
            :aria-label="t('tools.randomPicker.countLabel')"
            @blur="onCountBlur"
            @input="persistConfig"
          />
        </div>
        <button
          type="button"
          class="btn-primary !px-8 !py-2.5 text-base"
          :disabled="isSpinning"
          :aria-label="t('tools.randomPicker.startBtn')"
          @click="start"
        >
          <svg
            v-if="!isSpinning"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M12 2l2.4 6.2L21 9.3l-5 4.4 1.5 6.6L12 16.9 6.5 20.3 8 13.7 3 9.3l6.6-1.1z" />
          </svg>
          <span
            v-else
            class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
            aria-hidden="true"
          ></span>
          {{ isSpinning ? t('tools.randomPicker.spinning') : t('tools.randomPicker.startBtn') }}
        </button>
      </div>
      <p v-if="error" class="mt-3 text-red-600 text-sm">{{ error }}</p>
    </section>

    <!-- 结果（老虎机滚动区） -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.randomPicker.resultTitle') }}</h2>
      <div
        class="min-h-[7rem] rounded-xl border border-slate-100 bg-white/70 flex items-center justify-center px-4 py-6"
        aria-live="polite"
      >
        <span
          v-if="isSpinning"
          class="text-xl sm:text-2xl font-bold text-slate-600 font-mono truncate max-w-full animate-pulse"
        >{{ displayItem }}</span>
        <ol v-else-if="winners.length" class="w-full space-y-2">
          <li
            v-for="(item, idx) in winners"
            :key="`${idx}-${item}`"
            class="flex items-center gap-2.5 justify-center"
          >
            <span class="chip shrink-0 min-w-[2rem] justify-center">{{ idx + 1 }}</span>
            <span
              class="text-xl sm:text-2xl font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-center break-all transform scale-105"
            >{{ item }}</span>
          </li>
        </ol>
        <p v-else class="text-sm text-slate-400">{{ t('tools.randomPicker.resultEmpty') }}</p>
      </div>
    </section>

    <!-- 历史记录 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h2 class="section-title mb-0">
          {{ t('tools.randomPicker.historyTitle') }}
          <span class="ml-1.5 text-xs font-normal text-slate-400">{{ historyCount }}/50</span>
        </h2>
        <button
          type="button"
          class="btn-danger"
          :disabled="historyCount === 0"
          :aria-label="t('tools.randomPicker.clearHistory')"
          @click="clearHistory"
        >
          {{ t('tools.randomPicker.clearHistory') }}
        </button>
      </div>
      <ol v-if="history.length" class="space-y-1.5">
        <li
          v-for="(entry, idx) in history"
          :key="`${entry.time}-${idx}`"
          class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-xl border border-slate-100 bg-white/70 px-3 py-2"
        >
          <span class="font-mono text-xs text-slate-400 shrink-0">{{ entry.time }}</span>
          <span class="text-sm font-medium text-slate-700 break-all">
            {{ entry.items.join(t('tools.randomPicker.itemSeparator')) }}
          </span>
        </li>
      </ol>
      <p v-else class="text-sm text-slate-400">{{ t('tools.randomPicker.historyEmpty') }}</p>
    </section>
  </ToolPage>
</template>

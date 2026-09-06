<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 密码强度分析：纯前端实时计算
 * - 熵值 = 长度 x log2(字符集规模)，字符集：小写 26 / 大写 26 / 数字 10 / 符号 33
 * - 暴力破解时间按每秒 100 亿次尝试估算
 * - 隐私要求：密码仅存于组件内存，绝不写入 localStorage
 */

/** 常见弱密码榜（按公开榜单近似排序，命中时按序号提示，匹配忽略大小写） */
const WEAK_PASSWORDS = [
  '123456', 'password', '123456789', '12345678', '12345', 'qwerty',
  '1234567890', '1234567', '111111', '123123', 'abc123', '1234',
  'password1', 'iloveyou', '000000', 'qwerty123', 'zaq12wsx', 'dragon',
  'sunshine', 'princess', 'letmein', '654321', 'monkey', '27653',
  '1qaz2wsx', '123321', 'qwertyuiop', 'superman', 'asdfghjkl', '1q2w3e4r',
  '121314', '666666', '12344321', '123654', 'google', 'master',
  'hello', 'freedom', 'whatever', 'qazwsx', 'trustno1', 'batman',
  'zaq1zaq1', '555555', 'password123', 'football', 'baseball', 'shadow',
  'michael', 'ninja', 'mustang', 'jordan', 'harley', 'andrew',
  'admin', 'passw0rd', 'a123456', 'woaini', '5201314', 'qq123456',
  '123qwe', 'woaini1314', '1q2w3e', 'qwe123',
]

/** 常见键盘 / 顺序序列（小写子串匹配） */
const KEYBOARD_SEQUENCES = [
  'qwerty', 'qwertz', 'azerty', 'asdfgh', 'zxcvbn',
  '123456', '1234567', '123456789', '1234567890', '654321', '987654321',
  'qazwsx', '1qaz2wsx', '1q2w3e4r', 'abc123', '147258369', '159357', '789456',
]

/** 分数档位：0-39 弱 / 40-69 中 / 70-100 强 */
const SEGMENT_THRESHOLDS = [40, 70, 100]
const GUESSES_PER_SECOND = 1e10
const SECOND = 1
const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const YEAR = 365 * 86400

const LEVELS = [
  { labelKey: 'levelWeak', barClass: 'bg-red-500', chipClass: '!bg-red-50 !text-red-600 !border-red-200', textClass: 'text-red-600' },
  { labelKey: 'levelMedium', barClass: 'bg-amber-400', chipClass: '!bg-amber-50 !text-amber-600 !border-amber-200', textClass: 'text-amber-600' },
  { labelKey: 'levelStrong', barClass: 'bg-emerald-500', chipClass: '!bg-emerald-50 !text-emerald-600 !border-emerald-200', textClass: 'text-emerald-600' },
]

const { t } = useI18n()

const password = ref('')
const analyzed = ref('')
const showPassword = ref(false)

/** 150ms 防抖：分析结果基于 analyzed（密码本身不落任何存储） */
const debouncedAnalyze = useDebounceFn(value => {
  analyzed.value = value
}, 150)

watch(password, value => {
  if (!value) {
    analyzed.value = ''
    return
  }
  debouncedAnalyze(value)
})

const analysis = computed(() => analyzePassword(analyzed.value))

const level = computed(() => {
  const score = analysis.value ? analysis.value.score : 0
  if (score >= SEGMENT_THRESHOLDS[2]) return LEVELS[2]
  if (score >= SEGMENT_THRESHOLDS[1]) return LEVELS[1]
  return LEVELS[0]
})

const crackTimeText = computed(() => {
  if (!analysis.value) return ''
  return formatCrackTime(analysis.value.seconds)
})

/**
 * 完整强度分析
 * @param {string} pwd
 */
function analyzePassword(pwd) {
  if (!pwd) return null
  const hasLower = /[a-z]/.test(pwd)
  const hasUpper = /[A-Z]/.test(pwd)
  const hasDigit = /\d/.test(pwd)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pwd)

  let charsetSize = 0
  if (hasLower) charsetSize += 26
  if (hasUpper) charsetSize += 26
  if (hasDigit) charsetSize += 10
  if (hasSymbol) charsetSize += 33

  const entropy = pwd.length * Math.log2(charsetSize)
  const seconds = Math.pow(2, entropy) / 2 / GUESSES_PER_SECOND

  const lowerPwd = pwd.toLowerCase()
  const weakRank = WEAK_PASSWORDS.indexOf(lowerPwd) + 1 // 0 表示未命中

  const rawScore = Math.min(100, Math.round(entropy))
  const score = weakRank > 0 ? Math.min(rawScore, 10) : rawScore

  const suggestions = []
  if (pwd.length < 12) {
    suggestions.push({ key: 'sMinLength', params: { n: pwd.length } })
  }
  if (!hasLower) suggestions.push({ key: 'sLowercase', params: {} })
  if (!hasUpper) suggestions.push({ key: 'sUppercase', params: {} })
  if (!hasDigit) suggestions.push({ key: 'sDigit', params: {} })
  if (!hasSymbol) suggestions.push({ key: 'sSymbol', params: {} })
  if (/(.)\1{2,}/.test(pwd)) suggestions.push({ key: 'sRepeat', params: {} })
  if (KEYBOARD_SEQUENCES.some(seq => lowerPwd.includes(seq))) {
    suggestions.push({ key: 'sKeyboard', params: {} })
  }
  if (/^\d+$/.test(pwd)) suggestions.push({ key: 'sDigitsOnly', params: {} })

  return { score, entropy, charsetSize, seconds, weakRank, suggestions, length: pwd.length }
}

/** 智能格式化数字：小数保留 1-2 位，大数千分位，超大用科学计数 */
function formatBig(n) {
  if (n >= 1e8) return n.toExponential(1)
  if (n >= 100) return Math.round(n).toLocaleString('en-US')
  if (n >= 10) return String(Math.round(n * 10) / 10)
  return String(Math.round(n * 100) / 100)
}

/**
 * 格式化暴力破解时间：秒 / 分 / 时 / 天 / 年 / 万年
 * @param {number} seconds
 */
function formatCrackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds >= 1e8 * YEAR) {
    return t('tools.passwordStrength.timeBeyond')
  }
  if (seconds < 0.001) return t('tools.passwordStrength.instant')
  if (seconds < MINUTE) return t('tools.passwordStrength.timeSecond', { n: formatBig(seconds) })
  if (seconds < HOUR) return t('tools.passwordStrength.timeMinute', { n: formatBig(seconds / MINUTE) })
  if (seconds < DAY) return t('tools.passwordStrength.timeHour', { n: formatBig(seconds / HOUR) })
  if (seconds < YEAR) return t('tools.passwordStrength.timeDay', { n: formatBig(seconds / DAY) })
  const years = seconds / YEAR
  if (years < 1e4) return t('tools.passwordStrength.timeYear', { n: formatBig(years) })
  return t('tools.passwordStrength.timeWanYear', { n: formatBig(years / 1e4) })
}

/** 第 index 段（0-2）的填充宽度 */
function segmentWidth(index) {
  if (!analysis.value) return '0%'
  const score = analysis.value.score
  const upper = SEGMENT_THRESHOLDS[index]
  const lower = index === 0 ? 0 : SEGMENT_THRESHOLDS[index - 1]
  const ratio = (score - lower) / (upper - lower)
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`
}

/** 第 index 段是否已点亮（决定底色） */
function segmentActive(index) {
  if (!analysis.value) return false
  const score = analysis.value.score
  return score > (index === 0 ? 0 : SEGMENT_THRESHOLDS[index - 1])
}

function clearInput() {
  password.value = ''
  analyzed.value = ''
}
</script>

<template>
  <ToolPage tool-id="passwordStrength">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="password-strength-input">{{ t('tools.passwordStrength.inputLabel') }}</label>
      <div class="relative">
        <input
          id="password-strength-input"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          class="input-base w-full pr-20 font-mono"
          autocomplete="new-password"
          spellcheck="false"
          :placeholder="t('tools.passwordStrength.inputPlaceholder')"
        />
        <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            type="button"
            class="btn-ghost !px-2 !py-1"
            :aria-label="showPassword ? t('tools.passwordStrength.hidePassword') : t('tools.passwordStrength.showPassword')"
            @click="showPassword = !showPassword"
          >
            <svg
              v-if="showPassword"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button
            type="button"
            class="btn-danger !px-2 !py-1"
            :disabled="!password"
            :aria-label="t('toolsCommon.clear')"
            @click="clearInput"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>{{ t('tools.passwordStrength.lengthLabel') }} {{ password.length }}</span>
        <span>{{ t('tools.passwordStrength.privacyNote') }}</span>
      </div>
    </section>

    <!-- 强度评分 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.passwordStrength.scoreLabel') }}</h2>

      <p v-if="!analysis" class="text-sm text-slate-400 text-center py-8">
        {{ t('tools.passwordStrength.emptyHint') }}
      </p>

      <template v-else>
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <span class="chip" :class="level.chipClass">{{ t(level.labelKey) }}</span>
          <span class="text-sm text-slate-500">
            {{ analysis.score }} / 100
          </span>
        </div>

        <!-- 三段式进度条 -->
        <div class="flex gap-1.5" role="img" :aria-label="t(level.labelKey)">
          <div
            v-for="index in 3"
            :key="index"
            class="h-2.5 flex-1 rounded-full bg-slate-100 overflow-hidden"
          >
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="segmentActive(index - 1) ? LEVELS[index - 1].barClass : ''"
              :style="{ width: segmentWidth(index - 1) }"
            ></div>
          </div>
        </div>

        <!-- 统计指标 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
            <p class="text-xs text-slate-400 mb-0.5">{{ t('tools.passwordStrength.lengthLabel') }}</p>
            <p class="text-lg font-semibold text-slate-700">{{ analysis.length }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
            <p class="text-xs text-slate-400 mb-0.5">{{ t('tools.passwordStrength.entropyLabel') }}</p>
            <p class="text-lg font-semibold text-slate-700">
              {{ analysis.entropy.toFixed(1) }} bits
            </p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
            <p class="text-xs text-slate-400 mb-0.5">{{ t('tools.passwordStrength.charsetLabel') }}</p>
            <p class="text-lg font-semibold text-slate-700">{{ analysis.charsetSize }}</p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
            <p class="text-xs text-slate-400 mb-0.5">{{ t('tools.passwordStrength.crackTimeLabel') }}</p>
            <p class="text-base font-semibold" :class="level.textClass">{{ crackTimeText }}</p>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400">
          {{ t('tools.passwordStrength.crackTimeNote') }} ·
          {{ t('tools.passwordStrength.entropyFormula') }}
        </p>
      </template>
    </section>

    <!-- 弱密码警告与改进建议 -->
    <section v-if="analysis" class="glass-card p-4 sm:p-6 mb-4">
      <div
        v-if="analysis.weakRank > 0"
        class="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5"
      >
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
          class="w-5 h-5 shrink-0 text-red-500 mt-0.5" aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p class="text-sm font-medium text-red-600">
          {{ t('tools.passwordStrength.weakHit', { n: analysis.weakRank }) }}
        </p>
      </div>

      <h2 class="section-title">{{ t('tools.passwordStrength.suggestionsTitle') }}</h2>
      <p
        v-if="analysis.suggestions.length === 0 && analysis.weakRank === 0"
        class="text-sm text-emerald-600"
      >
        {{ t('tools.passwordStrength.suggestionsAllOk') }}
      </p>
      <ul v-else class="space-y-1.5">
        <li
          v-for="item in analysis.suggestions"
          :key="item.key"
          class="flex items-start gap-2 text-sm text-slate-600"
        >
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"></span>
          <span>{{ t(`tools.passwordStrength.${item.key}`, item.params) }}</span>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

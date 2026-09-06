<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 科学 / 程序员计算器
 * - mathjs evaluate 求值（懒加载），支持三角/对数/幂/开方/阶乘/取余/绝对值/常量
 * - 四种进制模式：HEX/DEC/OCT/BIN，非 DEC 模式输入框自动带 0x/0o/0b 前缀
 * - 结果按当前进制显示（整数），非整数仅显示十进制并提示
 * - 进制对照卡片：当前结果在四种进制下同步显示（BigInt 转换，负数带 -）
 * - 历史记录（最新在上，上限 50 条，useStorage 持久化，点击回填）
 * - 输入防抖 200ms 实时预览，非法表达式显示提示不报错
 */
const { t } = useI18n()
const toast = useToast()

const MODES = ['HEX', 'DEC', 'OCT', 'BIN']
const PREFIX = { HEX: '0x', DEC: '', OCT: '0o', BIN: '0b' }
const RADIX = { HEX: 16, DEC: 10, OCT: 8, BIN: 2 }
const MODE_LABEL_KEYS = { HEX: 'modeHex', DEC: 'modeDec', OCT: 'modeOct', BIN: 'modeBin' }
// 求值异常状态 -> 语言包键
const REASON_KEYS = {
  invalid: 'invalidExpr',
  nan: 'resultNaN',
  infinity: 'resultInfinity',
  complex: 'resultComplex',
}

const config = useStorage('tool-programmer-calculator-config', { mode: 'DEC' })
if (!MODES.includes(config.value.mode)) config.value.mode = 'DEC'

const history = useStorage('tool-programmer-calculator-history', [])
if (!Array.isArray(history.value)) history.value = []

// 每种进制模式各自记忆表达式
const exprByMode = reactive({ HEX: '', DEC: '', OCT: '', BIN: '' })
const expr = computed({
  get: () => exprByMode[config.value.mode],
  set: v => {
    exprByMode[config.value.mode] = v
  },
})

const previewState = ref('empty') // empty | ok | invalid | nan | infinity | complex
const previewText = ref('')
const lastResult = ref(null) // 十进制数值（number）
const submitError = ref('')
const busy = ref(false)

const placeholder = computed(() => t(`tools.programmerCalculator.placeholder${config.value.mode.charAt(0)}${config.value.mode.slice(1).toLowerCase()}`))

const lastIsInteger = computed(
  () => lastResult.value !== null && Number.isFinite(lastResult.value) && Number.isInteger(lastResult.value)
)
const lastIsNonInteger = computed(() => lastResult.value !== null && !lastIsInteger.value)

/** 十进制整数转指定进制字符串（负数带 - 号） */
function toBase(num, radix) {
  const big = BigInt(Math.trunc(Math.abs(num)))
  const digits = big.toString(radix).toUpperCase()
  return num < 0 ? '-' + digits : digits
}

/** 非 DEC 模式：把表达式中的当前进制数字字面量全部换成十进制再交给 mathjs */
function toDecimalExpression(text, mode) {
  const radix = RADIX[mode]
  if (radix === 10) return text
  const pure =
    radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^[01]+$/
  return text
    .split(/\b/)
    .map(token => {
      if (!token) return token
      let t0 = token
      // 已带 0x/0o/0b 前缀的字面量：与当前进制匹配则剥掉前缀
      const pm = /^(0x|0o|0b)([0-9a-fA-F]+)$/i.exec(t0)
      if (pm) {
        const valid =
          (pm[1].toLowerCase() === '0x' && radix === 16) ||
          (pm[1].toLowerCase() === '0o' && radix === 8) ||
          (pm[1].toLowerCase() === '0b' && radix === 2)
        if (!valid) return token
        t0 = pm[2]
      }
      if (pure.test(t0)) {
        const dec = parseInt(t0, radix)
        if (Number.isFinite(dec)) return String(dec)
      }
      return token
    })
    .join('')
}

/** 把 mathjs 结果整理为统一的描述结构 */
function describeResult(r, mode, math) {
  if (typeof r === 'number') {
    if (Number.isNaN(r)) return { ok: false, reason: 'nan' }
    if (!Number.isFinite(r)) return { ok: false, reason: 'infinity' }
    if (Number.isInteger(r)) {
      return { ok: true, value: r, display: toBase(r, RADIX[mode]), integer: true }
    }
    return { ok: true, value: r, display: math.format(r, { precision: 12 }), integer: false }
  }
  // mathjs 可能返回 Complex
  if (r && typeof r === 'object' && typeof r.re === 'number' && typeof r.im === 'number') {
    if (Math.abs(r.im) < 1e-10) return describeResult(r.re, mode, math)
    return { ok: false, reason: 'complex' }
  }
  return { ok: false, reason: 'invalid' }
}

async function evaluate(text, mode) {
  try {
    const math = await import('mathjs/number')
    const prepared = toDecimalExpression(text, mode)
    let r
    let failed = false
    try {
      r = math.evaluate(prepared)
    } catch {
      failed = true
    }
    return failed ? { ok: false, reason: 'invalid' } : describeResult(r, mode, math)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

function applyResult(res) {
  if (res.ok) {
    previewState.value = 'ok'
    previewText.value = res.display
    lastResult.value = res.value
  } else {
    previewState.value = res.reason
    previewText.value = ''
    lastResult.value = null
  }
}

let previewSeq = 0

async function refreshPreview() {
  const token = ++previewSeq
  const text = expr.value
  submitError.value = ''
  if (!text.trim()) {
    previewState.value = 'empty'
    previewText.value = ''
    lastResult.value = null
    return
  }
  const res = await evaluate(text, config.value.mode)
  if (token !== previewSeq) return
  applyResult(res)
}

watchDebounced([expr, () => config.value.mode], refreshPreview, { debounce: 200 })
onMounted(refreshPreview)

function pushHistory(entry) {
  const rest = history.value.filter(
    h => !(h.mode === entry.mode && h.expr === entry.expr && h.display === entry.display)
  )
  history.value = [{ ...entry, ts: Date.now() }, ...rest].slice(0, 50)
}

async function submit() {
  if (busy.value) return
  const text = expr.value
  if (!text.trim()) {
    submitError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  busy.value = true
  try {
    const res = await evaluate(text, config.value.mode)
    if (res.ok) {
      applyResult(res)
      pushHistory({ mode: config.value.mode, expr: text, display: res.display })
      toast.success(t('tools.programmerCalculator.calculated'))
    } else if (res.reason === 'invalid') {
      previewState.value = 'invalid'
      previewText.value = ''
      lastResult.value = null
      submitError.value = t('tools.programmerCalculator.errorCalc')
      toast.error(t('tools.programmerCalculator.errorCalc'))
    } else {
      // NaN / Infinity / 非实数：友好提示
      applyResult(res)
      toast.info(t(`tools.programmerCalculator.${REASON_KEYS[res.reason]}`))
    }
  } finally {
    busy.value = false
  }
}

function restore(item) {
  config.value.mode = item.mode
  exprByMode[item.mode] = item.expr
}

function clearHistory() {
  history.value = []
}

// ---------- 键盘 ----------
const FUNC_KEYS = [
  { k: 'keySin', v: 'sin(' },
  { k: 'keyCos', v: 'cos(' },
  { k: 'keyTan', v: 'tan(' },
  { k: 'keyLn', v: 'log(' },
  { k: 'keyLog', v: 'log10(' },
  { k: 'keySqrt', v: 'sqrt(' },
  { k: 'keyAbs', v: 'abs(' },
  { k: 'keyPi', v: 'pi' },
  { k: 'keyE', v: 'e' },
]
const HEX_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
const PAD_KEYS = [
  { k: 'keyAc', act: 'clear', cls: 'danger' },
  { k: 'keyBack', act: 'back', cls: 'ghost' },
  { v: '(' },
  { v: ')' },
  { k: 'keyPow', v: '^', cls: 'op' },
  { k: 'keyFact', v: '!', cls: 'op' },
  { k: 'keyMod', v: '%', cls: 'op' },
  { k: 'keyDiv', v: '/', cls: 'op' },
  { v: '7' },
  { v: '8' },
  { v: '9' },
  { k: 'keyMul', v: '*', cls: 'op' },
  { v: '4' },
  { v: '5' },
  { v: '6' },
  { k: 'keySub', v: '-', cls: 'op' },
  { v: '1' },
  { v: '2' },
  { v: '3' },
  { k: 'keyAdd', v: '+', cls: 'op' },
  { v: '0' },
  { v: '00' },
  { k: 'keyDot', v: '.', cls: 'op' },
  { k: 'keyEq', act: 'submit', cls: 'primary' },
]

const PAD_CLS = {
  default:
    'bg-white/80 border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/60',
  op: 'bg-blue-50/80 border-blue-100 text-blue-600 hover:border-blue-300',
  ghost: 'bg-white/80 border-slate-200 text-slate-500 hover:border-blue-300',
  danger: 'bg-red-50 border-red-100 text-red-600 hover:bg-red-100',
  primary: 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
}

function padLabel(key) {
  return key.k ? t(`tools.programmerCalculator.${key.k}`) : key.v
}

/** 按当前进制判断数字键是否可用 */
function padEnabled(key) {
  if (key.act) return true
  if (key.v === '.') return config.value.mode === 'DEC'
  if (/^[0-9]+$/.test(key.v)) {
    const m = config.value.mode
    if (m === 'BIN') return key.v.split('').every(d => d === '0' || d === '1')
    if (m === 'OCT') return key.v.split('').every(d => Number(d) <= 7)
  }
  return true
}

const funcEnabled = computed(() => config.value.mode === 'DEC')

function insert(text) {
  expr.value += text
}

function pressKey(key) {
  if (key.act === 'clear') {
    expr.value = ''
  } else if (key.act === 'back') {
    expr.value = expr.value.slice(0, -1)
  } else if (key.act === 'submit') {
    submit()
  } else if (key.v) {
    insert(key.v)
  }
}

/** 进制对照卡片行 */
const baseRows = computed(() =>
  MODES.map(m => ({
    mode: m,
    label: t(`tools.programmerCalculator.${MODE_LABEL_KEYS[m]}`),
    prefix: PREFIX[m],
    value: lastIsInteger.value ? toBase(lastResult.value, RADIX[m]) : '',
    enabled: lastIsInteger.value,
  }))
)
</script>

<template>
  <ToolPage tool-id="programmerCalculator">
    <!-- 输入与预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('tools.programmerCalculator.modeLabel')">
        <button
          v-for="m in MODES"
          :key="m"
          type="button"
          role="tab"
          :aria-selected="config.mode === m"
          class="px-3 py-1.5 rounded-lg text-sm font-semibold transition select-none border font-mono"
          :class="
            config.mode === m
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          @click="config.mode = m"
        >
          {{ t(`tools.programmerCalculator.${MODE_LABEL_KEYS[m]}`) }}
        </button>
      </div>

      <label for="calc-expr" class="label-base mt-4">{{ t('tools.programmerCalculator.exprLabel') }}</label>
      <div class="flex items-stretch gap-2">
        <span
          v-if="config.mode !== 'DEC'"
          class="flex items-center px-3 rounded-xl border border-slate-200 bg-slate-50/80 font-mono text-sm text-slate-500 select-none"
          aria-hidden="true"
        >{{ PREFIX[config.mode] }}</span>
        <textarea
          id="calc-expr"
          v-model="expr"
          rows="2"
          class="input-base flex-1 font-mono resize-none"
          :placeholder="placeholder"
          spellcheck="false"
          autocomplete="off"
          @keydown.enter.prevent="submit"
        ></textarea>
      </div>

      <!-- 结果预览 -->
      <div class="mt-3 rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 min-h-[4.5rem]">
        <span class="text-xs text-slate-400">{{ t('tools.programmerCalculator.previewLabel') }}</span>
        <p v-if="previewState === 'ok'" class="font-mono text-2xl text-slate-800 text-right break-all mt-1">
          {{ previewText }}
        </p>
        <p
          v-else-if="previewState === 'invalid' || previewState === 'empty'"
          class="text-sm text-slate-400 mt-1"
        >
          {{ previewState === 'empty'
            ? t('tools.programmerCalculator.previewHint')
            : t('tools.programmerCalculator.invalidExpr') }}
        </p>
        <p v-else class="text-sm text-amber-600 font-medium mt-1">
          {{ t(`tools.programmerCalculator.${REASON_KEYS[previewState]}`) }}
        </p>
        <p v-if="previewState === 'ok' && config.mode !== 'DEC' && lastIsNonInteger" class="text-xs text-amber-600 mt-1">
          {{ t('tools.programmerCalculator.nonInteger') }}
        </p>
      </div>

      <p v-if="submitError" class="mt-2 text-sm text-red-600" role="alert">{{ submitError }}</p>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.programmerCalculator.trigHint') }}</p>
    </section>

    <!-- 键盘 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-4 sm:grid-cols-9 gap-2">
        <button
          v-for="fk in FUNC_KEYS"
          :key="fk.k"
          type="button"
          class="h-9 px-2 rounded-lg text-sm font-mono border transition select-none active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed bg-white/80 border-slate-200 text-slate-600 hover:border-blue-300"
          :disabled="!funcEnabled"
          :title="funcEnabled ? fk.v : t('tools.programmerCalculator.funcDisabledHint')"
          :aria-label="t(`tools.programmerCalculator.${fk.k}`)"
          @click="funcEnabled && insert(fk.v)"
        >
          {{ t(`tools.programmerCalculator.${fk.k}`) }}
        </button>
      </div>

      <div v-if="config.mode === 'HEX'" class="grid grid-cols-6 gap-2 mt-2">
        <button
          v-for="letter in HEX_KEYS"
          :key="letter"
          type="button"
          class="h-9 rounded-lg text-sm font-mono font-semibold border transition select-none active:scale-95 bg-blue-50/80 border-blue-100 text-blue-600 hover:border-blue-300"
          :aria-label="letter"
          @click="insert(letter)"
        >
          {{ letter }}
        </button>
      </div>

      <div class="grid grid-cols-4 gap-2 mt-2 sm:max-w-md">
        <button
          v-for="(key, i) in PAD_KEYS"
          :key="i"
          type="button"
          class="h-11 rounded-xl text-base font-semibold border transition select-none active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
          :class="PAD_CLS[key.cls || 'default']"
          :disabled="!padEnabled(key)"
          :aria-label="padLabel(key)"
          @click="pressKey(key)"
        >
          {{ padLabel(key) }}
        </button>
      </div>
    </section>

    <!-- 进制对照 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <span class="section-title">{{ t('tools.programmerCalculator.basesTitle') }}</span>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          v-for="row in baseRows"
          :key="row.mode"
          class="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          :class="row.enabled ? 'border-slate-200 bg-white/70' : 'border-slate-100 bg-slate-50/60 opacity-60'"
        >
          <div class="min-w-0">
            <div class="text-xs font-semibold text-slate-400 font-mono">{{ row.label }}</div>
            <div class="font-mono text-sm text-slate-700 break-all">
              {{ row.enabled ? row.prefix + row.value : '—' }}
            </div>
          </div>
          <CopyButton v-if="row.enabled" compact :text="row.prefix + row.value" />
        </div>
      </div>
      <p v-if="lastIsNonInteger" class="mt-2 text-xs text-amber-600">
        {{ t('tools.programmerCalculator.nonInteger') }}
      </p>
    </section>

    <!-- 历史 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="section-title mb-0">{{ t('tools.programmerCalculator.historyTitle') }}</span>
        <button
          v-if="history.length"
          type="button"
          class="btn-danger"
          @click="clearHistory"
        >
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <ol v-if="history.length" class="flex flex-col gap-1">
        <li v-for="(h, i) in history" :key="(h.ts || '') + '-' + i">
          <button
            type="button"
            class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl border border-transparent hover:border-blue-200 hover:bg-blue-50/60 transition"
            :title="t('tools.programmerCalculator.historyHint')"
            @click="restore(h)"
          >
            <span class="chip flex-shrink-0 font-mono">{{ h.mode }}</span>
            <span class="font-mono text-sm text-slate-600 break-all flex-1 min-w-0">{{ h.expr }}</span>
            <span class="text-slate-400 flex-shrink-0" aria-hidden="true">=</span>
            <span class="font-mono text-sm font-semibold text-blue-600 break-all">{{ h.display }}</span>
          </button>
        </li>
      </ol>
      <p v-else class="text-sm text-slate-400 py-6 text-center">
        {{ t('tools.programmerCalculator.historyEmpty') }}
      </p>
    </section>
  </ToolPage>
</template>

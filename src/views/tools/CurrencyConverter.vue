<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * 货币汇率换算：调用 open.er-api.com 公开接口（免费无 key、CORS 开放）
 * 获取最新汇率，按交叉汇率实时换算；结果缓存到本地，
 * 超过 12 小时自动刷新，刷新失败时回退缓存数据并提示
 */

const REQUEST_TIMEOUT = 10000
const STALE_MS = 12 * 60 * 60 * 1000
const QUICK_AMOUNTS = [1, 100, 1000, 10000]
const DEFAULT_FROM = 'USD'
const DEFAULT_TO = 'CNY'

/** 常用币种中英文名称映射（未收录的币种只显示代码） */
const CURRENCY_NAMES = {
  USD: { zh: '美元', en: 'US Dollar' },
  CNY: { zh: '人民币', en: 'Chinese Yuan' },
  EUR: { zh: '欧元', en: 'Euro' },
  JPY: { zh: '日元', en: 'Japanese Yen' },
  GBP: { zh: '英镑', en: 'British Pound' },
  HKD: { zh: '港币', en: 'Hong Kong Dollar' },
  KRW: { zh: '韩元', en: 'South Korean Won' },
  AUD: { zh: '澳大利亚元', en: 'Australian Dollar' },
  CAD: { zh: '加拿大元', en: 'Canadian Dollar' },
  CHF: { zh: '瑞士法郎', en: 'Swiss Franc' },
  SGD: { zh: '新加坡元', en: 'Singapore Dollar' },
  INR: { zh: '印度卢比', en: 'Indian Rupee' },
  RUB: { zh: '俄罗斯卢布', en: 'Russian Ruble' },
  BRL: { zh: '巴西雷亚尔', en: 'Brazilian Real' },
  MXN: { zh: '墨西哥比索', en: 'Mexican Peso' },
  THB: { zh: '泰铢', en: 'Thai Baht' },
  MYR: { zh: '马来西亚林吉特', en: 'Malaysian Ringgit' },
  IDR: { zh: '印尼盾', en: 'Indonesian Rupiah' },
  PHP: { zh: '菲律宾比索', en: 'Philippine Peso' },
  VND: { zh: '越南盾', en: 'Vietnamese Dong' },
  NZD: { zh: '新西兰元', en: 'New Zealand Dollar' },
  SEK: { zh: '瑞典克朗', en: 'Swedish Krona' },
  NOK: { zh: '挪威克朗', en: 'Norwegian Krone' },
  DKK: { zh: '丹麦克朗', en: 'Danish Krone' },
  PLN: { zh: '波兰兹罗提', en: 'Polish Zloty' },
  CZK: { zh: '捷克克朗', en: 'Czech Koruna' },
  HUF: { zh: '匈牙利福林', en: 'Hungarian Forint' },
  TRY: { zh: '土耳其里拉', en: 'Turkish Lira' },
  ZAR: { zh: '南非兰特', en: 'South African Rand' },
  AED: { zh: '阿联酋迪拉姆', en: 'UAE Dirham' },
  SAR: { zh: '沙特里亚尔', en: 'Saudi Riyal' },
  TWD: { zh: '新台币', en: 'New Taiwan Dollar' },
  ILS: { zh: '以色列谢克尔', en: 'Israeli New Shekel' },
  NGN: { zh: '尼日利亚奈拉', en: 'Nigerian Naira' },
  ARS: { zh: '阿根廷比索', en: 'Argentine Peso' },
}

const { t, locale } = useI18n()
const toast = useToast()

/** 币种与金额持久化 */
const config = useStorage('tool-currency-converter-config', {
  amount: '100',
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
})

/** 汇率缓存（带获取时间戳与 API 更新时间） */
const ratesStore = useStorage('tool-currency-converter-rates', {
  rates: null,
  lastUpdateUtc: '',
  fetchedAt: 0,
})

function isValidSavedCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : fallback
}

const amountInput = ref(
  typeof config.value.amount === 'string' && config.value.amount ? config.value.amount : '100'
)
const from = ref(isValidSavedCode(config.value.from, DEFAULT_FROM))
const to = ref(isValidSavedCode(config.value.to, DEFAULT_TO))

watch([amountInput, from, to], ([amount, fromCode, toCode]) => {
  config.value = { amount, from: fromCode, to: toCode }
})

const cachedRates =
  ratesStore.value.rates && typeof ratesStore.value.rates === 'object' ? ratesStore.value.rates : null

const rates = ref(cachedRates)
const lastUpdateUtc = ref(typeof ratesStore.value.lastUpdateUtc === 'string' ? ratesStore.value.lastUpdateUtc : '')
const fetchedAt = ref(Number(ratesStore.value.fetchedAt) || 0)
const loadingRates = ref(false)
const ratesError = ref('')

function persistRates() {
  ratesStore.value = {
    rates: rates.value,
    lastUpdateUtc: lastUpdateUtc.value,
    fetchedAt: fetchedAt.value,
  }
}

/** 拉取最新汇率（以 USD 为基准），失败时回退缓存 */
async function fetchRates(manual) {
  loadingRates.value = true
  ratesError.value = ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal }).finally(() => {
      clearTimeout(timer)
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    if (!data || data.result !== 'success' || !data.rates || typeof data.rates !== 'object') {
      throw new Error('bad payload')
    }
    rates.value = data.rates
    lastUpdateUtc.value = String(data.time_last_update_utc || '')
    fetchedAt.value = Date.now()
    persistRates()
    if (manual) toast.success(t('toolsCommon.loaded'))
  } catch {
    if (rates.value) {
      // 已有缓存数据：静默保留，手动刷新失败时额外提示
      if (manual) toast.info(t('tools.currencyConverter.usingCache'))
    } else {
      ratesError.value = t('tools.currencyConverter.errLoadRates')
      toast.error(t('toolsCommon.networkError'))
    }
  } finally {
    loadingRates.value = false
  }
}

function refreshRates() {
  fetchRates(true)
}

// 页面加载：无缓存或缓存超过 12 小时时自动刷新
onMounted(() => {
  if (!rates.value || Date.now() - fetchedAt.value > STALE_MS) {
    fetchRates(false)
  }
})

// 校正币种：汇率表中不存在的代码回退默认值
watch(rates, value => {
  if (!value) return
  if (!value[from.value]) from.value = DEFAULT_FROM
  if (!value[to.value]) to.value = DEFAULT_TO
})

/** 金额解析：允许整数与小数 */
const amountParsed = computed(() => {
  const value = amountInput.value.trim()
  if (!/^\d*\.?\d+$/.test(value)) return NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
})

const amountValid = computed(() => Number.isFinite(amountParsed.value))
const amountInvalid = computed(() => amountInput.value.trim() !== '' && !amountValid.value)

/** 币种下拉：按代码排序；无数据时至少包含当前选择 */
const currencyCodes = computed(() => {
  if (!rates.value) return Array.from(new Set([from.value, to.value])).sort()
  return Object.keys(rates.value).sort()
})

/** 币种显示名：常用币种按语言显示中英文名，其余显示代码 */
function currencyName(code) {
  const info = CURRENCY_NAMES[code]
  if (!info) return code
  return String(locale.value).indexOf('zh') === 0 ? info.zh : info.en
}

function optionLabel(code) {
  const name = currencyName(code)
  return name === code ? code : code + ' · ' + name
}

/** 交叉汇率：rates to / rates from */
const crossRate = computed(() => {
  if (!rates.value) return null
  const rateFrom = Number(rates.value[from.value])
  const rateTo = Number(rates.value[to.value])
  if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo) || !rateFrom) return null
  return rateTo / rateFrom
})

const converted = computed(() => {
  if (crossRate.value === null || !amountValid.value) return NaN
  return amountParsed.value * crossRate.value
})

function formatAmount(value) {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(locale.value, {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 6,
  })
}

function formatRate(value) {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(locale.value, {
    maximumFractionDigits: Math.abs(value) >= 1 ? 4 : 8,
  })
}

const rateText = computed(() => (crossRate.value === null ? '—' : formatRate(crossRate.value)))
const inverseRateText = computed(() =>
  crossRate.value ? formatRate(1 / crossRate.value) : '—'
)

/** 互换币种：金额跟随换算为新的原币种金额 */
function swapCurrencies() {
  const previousFrom = from.value
  const previousTo = to.value
  const previousConverted = converted.value
  from.value = previousTo
  to.value = previousFrom
  if (Number.isFinite(previousConverted)) {
    amountInput.value = String(Math.round(previousConverted * 1e6) / 1e6)
  }
}

/** 汇率更新时间格式化为本地时间 */
const updatedAtText = computed(() => {
  if (!lastUpdateUtc.value) return ''
  const date = new Date(lastUpdateUtc.value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
})
</script>

<template>
  <ToolPage tool-id="currencyConverter">
    <!-- 输入区：金额 + 币种选择 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 gap-4">
        <div>
          <label class="label-base" for="currency-amount">{{ t('tools.currencyConverter.amountLabel') }}</label>
          <input
            id="currency-amount"
            v-model="amountInput"
            type="text"
            inputmode="decimal"
            class="input-base font-mono"
            :placeholder="t('tools.currencyConverter.amountPlaceholder')"
            autocomplete="off"
          />
          <p v-if="amountInvalid" class="mt-1.5 text-xs text-red-600">
            {{ t('tools.currencyConverter.errInvalidAmount') }}
          </p>
          <div class="mt-2.5 flex items-center gap-2 flex-wrap">
            <span class="text-xs text-slate-400">{{ t('tools.currencyConverter.quickAmounts') }}</span>
            <button
              v-for="q in QUICK_AMOUNTS"
              :key="q"
              type="button"
              class="btn-ghost !px-2.5 !py-1 !text-xs font-mono"
              @click="amountInput = String(q)"
            >
              {{ q.toLocaleString(locale) }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-2 items-end">
          <div>
            <label class="label-base" for="currency-from">{{ t('tools.currencyConverter.fromLabel') }}</label>
            <select id="currency-from" v-model="from" class="input-base">
              <option v-for="code in currencyCodes" :key="'from-' + code" :value="code">
                {{ optionLabel(code) }}
              </option>
            </select>
          </div>
          <div class="flex sm:pb-0.5 justify-center">
            <button
              type="button"
              class="btn-ghost !px-3 !py-2"
              :disabled="!rates"
              :title="t('toolsCommon.swap')"
              @click="swapCurrencies"
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 5h18" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 19H3" />
              </svg>
              <span class="sr-only">{{ t('toolsCommon.swap') }}</span>
            </button>
          </div>
          <div>
            <label class="label-base" for="currency-to">{{ t('tools.currencyConverter.toLabel') }}</label>
            <select id="currency-to" v-model="to" class="input-base">
              <option v-for="code in currencyCodes" :key="'to-' + code" :value="code">
                {{ optionLabel(code) }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 换算结果与汇率明细 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 class="section-title !mb-0">{{ t('tools.currencyConverter.rateDetailTitle') }}</h2>
        <button v-if="rates" type="button" class="btn-ghost" :disabled="loadingRates" @click="refreshRates">
          <svg
            class="w-4 h-4"
            :class="loadingRates ? 'animate-spin' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {{ loadingRates ? t('tools.currencyConverter.refreshing') : t('tools.currencyConverter.refreshBtn') }}
        </button>
      </div>

      <!-- 首次加载状态 -->
      <div v-if="!rates && loadingRates" class="py-10 flex flex-col items-center gap-3 text-slate-400">
        <span
          class="inline-block w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        <span class="text-sm">{{ t('tools.currencyConverter.loadingRates') }}</span>
      </div>

      <!-- 加载失败且无缓存 -->
      <div v-else-if="!rates" class="py-10 text-center">
        <p class="text-sm text-red-600">{{ ratesError }}</p>
        <button type="button" class="btn-primary mt-3" @click="refreshRates">
          {{ t('tools.currencyConverter.refreshBtn') }}
        </button>
      </div>

      <template v-else>
        <!-- 结果大字 -->
        <div class="text-center py-2">
          <p class="text-sm text-slate-500 font-mono break-all">
            {{ amountValid ? formatAmount(amountParsed) : '—' }}
            <span class="font-semibold text-slate-600">{{ from }}</span>
          </p>
          <svg
            class="w-5 h-5 mx-auto my-1.5 text-slate-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
          <p class="text-3xl sm:text-4xl font-bold text-blue-600 font-mono break-all">
            {{ amountValid ? formatAmount(converted) : '—' }}
            <span class="text-base text-slate-500 font-sans font-semibold">{{ to }}</span>
          </p>
          <p v-if="amountInvalid" class="mt-2 text-xs text-red-600">
            {{ t('tools.currencyConverter.errInvalidAmount') }}
          </p>
        </div>

        <!-- 汇率明细 -->
        <ul class="mt-4 pt-3 border-t border-slate-100 divide-y divide-slate-100 text-sm">
          <li class="py-2 flex items-center justify-between gap-3 flex-wrap">
            <span class="text-slate-500">{{ t('tools.currencyConverter.rateOne', { from: from }) }}</span>
            <span class="font-mono text-slate-700">{{ rateText }} {{ to }}</span>
          </li>
          <li class="py-2 flex items-center justify-between gap-3 flex-wrap">
            <span class="text-slate-500">{{ t('tools.currencyConverter.rateOneInv', { to: to }) }}</span>
            <span class="font-mono text-slate-700">{{ inverseRateText }} {{ from }}</span>
          </li>
          <li class="py-2 flex items-center justify-between gap-3 flex-wrap">
            <span class="text-slate-500">{{ t('tools.currencyConverter.updatedAt') }}</span>
            <span class="font-mono text-slate-700 text-xs sm:text-sm">{{ updatedAtText || '—' }}</span>
          </li>
        </ul>
      </template>
    </section>

    <!-- 数据来源说明 -->
    <div
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5"
      role="note"
    >
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-blue-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.currencyConverter.note') }}</p>
    </div>
  </ToolPage>
</template>

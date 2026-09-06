<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * 全球时区时钟：纯本地计算，无网络请求。
 * 单个 setInterval(1s) 更新 now，各城市用 Intl.DateTimeFormat
 * 按 IANA 时区渲染时间、日期、UTC 偏移以及与本地时区的天数差
 */

/**
 * 内置常用 IANA 时区兜底（约 80 个），值为语言包中 city.* 的城市名键；
 * 支持 Intl.supportedValuesOf('timeZone') 的环境会优先使用完整时区列表
 */
const CITY_KEYS = {
  'Asia/Shanghai': 'beijing',
  'Asia/Hong_Kong': 'hongKong',
  'Asia/Macau': 'macau',
  'Asia/Taipei': 'taipei',
  'Asia/Tokyo': 'tokyo',
  'Asia/Osaka': 'osaka',
  'Asia/Seoul': 'seoul',
  'Asia/Singapore': 'singapore',
  'Asia/Bangkok': 'bangkok',
  'Asia/Kuala_Lumpur': 'kualaLumpur',
  'Asia/Jakarta': 'jakarta',
  'Asia/Manila': 'manila',
  'Asia/Ho_Chi_Minh': 'hoChiMinh',
  'Asia/Yangon': 'yangon',
  'Asia/Phnom_Penh': 'phnomPenh',
  'Asia/Kolkata': 'kolkata',
  'Asia/Karachi': 'karachi',
  'Asia/Dhaka': 'dhaka',
  'Asia/Colombo': 'colombo',
  'Asia/Kathmandu': 'kathmandu',
  'Asia/Dubai': 'dubai',
  'Asia/Riyadh': 'riyadh',
  'Asia/Baghdad': 'baghdad',
  'Asia/Tehran': 'tehran',
  'Asia/Jerusalem': 'jerusalem',
  'Asia/Beirut': 'beirut',
  'Asia/Amman': 'amman',
  'Asia/Tashkent': 'tashkent',
  'Asia/Almaty': 'almaty',
  'Asia/Vladivostok': 'vladivostok',
  'Europe/London': 'london',
  'Europe/Paris': 'paris',
  'Europe/Berlin': 'berlin',
  'Europe/Madrid': 'madrid',
  'Europe/Rome': 'rome',
  'Europe/Amsterdam': 'amsterdam',
  'Europe/Brussels': 'brussels',
  'Europe/Vienna': 'vienna',
  'Europe/Zurich': 'zurich',
  'Europe/Stockholm': 'stockholm',
  'Europe/Oslo': 'oslo',
  'Europe/Copenhagen': 'copenhagen',
  'Europe/Helsinki': 'helsinki',
  'Europe/Athens': 'athens',
  'Europe/Istanbul': 'istanbul',
  'Europe/Moscow': 'moscow',
  'Europe/Kiev': 'kiev',
  'Europe/Warsaw': 'warsaw',
  'Europe/Prague': 'prague',
  'Europe/Budapest': 'budapest',
  'Europe/Bucharest': 'bucharest',
  'Europe/Lisbon': 'lisbon',
  'Europe/Dublin': 'dublin',
  'Europe/Reykjavik': 'reykjavik',
  'America/New_York': 'newYork',
  'America/Los_Angeles': 'losAngeles',
  'America/Chicago': 'chicago',
  'America/Denver': 'denver',
  'America/Phoenix': 'phoenix',
  'America/Toronto': 'toronto',
  'America/Vancouver': 'vancouver',
  'America/Mexico_City': 'mexicoCity',
  'America/Sao_Paulo': 'saoPaulo',
  'America/Buenos_Aires': 'buenosAires',
  'America/Lima': 'lima',
  'America/Bogota': 'bogota',
  'America/Santiago': 'santiago',
  'America/Caracas': 'caracas',
  'America/Havana': 'havana',
  'America/Anchorage': 'anchorage',
  'Pacific/Honolulu': 'honolulu',
  'Africa/Cairo': 'cairo',
  'Africa/Johannesburg': 'johannesburg',
  'Africa/Lagos': 'lagos',
  'Africa/Nairobi': 'nairobi',
  'Africa/Casablanca': 'casablanca',
  'Australia/Sydney': 'sydney',
  'Australia/Melbourne': 'melbourne',
  'Australia/Brisbane': 'brisbane',
  'Australia/Adelaide': 'adelaide',
  'Australia/Perth': 'perth',
  'Pacific/Auckland': 'auckland',
  'Pacific/Fiji': 'fiji',
  UTC: 'utc',
}

/** 首次进入展示的默认五城 */
const DEFAULT_CITIES = ['Asia/Shanghai', 'Asia/Tokyo', 'America/New_York', 'Europe/London', 'Australia/Sydney']

/** 候选下拉最多展示条数 */
const MAX_CANDIDATES = 12

const { t, locale } = useI18n()
const toast = useToast()

/** 时区搜索数据源：优先完整列表，否则用内置常用表兜底 */
const availableTimezones =
  typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : Object.keys(CITY_KEYS)

/** 本地时区 */
const localTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

/** 持久化城市列表（IANA 字符串数组），首次进入写入默认五城 */
const cities = useStorage('tool-world-clock-cities', [...DEFAULT_CITIES])
if (!Array.isArray(cities.value)) {
  cities.value = [...DEFAULT_CITIES]
}

const query = ref('')
const showCandidates = ref(false)

const now = ref(new Date())
let tickTimer = null
let blurTimer = null

/** Intl.DateTimeFormat 实例缓存（切换语言时整体清空） */
const fmtCache = new Map()
function getFmt(key, factory) {
  if (!fmtCache.has(key)) fmtCache.set(key, factory())
  return fmtCache.get(key)
}
watch(locale, () => {
  fmtCache.clear()
})

const validTzCache = new Set()
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false
  if (validTzCache.has(tz)) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    validTzCache.add(tz)
    return true
  } catch {
    return false
  }
}

/** 城市显示名：已知时区走 i18n，其余从 IANA 字符串推导 */
function cityName(tz) {
  const key = CITY_KEYS[tz]
  if (key) return t('tools.worldClock.city.' + key)
  const seg = tz.split('/').pop() || tz
  return seg.replace(/_/g, ' ')
}

/** 子序列模糊匹配：query 的字符按顺序出现在 text 中即命中 */
function fuzzyMatch(text, queryStr) {
  let i = 0
  for (let j = 0; j < text.length && i < queryStr.length; j++) {
    if (text[j] === queryStr[i]) i++
  }
  return i === queryStr.length
}

const candidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  const existing = new Set(cities.value)
  const result = []
  for (const tz of availableTimezones) {
    if (existing.has(tz) || !isValidTimeZone(tz)) continue
    const citySeg = (tz.split('/').pop() || tz).toLowerCase().replace(/_/g, ' ')
    if (fuzzyMatch(citySeg, q) || fuzzyMatch(tz.toLowerCase(), q)) {
      result.push({ tz, name: cityName(tz) })
      if (result.length >= MAX_CANDIDATES) break
    }
  }
  return result
})

watch(query, () => {
  // 有输入就保持下拉打开（无候选时展示“未找到”提示）
  showCandidates.value = query.value.trim().length > 0
})

function addCity(tz) {
  if (!isValidTimeZone(tz)) return
  if (cities.value.includes(tz)) {
    toast.info(t('tools.worldClock.alreadyAdded'))
    return
  }
  cities.value = [...cities.value, tz]
  query.value = ''
  showCandidates.value = false
}

function addFirstCandidate() {
  if (candidates.value.length > 0) addCity(candidates.value[0].tz)
}

function removeCity(tz) {
  cities.value = cities.value.filter(item => item !== tz)
}

function onSearchFocus() {
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
  if (query.value.trim().length > 0) showCandidates.value = true
}

function onSearchBlur() {
  blurTimer = setTimeout(() => {
    showCandidates.value = false
  }, 150)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 读取某时区在给定时刻的年月日时分秒（en-US + h24，与界面语言无关） */
function readTzParts(tz, date) {
  try {
    const fmt = getFmt('p:' + tz, () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    )
    const parts = {}
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value
    return {
      year: +parts.year,
      month: +parts.month,
      day: +parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    }
  } catch {
    return null
  }
}

/** 按该时区墙上时间拼出的 UTC 时间戳（用于推算偏移与天数差） */
function partsToUtc(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, +parts.hour, +parts.minute, +parts.second)
}

/** 某时区当前日期+星期（跟随界面语言） */
function dateText(tz, date) {
  try {
    const fmt = getFmt('d:' + locale.value + ':' + tz, () =>
      new Intl.DateTimeFormat(locale.value, {
        timeZone: tz,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        weekday: 'short',
      })
    )
    return fmt.format(date)
  } catch {
    return ''
  }
}

/** UTC 偏移量文本：UTC+8 / UTC-5:30 */
function formatOffset(min) {
  const sign = min >= 0 ? '+' : '-'
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? sign + h : sign + h + ':' + pad2(m)
}

/** 与本地的偏移差文本：+13h / -5h30m */
function formatDiff(min) {
  const sign = min >= 0 ? '+' : '-'
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return sign + h + 'h' + (m ? m + 'm' : '')
}

/** 天数差标签：城市相对本地，昨天(+1) / 明天(-1) */
function dayDiffLabel(diff) {
  if (diff === 0) return t('tools.worldClock.today')
  if (diff === 1) return t('tools.worldClock.yesterday')
  if (diff === -1) return t('tools.worldClock.tomorrow')
  if (diff === 2) return t('tools.worldClock.dayBefore')
  if (diff === -2) return t('tools.worldClock.dayAfter')
  return t('tools.worldClock.dayDiffOther', { n: (diff > 0 ? '+' : '') + diff })
}

const cards = computed(() => {
  const date = now.value
  const localParts = readTzParts(localTimeZone, date)
  if (!localParts) return []
  const localAsUtc = partsToUtc(localParts)
  const localOffsetMin = Math.round((localAsUtc - date.getTime()) / 60000)
  const result = []
  for (const tz of cities.value) {
    const parts = readTzParts(tz, date)
    if (!parts) continue
    const asUtc = partsToUtc(parts)
    const offsetMin = Math.round((asUtc - date.getTime()) / 60000)
    const dayDiff = Math.round((localAsUtc - asUtc) / 86400000)
    result.push({
      tz,
      name: cityName(tz),
      time: pad2(parts.hour) + ':' + pad2(parts.minute) + ':' + pad2(parts.second),
      date: dateText(tz, date),
      offsetText: 'UTC' + formatOffset(offsetMin),
      dayLabel: dayDiffLabel(dayDiff),
      diffText: formatDiff(offsetMin - localOffsetMin),
      isLocal: tz === localTimeZone,
    })
  }
  return result
})

// 每秒跳动
onMounted(() => {
  cities.value = cities.value.filter(isValidTimeZone)
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
})
</script>

<template>
  <ToolPage tool-id="worldClock">
    <!-- 添加城市：搜索 + 候选下拉 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="world-clock-search">{{ t('tools.worldClock.addLabel') }}</label>
      <div class="relative">
        <input
          id="world-clock-search"
          v-model="query"
          type="text"
          class="input-base"
          :placeholder="t('tools.worldClock.addPlaceholder')"
          autocomplete="off"
          spellcheck="false"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          @keydown.enter.prevent="addFirstCandidate"
        />
        <!-- 候选列表 -->
        <div
          v-if="showCandidates && candidates.length > 0"
          class="absolute z-20 left-0 right-0 mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto py-1"
        >
          <button
            v-for="c in candidates"
            :key="c.tz"
            type="button"
            class="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 transition"
            @mousedown.prevent
            @click="addCity(c.tz)"
          >
            <span class="truncate font-medium">{{ c.name }}</span>
            <span class="text-xs text-slate-400 font-mono truncate">{{ c.tz }}</span>
          </button>
        </div>
        <p
          v-else-if="showCandidates && query.trim() && candidates.length === 0"
          class="mt-1.5 text-sm text-slate-400"
        >
          {{ t('tools.worldClock.noResults') }}
        </p>
      </div>
    </section>

    <!-- 城市时钟卡片 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <article
          v-for="card in cards"
          :key="card.tz"
          class="relative rounded-xl border border-slate-200/80 bg-white/70 p-4"
        >
          <header class="flex items-start justify-between gap-2 mb-2">
            <div class="min-w-0">
              <h3 class="text-base font-semibold text-slate-800 truncate">{{ card.name }}</h3>
              <p class="text-xs text-slate-400 font-mono truncate">{{ card.tz }}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span v-if="card.isLocal" class="chip">{{ t('tools.worldClock.localBadge') }}</span>
              <button
                type="button"
                class="btn-danger !px-2.5"
                :aria-label="t('tools.worldClock.removeCity')"
                :title="t('tools.worldClock.removeCity')"
                @click="removeCity(card.tz)"
              >
                <svg
                  class="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </header>
          <p class="text-3xl font-mono font-semibold text-slate-800 tabular-nums tracking-wide leading-none">
            {{ card.time }}
          </p>
          <p class="mt-2 text-sm text-slate-500 truncate">{{ card.date }}</p>
          <footer class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
            <span
              class="text-slate-500 font-mono"
              :title="t('tools.worldClock.utcOffsetLabel')"
            >
              {{ card.offsetText }}
            </span>
            <span class="flex items-center gap-1.5 min-w-0">
              <span class="chip shrink-0">{{ card.dayLabel }}</span>
              <span class="text-slate-500 font-mono" :title="t('tools.worldClock.diffOffset')">
                {{ card.diffText }}
              </span>
            </span>
          </footer>
        </article>
      </div>
    </section>
  </ToolPage>
</template>

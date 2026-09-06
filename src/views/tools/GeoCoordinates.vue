<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 地理坐标转换：基于 OpenStreetMap Nominatim 公共服务的双向地理编码
 * - 坐标 → 地址：逆地理编码（zoom=18 取最详细级别）
 * - 地址 → 坐标：正向地理编码，返回最多 5 条候选地点
 * Nominatim 限速 1 次/秒，因此请求前按上次请求时间戳做 1.1 秒间隔节流
 */

const REQUEST_TIMEOUT = 10000
const THROTTLE_MS = 1100

const MODES = [
  { key: 'reverse', labelKey: 'modeReverse' },
  { key: 'forward', labelKey: 'modeForward' },
]

const { t, locale } = useI18n()
const toast = useToast()

/** 模式持久化 */
const config = useStorage('tool-geo-coordinates-config', { mode: 'reverse' })
const mode = ref(config.value.mode === 'forward' ? 'forward' : 'reverse')
watch(mode, value => {
  config.value.mode = value
  error.value = ''
})

const latInput = ref('')
const lonInput = ref('')
const addressInput = ref('')

const loading = ref(false)
const error = ref('')
/** 是否已完成过一次查询（用于区分「无结果」与「尚未查询」） */
const reverseDone = ref(false)
const forwardDone = ref(false)
const reverseResult = ref(null)
const forwardResults = ref([])

let lastRequestAt = 0

/** Nominatim 结果语言跟随站点当前语言 */
function acceptLanguage() {
  return locale.value === 'zh-CN' ? 'zh-CN' : 'en-US'
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/** 节流：距上次发起请求不足 1.1 秒时拒绝本次请求 */
function acquireThrottle() {
  const now = Date.now()
  if (now - lastRequestAt < THROTTLE_MS) return false
  lastRequestAt = now
  return true
}

/** 解析坐标数字，非法或越界时返回 null */
function parseCoord(raw, min, max) {
  const value = String(raw || '').trim()
  if (!value) return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < min || num > max) return null
  return num
}

/** 归一化逆地理编码结果 */
function normalizeReverse(data) {
  return {
    displayName: String(data.display_name || ''),
    category: String(data.category || data.class || ''),
    type: String(data.type || ''),
    addressType: String(data.addresstype || ''),
    lat: Number(data.lat),
    lon: Number(data.lon),
    osmType: String(data.osm_type || ''),
    osmId: data.osm_id == null ? '' : String(data.osm_id),
    placeId: data.place_id == null ? '' : String(data.place_id),
    importance: data.importance == null ? '' : String(data.importance),
  }
}

/** 归一化正向地理编码候选 */
function normalizePlace(item) {
  const displayName = String(item.display_name || '')
  return {
    name: String(item.name || '').trim() || displayName.split(',')[0].trim(),
    displayName,
    category: String(item.category || item.class || ''),
    type: String(item.type || ''),
    lat: Number(item.lat),
    lon: Number(item.lon),
  }
}

/** OpenStreetMap 定位链接（新标签页打开） */
function osmMapUrl(lat, lon) {
  return (
    'https://www.openstreetmap.org/?mlat=' + lat +
    '&mlon=' + lon +
    '#map=15/' + lat + '/' + lon
  )
}

/** 坐标 → 地址（逆地理编码） */
async function runReverse() {
  const lat = parseCoord(latInput.value, -90, 90)
  const lon = parseCoord(lonInput.value, -180, 180)
  if (lat === null) {
    error.value = t('tools.geoCoordinates.errInvalidLat')
    return
  }
  if (lon === null) {
    error.value = t('tools.geoCoordinates.errInvalidLon')
    return
  }
  if (!acquireThrottle()) {
    toast.info(t('tools.geoCoordinates.throttleHint'))
    return
  }
  loading.value = true
  error.value = ''
  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?lat=' + lat +
      '&lon=' + lon +
      '&format=jsonv2&accept-language=' + encodeURIComponent(acceptLanguage()) +
      '&zoom=18'
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    if (!data || data.error) {
      // Nominatim 查不到时返回 HTTP 200 + error 字段，按「无结果」处理
      reverseResult.value = null
    } else {
      reverseResult.value = normalizeReverse(data)
    }
    reverseDone.value = true
  } catch {
    error.value = t('tools.geoCoordinates.errQueryFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    loading.value = false
  }
}

/** 地址 → 坐标（正向地理编码） */
async function runForward() {
  const q = addressInput.value.trim()
  if (!q) {
    error.value = t('tools.geoCoordinates.errEmptyAddress')
    return
  }
  if (!acquireThrottle()) {
    toast.info(t('tools.geoCoordinates.throttleHint'))
    return
  }
  loading.value = true
  error.value = ''
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) +
      '&format=jsonv2&limit=5&accept-language=' + encodeURIComponent(acceptLanguage())
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    forwardResults.value = (Array.isArray(data) ? data : []).slice(0, 5).map(normalizePlace)
    forwardDone.value = true
  } catch {
    error.value = t('tools.geoCoordinates.errQueryFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    loading.value = false
  }
}

const reverseCoords = computed(() => {
  const r = reverseResult.value
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return ''
  return r.lat + ', ' + r.lon
})

const reverseMapUrl = computed(() => {
  const r = reverseResult.value
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return ''
  return osmMapUrl(r.lat, r.lon)
})

/** 逆地理结果展示行：字段为空时跳过 */
const reverseRows = computed(() => {
  const r = reverseResult.value
  if (!r) return []
  return [
    { key: 'category', label: t('tools.geoCoordinates.fieldCategory'), value: r.category },
    { key: 'type', label: t('tools.geoCoordinates.fieldType'), value: r.type },
    { key: 'addressType', label: t('tools.geoCoordinates.fieldAddressType'), value: r.addressType },
    { key: 'osmType', label: t('tools.geoCoordinates.fieldOsmType'), value: r.osmType },
    { key: 'osmId', label: t('tools.geoCoordinates.fieldOsmId'), value: r.osmId },
    { key: 'placeId', label: t('tools.geoCoordinates.fieldPlaceId'), value: r.placeId },
    { key: 'importance', label: t('tools.geoCoordinates.fieldImportance'), value: r.importance },
  ].filter(row => row.value)
})
</script>

<template>
  <ToolPage tool-id="geoCoordinates">
    <!-- 模式切换 + 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div
        class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
        role="tablist"
        :aria-label="t('tools.geoCoordinates.title')"
      >
        <button
          v-for="m in MODES"
          :key="m.key"
          type="button"
          role="tab"
          class="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition select-none"
          :class="
            mode === m.key
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="mode === m.key"
          @click="mode = m.key"
        >
          {{ t(`tools.geoCoordinates.${m.labelKey}`) }}
        </button>
      </div>

      <!-- 坐标 → 地址 -->
      <div v-if="mode === 'reverse'" class="mt-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="label-base" for="geo-lat-input">{{ t('tools.geoCoordinates.latLabel') }}</label>
            <input
              id="geo-lat-input"
              v-model="latInput"
              type="text"
              inputmode="decimal"
              class="input-base font-mono"
              :placeholder="t('tools.geoCoordinates.latPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              @keyup.enter="runReverse"
            />
          </div>
          <div>
            <label class="label-base" for="geo-lon-input">{{ t('tools.geoCoordinates.lonLabel') }}</label>
            <input
              id="geo-lon-input"
              v-model="lonInput"
              type="text"
              inputmode="decimal"
              class="input-base font-mono"
              :placeholder="t('tools.geoCoordinates.lonPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              @keyup.enter="runReverse"
            />
          </div>
        </div>
        <button
          type="button"
          class="btn-primary mt-3 w-full sm:w-auto"
          :disabled="loading"
          @click="runReverse"
        >
          {{ t('tools.geoCoordinates.reverseBtn') }}
        </button>
      </div>

      <!-- 地址 → 坐标 -->
      <div v-else class="mt-4">
        <label class="label-base" for="geo-address-input">{{ t('tools.geoCoordinates.addressLabel') }}</label>
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            id="geo-address-input"
            v-model="addressInput"
            type="text"
            class="input-base"
            :placeholder="t('tools.geoCoordinates.addressPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="runForward"
          />
          <button type="button" class="btn-primary shrink-0" :disabled="loading" @click="runForward">
            {{ t('tools.geoCoordinates.forwardBtn') }}
          </button>
        </div>
      </div>

      <p v-if="loading" class="mt-3 flex items-center gap-2 text-sm text-slate-400">
        <span
          class="inline-block w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        {{ t('tools.geoCoordinates.loading') }}
      </p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 逆地理编码结果 -->
    <section v-if="mode === 'reverse' && reverseResult" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.geoCoordinates.resultTitle') }}</h2>
      <div class="py-2.5">
        <p class="text-sm text-slate-500 mb-1">{{ t('tools.geoCoordinates.fieldAddress') }}</p>
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm sm:text-base text-slate-800 font-medium leading-relaxed break-words">
            {{ reverseResult.displayName }}
          </p>
          <CopyButton compact :text="reverseResult.displayName" />
        </div>
      </div>
      <dl class="mt-1 divide-y divide-slate-100 border-t border-slate-100">
        <div
          v-for="row in reverseRows"
          :key="row.key"
          class="py-2.5 flex items-start justify-between gap-3"
        >
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ row.label }}</dt>
          <dd class="text-sm text-slate-700 font-mono break-all text-right">{{ row.value }}</dd>
        </div>
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
            {{ t('tools.geoCoordinates.fieldLat') }} / {{ t('tools.geoCoordinates.fieldLon') }}
          </dt>
          <dd class="flex items-center gap-2 min-w-0">
            <span class="text-sm text-slate-700 font-mono break-all text-right">{{ reverseCoords }}</span>
            <CopyButton compact :text="reverseCoords" :label="t('tools.geoCoordinates.copyCoords')" />
          </dd>
        </div>
      </dl>
      <div v-if="reverseMapUrl" class="mt-3 pt-3 border-t border-slate-100">
        <a
          :href="reverseMapUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          {{ t('tools.geoCoordinates.viewMap') }}
          <svg
            class="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </section>

    <!-- 逆地理编码空状态 -->
    <section
      v-else-if="mode === 'reverse' && reverseDone && !reverseResult && !loading && !error"
      class="glass-card p-4 sm:p-6 mb-4"
    >
      <p class="py-8 text-center text-sm text-slate-400">{{ t('tools.geoCoordinates.noResults') }}</p>
    </section>

    <!-- 正向地理编码候选列表 -->
    <section v-if="mode === 'forward' && forwardResults.length" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.geoCoordinates.resultTitle') }}</h2>
      <div class="divide-y divide-slate-100">
        <article
          v-for="(item, index) in forwardResults"
          :key="index"
          class="py-3.5 first:pt-1 last:pb-1"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-sm sm:text-base font-semibold text-slate-800 break-words">{{ item.name }}</h3>
              <p class="mt-0.5 text-xs sm:text-sm text-slate-500 leading-relaxed break-words">
                {{ item.displayName }}
              </p>
            </div>
            <CopyButton compact :text="item.lat + ', ' + item.lon" :label="t('tools.geoCoordinates.copyCoords')" />
          </div>
          <div v-if="item.category || item.type" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span v-if="item.category" class="chip">{{ item.category }}</span>
            <span v-if="item.type" class="chip">{{ item.type }}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span class="font-mono text-xs sm:text-sm text-slate-700 break-all">
              {{ item.lat }}, {{ item.lon }}
            </span>
            <a
              :href="osmMapUrl(item.lat, item.lon)"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              {{ t('tools.geoCoordinates.viewMap') }}
              <svg
                class="w-3.5 h-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </article>
      </div>
    </section>

    <!-- 正向地理编码空状态 -->
    <section
      v-else-if="mode === 'forward' && forwardDone && !forwardResults.length && !loading && !error"
      class="glass-card p-4 sm:p-6 mb-4"
    >
      <p class="py-8 text-center text-sm text-slate-400">{{ t('tools.geoCoordinates.noResults') }}</p>
    </section>

    <!-- 数据来源与限速说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.geoCoordinates.note') }}</p>
    </div>
  </ToolPage>
</template>

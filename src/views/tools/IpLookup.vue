<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * IP 地址查询：页面加载自动获取本机 IP 信息，
 * 支持手动查询任意 IPv4 或域名；主用 ipwho.is，失败降级 ipapi.co，
 * 请求均带 10 秒超时与 AbortController 中断保护
 */

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const DOMAIN_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
const REQUEST_TIMEOUT = 10000

const { t } = useI18n()
const toast = useToast()

/** 持久化手动输入的查询目标 */
const config = useStorage('tool-ip-lookup-config', { query: '' })
const query = ref(typeof config.value.query === 'string' ? config.value.query : '')
watch(query, value => {
  config.value.query = value
})

const autoLoading = ref(false)
const loading = ref(false)
const error = ref('')
/** 归一化后的查询结果 */
const info = ref(null)

/** 校验手动输入：空值表示查询本机；IPv4 每段不得超过 255，或为合法域名 */
function validateQuery(raw) {
  const value = raw.trim()
  if (!value) return true
  if (IPV4_RE.test(value)) {
    return value.split('.').every(part => Number(part) <= 255)
  }
  return DOMAIN_RE.test(value)
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/** ipwho.is 字段映射 */
function normalizeIpwho(data) {
  const conn = data.connection || {}
  const tz = data.timezone || {}
  return {
    ip: data.ip || '',
    country: data.country || '',
    region: data.region || '',
    city: data.city || '',
    isp: conn.isp || conn.org || '',
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    timezone: tz.id || '',
    asn: conn.asn ? 'AS' + conn.asn : '',
  }
}

/** ipapi.co 字段映射 */
function normalizeIpapi(data) {
  return {
    ip: data.ip || '',
    country: data.country_name || '',
    region: data.region || '',
    city: data.city || '',
    isp: data.org || '',
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    timezone: data.timezone || '',
    asn: data.asn || '',
  }
}

/** 依次尝试主 API 与降级 API（target 为空表示查询本机出口 IP） */
async function requestInfo(target) {
  try {
    const res = await fetchWithTimeout('https://ipwho.is/' + target)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    if (!data || data.success === false) {
      throw new Error(data && data.message ? data.message : 'lookup failed')
    }
    return normalizeIpwho(data)
  } catch (primaryError) {
    const fallbackUrl = target
      ? 'https://ipapi.co/' + target + '/json/'
      : 'https://ipapi.co/json/'
    const res = await fetchWithTimeout(fallbackUrl)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    if (!data || data.error === true) {
      throw new Error(data && data.reason ? data.reason : 'lookup failed')
    }
    return normalizeIpapi(data)
  }
}

async function runLookup(target, isAuto) {
  if (isAuto) autoLoading.value = true
  else loading.value = true
  error.value = ''
  try {
    info.value = await requestInfo(target)
  } catch {
    info.value = null
    error.value = t('tools.ipLookup.errQueryFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    autoLoading.value = false
    loading.value = false
  }
}

function submitManual() {
  const target = query.value.trim()
  if (!validateQuery(target)) {
    error.value = t('tools.ipLookup.errInvalidQuery')
    return
  }
  runLookup(target, false)
}

function lookupSelf() {
  runLookup('', false)
}

// 页面加载自动查询本机 IP
onMounted(() => {
  runLookup('', true)
})

const locationText = computed(() => {
  const d = info.value
  if (!d || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return ''
  return d.latitude + ', ' + d.longitude
})

const osmUrl = computed(() => {
  const d = info.value
  if (!d || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return ''
  return (
    'https://www.openstreetmap.org/?mlat=' + d.latitude +
    '&mlon=' + d.longitude +
    '#map=12/' + d.latitude + '/' + d.longitude
  )
})

/** 展示行：省份数据若无则跳过，其余字段为空时同样不展示 */
const rows = computed(() => {
  const d = info.value
  if (!d) return []
  const all = [
    { key: 'ip', label: t('tools.ipLookup.fieldIp'), value: d.ip },
    { key: 'country', label: t('tools.ipLookup.fieldCountry'), value: d.country },
    { key: 'region', label: t('tools.ipLookup.fieldRegion'), value: d.region },
    { key: 'city', label: t('tools.ipLookup.fieldCity'), value: d.city },
    { key: 'isp', label: t('tools.ipLookup.fieldIsp'), value: d.isp },
    { key: 'location', label: t('tools.ipLookup.fieldLocation'), value: locationText.value },
    { key: 'timezone', label: t('tools.ipLookup.fieldTimezone'), value: d.timezone },
    { key: 'asn', label: t('tools.ipLookup.fieldAsn'), value: d.asn },
  ]
  return all.filter(row => row.value)
})
</script>

<template>
  <ToolPage tool-id="ipLookup">
    <!-- 输入区：手动查询任意 IP / 域名 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-end gap-3">
        <div class="flex-1 min-w-0">
          <label class="label-base" for="ip-lookup-input">{{ t('tools.ipLookup.inputLabel') }}</label>
          <input
            id="ip-lookup-input"
            v-model="query"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.ipLookup.inputPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="submitManual"
          />
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            type="button"
            class="btn-primary"
            :disabled="loading || autoLoading"
            @click="submitManual"
          >
            {{ t('tools.ipLookup.queryBtn') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="loading || autoLoading"
            @click="lookupSelf"
          >
            {{ t('tools.ipLookup.querySelfBtn') }}
          </button>
        </div>
      </div>
      <p v-if="loading" class="mt-2 text-sm text-slate-400">{{ t('tools.ipLookup.loading') }}</p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 自动获取本机 IP 的加载状态 -->
    <section v-if="autoLoading" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-3 text-slate-500">
        <span
          class="inline-block w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        <span class="text-sm">{{ t('tools.ipLookup.autoLoading') }}</span>
      </div>
    </section>

    <!-- 结果展示 -->
    <section v-else-if="info" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.ipLookup.resultTitle') }}</h2>
      <dl class="divide-y divide-slate-100">
        <div
          v-for="row in rows"
          :key="row.key"
          class="py-2.5 flex items-start justify-between gap-3"
        >
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">{{ row.label }}</dt>
          <dd class="flex items-center gap-2 min-w-0">
            <span class="text-sm text-slate-700 font-mono break-all text-right">{{ row.value }}</span>
            <CopyButton compact :text="String(row.value)" />
          </dd>
        </div>
      </dl>
      <!-- 经纬度：OpenStreetMap 地图链接（新标签页） -->
      <div v-if="osmUrl" class="mt-3 pt-3 border-t border-slate-100">
        <a
          :href="osmUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          <span aria-hidden="true">📍</span>
          <span>{{ t('tools.ipLookup.viewMap') }}</span>
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
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </section>

    <!-- 隐私与数据来源说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.ipLookup.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>

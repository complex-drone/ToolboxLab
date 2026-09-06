<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * SSL 证书检测：数据来自 crt.sh 证书透明（CT）公共日志。
 * 选择 SSL Labs 的替代方案：其 API 不支持浏览器跨域访问（无 CORS 头），
 * 公共代理链路也不可靠；CT 日志原生支持 CORS 且包含颁发者/有效期/SAN。
 * 展示最新一张证书的颁发者、有效期、剩余天数预警与 CT 记录统计。
 */

const DOMAIN_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
const API_BASE = 'https://crt.sh/'
const REQUEST_TIMEOUT = 30000

const { t } = useI18n()
const toast = useToast()

/** 持久化：检测的域名 */
const config = useStorage('tool-ssl-checker-config', { domain: '' })
const domain = ref(typeof config.value.domain === 'string' ? config.value.domain : '')
watch(domain, value => {
  config.value.domain = value
})

const loading = ref(false)
const error = ref('')
const currentHost = ref('')
const notFound = ref(false)
/** crt.sh 返回的证书条目数组 */
const entries = ref([])

let controller = null
let disposed = false

onBeforeUnmount(() => {
  disposed = true
  if (controller) controller.abort()
})

/** 宽容化域名：去协议、去路径、去 www 前缀与末尾点，统一小写 */
function normalizeDomain(value) {
  let result = value.trim()
  result = result.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  result = result.split('/')[0]
  result = result.replace(/^www\./i, '')
  result = result.replace(/\.+$/, '')
  return result.toLowerCase()
}

async function fetchEntries() {
  controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const url = API_BASE + '?q=' + encodeURIComponent(currentHost.value) + '&output=json'
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } finally {
    clearTimeout(timer)
  }
}

async function runCheck() {
  const host = normalizeDomain(domain.value)
  if (!host || !DOMAIN_RE.test(host)) {
    error.value = t('tools.sslChecker.errInvalidDomain')
    return
  }
  disposed = false
  if (controller) controller.abort()
  error.value = ''
  notFound.value = false
  entries.value = []
  currentHost.value = host
  loading.value = true

  /** 单次查询（crt.sh 偶发 5xx/超时，静默重试一次） */
  async function queryOnce() {
    const list = await fetchEntries()
    if (list.length === 0) {
      notFound.value = true
      return
    }
    entries.value = list
    toast.success(t('toolsCommon.done'))
  }

  try {
    try {
      await queryOnce()
    } catch {
      if (disposed) return
      await new Promise(resolve => setTimeout(resolve, 800))
      await queryOnce()
    }
  } catch {
    if (disposed) return
    error.value = t('tools.sslChecker.errQueryFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    if (!disposed) loading.value = false
  }
}

/** 从颁发者 DN 字符串中提取组织（O=）与通用名（CN=） */
function parseIssuerField(dn, key) {
  const match = String(dn || '').match(new RegExp(key + '=([^,/]+)'))
  return match ? match[1].trim() : ''
}

/** 时间字符串归一化为毫秒（crt.sh 为 ISO 8601） */
function toMs(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function formatDate(value) {
  const ms = toMs(value)
  if (ms === null) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 尚未过期的证书条目 */
const activeEntries = computed(() =>
  entries.value.filter(entry => {
    const ms = toMs(entry.not_after)
    return ms !== null && ms >= Date.now()
  })
)

/** 当前证书 = 未过期条目中最近签发的一张 */
const currentCert = computed(() => {
  let best = null
  let bestStart = -Infinity
  for (const entry of activeEntries.value) {
    const start = toMs(entry.not_before)
    if (start !== null && start > bestStart) {
      bestStart = start
      best = entry
    }
  }
  return best
})

/** 当前证书剩余天数 */
const daysLeft = computed(() => {
  const cert = currentCert.value
  if (!cert) return null
  const notAfter = toMs(cert.not_after)
  if (notAfter === null) return null
  return Math.ceil((notAfter - Date.now()) / 86400000)
})

/** 剩余天数徽章配色：<15 红色警告、<60 橙色、其余绿色 */
function daysClasses(days) {
  if (days === null) return '!bg-slate-100 !text-slate-500 !border-slate-200'
  if (days < 15) return '!bg-red-50 !text-red-600 !border-red-200'
  if (days < 60) return '!bg-orange-50 !text-orange-600 !border-orange-200'
  return '!bg-green-50 !text-green-600 !border-green-200'
}

/** 当前证书的 SAN 域名（name_value 换行分隔，去重） */
const sanNames = computed(() => {
  const cert = currentCert.value
  if (!cert || typeof cert.name_value !== 'string') return []
  return [...new Set(cert.name_value.split('\n').map(name => name.trim()).filter(Boolean))]
})

/** CT 日志中观察到的证书总数 */
const totalRecords = computed(() => entries.value.length)
</script>

<template>
  <ToolPage tool-id="sslChecker">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="ssl-domain">{{ t('tools.sslChecker.domainLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="ssl-domain"
          v-model="domain"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.sslChecker.domainPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="runCheck"
        />
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="loading"
          @click="runCheck"
        >
          {{ loading ? t('tools.sslChecker.checking') : t('tools.sslChecker.checkBtn') }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600 break-all">{{ error }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!loading && !entries.length && !error && !notFound"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.sslChecker.emptyHint') }}
    </section>

    <!-- 查询中 -->
    <section v-if="loading" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-3 text-slate-500">
        <span
          class="inline-block w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        <span class="text-sm">{{ t('tools.sslChecker.analyzing') }}</span>
      </div>
    </section>

    <!-- 未找到证书记录 -->
    <section
      v-if="!loading && notFound"
      class="glass-card p-8 mb-4 text-center"
    >
      <p class="text-sm text-slate-500">{{ t('tools.sslChecker.noRecords') }}</p>
      <p class="mt-2 text-xs text-slate-400">{{ currentHost }}</p>
    </section>

    <!-- 结果区 -->
    <template v-if="!loading && currentCert">
      <!-- 汇总：目标域名 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200">
            {{ t('tools.sslChecker.resultFor') }}: {{ currentHost }}
          </span>
          <span
            class="chip"
            :class="daysLeft !== null && daysLeft < 15 ? '!bg-red-50 !text-red-600 !border-red-200' : '!bg-green-50 !text-green-600 !border-green-200'"
          >
            {{ daysLeft === null ? t('tools.sslChecker.unknown') : t('tools.sslChecker.daysLeft', { n: daysLeft }) }}
          </span>
        </div>
      </section>

      <!-- 证书详情卡片 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.sslChecker.crtTitle') }}</h2>
          <div class="flex items-center gap-2">
            <!-- 已过期红色徽章 -->
            <span
              v-if="daysLeft !== null && daysLeft < 0"
              class="chip !bg-red-100 !text-red-700 !border-red-300 font-semibold"
            >
              {{ t('tools.sslChecker.expiredBadge') }}
            </span>
            <span
              class="chip"
              :class="daysClasses(daysLeft)"
            >
              <svg
                v-if="daysLeft !== null && daysLeft < 15 && daysLeft >= 0"
                class="w-3 h-3 mr-1"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {{ daysLeft === null ? t('tools.sslChecker.unknown') : t('tools.sslChecker.daysLeft', { n: daysLeft }) }}
            </span>
          </div>
        </div>

        <dl class="divide-y divide-slate-100">
          <!-- 域名（CN / SAN 主名） -->
          <div class="py-2.5 flex items-start justify-between gap-3">
            <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
              {{ t('tools.sslChecker.commonNameLabel') }}
            </dt>
            <dd class="text-sm text-slate-700 font-mono text-right break-all">
              {{ currentCert.common_name || t('tools.sslChecker.unknown') }}
            </dd>
          </div>
          <!-- 证书颁发者 -->
          <div class="py-2.5 flex items-start justify-between gap-3">
            <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
              {{ t('tools.sslChecker.issuerLabel') }}
            </dt>
            <dd class="text-sm text-slate-700 text-right break-all">
              {{ [parseIssuerField(currentCert.issuer_name, 'O'), parseIssuerField(currentCert.issuer_name, 'CN')].filter(Boolean).join(' / ') || currentCert.issuer_name || t('tools.sslChecker.unknown') }}
            </dd>
          </div>
          <!-- 有效期 -->
          <div class="py-2.5 flex items-start justify-between gap-3">
            <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
              {{ t('tools.sslChecker.validityLabel') }}
            </dt>
            <dd class="text-sm text-slate-700 font-mono text-right break-all">
              {{ formatDate(currentCert.not_before) }}
              ~
              {{ formatDate(currentCert.not_after) }}
            </dd>
          </div>
          <!-- SAN 域名数量 -->
          <div class="py-2.5 flex items-start justify-between gap-3">
            <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
              {{ t('tools.sslChecker.sanLabel') }}
            </dt>
            <dd class="text-sm text-slate-700 font-mono">
              {{ sanNames.length || t('tools.sslChecker.unknown') }}
            </dd>
          </div>
          <!-- CT 记录总数 -->
          <div class="py-2.5 flex items-start justify-between gap-3">
            <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
              {{ t('tools.sslChecker.ctRecordsLabel') }}
            </dt>
            <dd class="text-sm text-slate-700 font-mono">
              {{ totalRecords }}
            </dd>
          </div>
        </dl>

        <!-- SAN 域名列表（前 12 个） -->
        <div v-if="sanNames.length" class="mt-3 pt-3 border-t border-slate-100">
          <h3 class="section-title">{{ t('tools.sslChecker.sanListLabel') }}</h3>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="name in sanNames.slice(0, 12)"
              :key="name"
              class="chip !bg-slate-50 !text-slate-600 !border-slate-200 font-mono"
            >
              {{ name }}
            </span>
            <span v-if="sanNames.length > 12" class="chip !bg-slate-50 !text-slate-400 !border-slate-200">
              +{{ sanNames.length - 12 }}
            </span>
          </div>
        </div>
      </section>
    </template>

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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.sslChecker.noteText') }}</p>
    </div>
  </ToolPage>
</template>

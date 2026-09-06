<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * Whois 查询：调用公共 RDAP 协议（rdap.org，自动重定向到注册局
 * 权威 RDAP 服务，支持 CORS），展示域名状态、注册商、关键日期
 * 与域名服务器；域名输入持久化
 */

const DOMAIN_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
const RDAP_BASE = 'https://rdap.org/domain/'
const REQUEST_TIMEOUT = 10000

const { t } = useI18n()
const toast = useToast()

/** 持久化：查询的域名 */
const config = useStorage('tool-whois-lookup-config', { domain: '' })
const domain = ref(typeof config.value.domain === 'string' ? config.value.domain : '')
watch(domain, value => {
  config.value.domain = value
})

const loading = ref(false)
const error = ref('')
const notFound = ref(false)
const raw = ref(null)
const currentHost = ref('')

/** 宽容化域名：去协议、去路径、去 www 前缀与末尾点，统一小写 */
function normalizeDomain(value) {
  let result = value.trim()
  result = result.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  result = result.split('/')[0]
  result = result.replace(/^www\./i, '')
  result = result.replace(/\.+$/, '')
  return result.toLowerCase()
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

async function runLookup() {
  const host = normalizeDomain(domain.value)
  if (!host || !DOMAIN_RE.test(host)) {
    error.value = t('tools.whoisLookup.errInvalidDomain')
    return
  }
  loading.value = true
  error.value = ''
  notFound.value = false
  raw.value = null
  currentHost.value = host

  /** RDAP 查询：404 视为未注册，其余非 2xx 抛错 */
  async function queryOnce() {
    // fetch 默认跟随重定向（rdap.org 302 到注册局权威 RDAP）
    const res = await fetchWithTimeout(RDAP_BASE + encodeURIComponent(host))
    if (res.status === 404) {
      notFound.value = true
      return
    }
    if (!res.ok) throw new Error('HTTP ' + res.status)
    raw.value = await res.json()
    toast.success(t('toolsCommon.done'))
  }

  try {
    try {
      await queryOnce()
    } catch {
      // rdap.org 冷启动偶发快速失败：静默重试一次，仍失败才提示用户
      if (notFound.value) return
      await new Promise(resolve => setTimeout(resolve, 500))
      await queryOnce()
    }
  } catch {
    raw.value = null
    error.value = t('tools.whoisLookup.errQueryFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    loading.value = false
  }
}

/** 从 RDAP 响应中解析展示字段（防御式解析，字段缺失不崩溃） */
const parsed = computed(() => {
  const data = raw.value
  if (!data) return null

  const status = Array.isArray(data.status) ? data.status.filter(item => typeof item === 'string') : []

  // 注册商：entities 中 roles 含 registrar 的实体的 vcardArray fn 字段
  let registrar = ''
  const entities = Array.isArray(data.entities) ? data.entities : []
  const registrarEntity = entities.find(
    entity => entity && Array.isArray(entity.roles) && entity.roles.indexOf('registrar') !== -1
  )
  if (
    registrarEntity &&
    Array.isArray(registrarEntity.vcardArray) &&
    Array.isArray(registrarEntity.vcardArray[1])
  ) {
    const fnEntry = registrarEntity.vcardArray[1].find(
      item => Array.isArray(item) && item[0] === 'fn' && typeof item[3] === 'string'
    )
    if (fnEntry) registrar = fnEntry[3]
  }

  // 关键日期：events 数组中 registration / expiration / last changed
  const events = Array.isArray(data.events) ? data.events : []
  function eventDate(action) {
    const event = events.find(
      item => item && item.eventAction === action && typeof item.eventDate === 'string'
    )
    if (!event) return null
    const date = new Date(event.eventDate)
    return Number.isNaN(date.getTime()) ? null : date
  }

  // 域名服务器列表
  const nameservers = (Array.isArray(data.nameservers) ? data.nameservers : [])
    .map(ns => (ns && (ns.ldhName || ns.unicodeName)) || '')
    .filter(Boolean)
    .map(name => String(name).toLowerCase())
    .sort()

  return {
    handle: typeof data.handle === 'string' ? data.handle : '',
    status,
    registrar,
    registration: eventDate('registration'),
    expiration: eventDate('expiration'),
    lastChanged: eventDate('last changed'),
    nameservers,
  }
})

/** 到期时间状态：剩余天数与是否已过期 */
const expirationState = computed(() => {
  const p = parsed.value
  if (!p || !p.expiration) return null
  const days = Math.ceil((p.expiration.getTime() - Date.now()) / 86400000)
  return { days, expired: days < 0 }
})

function formatDate(date) {
  if (!date) return ''
  return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const rawJson = computed(() =>
  raw.value ? JSON.stringify(raw.value, null, 2) : ''
)
</script>

<template>
  <ToolPage tool-id="whoisLookup">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="whois-domain">{{ t('tools.whoisLookup.domainLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="whois-domain"
          v-model="domain"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.whoisLookup.domainPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="runLookup"
        />
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="loading"
          @click="runLookup"
        >
          {{ loading ? t('tools.whoisLookup.querying') : t('tools.whoisLookup.queryBtn') }}
        </button>
      </div>
      <p v-if="loading" class="mt-2 text-sm text-slate-400">{{ t('tools.whoisLookup.querying') }}</p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!loading && !parsed && !notFound && !error"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.whoisLookup.emptyHint') }}
    </section>

    <!-- 未注册 / 无 RDAP 记录 -->
    <div
      v-if="notFound"
      class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/70 !border-amber-100 flex items-start gap-2.5"
      role="note"
    >
      <span class="text-lg leading-none mt-0.5" aria-hidden="true">⚠️</span>
      <p class="text-sm text-amber-700 leading-relaxed">
        <span class="font-semibold font-mono">{{ currentHost }}</span>
        {{ t('tools.whoisLookup.notFound') }}
      </p>
    </div>

    <!-- 查询结果 -->
    <section v-if="parsed" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title !mb-0">{{ t('tools.whoisLookup.resultTitle') }}</h2>
        <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200">
          {{ currentHost }}
        </span>
        <span class="ml-auto">
          <CopyButton
            :text="rawJson"
            :label="t('tools.whoisLookup.copyJson')"
            :success-message="t('toolsCommon.copied')"
          />
        </span>
      </div>

      <dl class="divide-y divide-slate-100">
        <!-- 注册商 -->
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
            {{ t('tools.whoisLookup.fieldRegistrar') }}
          </dt>
          <dd class="text-sm text-slate-700 break-all text-right">
            {{ parsed.registrar || t('tools.whoisLookup.unknown') }}
          </dd>
        </div>
        <!-- 注册日期 -->
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
            {{ t('tools.whoisLookup.fieldRegistration') }}
          </dt>
          <dd class="text-sm text-slate-700 font-mono text-right">
            {{ parsed.registration ? formatDate(parsed.registration) : t('tools.whoisLookup.unknown') }}
          </dd>
        </div>
        <!-- 到期日期（已过期红色） -->
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
            {{ t('tools.whoisLookup.fieldExpiration') }}
          </dt>
          <dd class="flex flex-wrap items-center justify-end gap-2">
            <span
              class="text-sm font-mono text-right"
              :class="expirationState && expirationState.expired ? 'text-red-600 font-semibold' : 'text-slate-700'"
            >
              {{ parsed.expiration ? formatDate(parsed.expiration) : t('tools.whoisLookup.unknown') }}
            </span>
            <span
              v-if="expirationState"
              class="chip"
              :class="expirationState.expired
                ? '!bg-red-50 !text-red-600 !border-red-200'
                : ''"
            >
              {{ expirationState.expired
                ? t('tools.whoisLookup.expiredDays', { n: Math.abs(expirationState.days) })
                : t('tools.whoisLookup.daysLeft', { n: expirationState.days }) }}
            </span>
          </dd>
        </div>
        <!-- 最后更新日期 -->
        <div class="py-2.5 flex items-start justify-between gap-3">
          <dt class="text-sm text-slate-500 shrink-0 pt-0.5">
            {{ t('tools.whoisLookup.fieldLastChanged') }}
          </dt>
          <dd class="text-sm text-slate-700 font-mono text-right">
            {{ parsed.lastChanged ? formatDate(parsed.lastChanged) : t('tools.whoisLookup.unknown') }}
          </dd>
        </div>
      </dl>

      <!-- 域名状态列表 -->
      <div class="mt-3 pt-3 border-t border-slate-100">
        <h3 class="section-title">{{ t('tools.whoisLookup.fieldStatus') }}</h3>
        <p v-if="!parsed.status.length" class="text-sm text-slate-400">
          {{ t('toolsCommon.none') }}
        </p>
        <div v-else class="flex flex-wrap gap-2">
          <span
            v-for="item in parsed.status"
            :key="item"
            class="chip !bg-slate-50 !text-slate-600 !border-slate-200 break-all"
          >
            {{ item }}
          </span>
        </div>
      </div>

      <!-- 域名服务器 -->
      <div class="mt-3 pt-3 border-t border-slate-100">
        <h3 class="section-title">{{ t('tools.whoisLookup.fieldNameservers') }}</h3>
        <p v-if="!parsed.nameservers.length" class="text-sm text-slate-400">
          {{ t('toolsCommon.none') }}
        </p>
        <ul v-else class="divide-y divide-slate-100">
          <li
            v-for="ns in parsed.nameservers"
            :key="ns"
            class="py-2 flex items-center justify-between gap-3"
          >
            <span class="font-mono text-sm text-slate-700 break-all">{{ ns }}</span>
            <CopyButton compact :text="ns" />
          </li>
        </ul>
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.whoisLookup.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>

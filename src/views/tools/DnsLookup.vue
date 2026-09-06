<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * DNS 记录查询：调用 Cloudflare DoH（dns-query JSON 接口），
 * 支持多类型并发查询、耗时统计、逐条复制；记录类型选择持久化
 */

/** 支持的记录类型与 DNS 类型号映射（纯数据） */
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT']
const TYPE_NUMBERS = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 }
const NUMBER_TO_TYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA' }
const REQUEST_TIMEOUT = 10000

const DOMAIN_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

const { t } = useI18n()
const toast = useToast()

/** 持久化：域名与所选记录类型 */
const config = useStorage('tool-dns-lookup-config', {
  domain: '',
  types: ['A'],
})

const domain = ref(typeof config.value.domain === 'string' ? config.value.domain : '')
const savedTypes = Array.isArray(config.value.types)
  ? config.value.types.filter(type => RECORD_TYPES.indexOf(type) !== -1)
  : []
const selectedTypes = ref(savedTypes.length ? savedTypes : ['A'])

watch(domain, value => {
  config.value.domain = value
})
watch(
  selectedTypes,
  value => {
    config.value.types = [...value]
  },
  { deep: true }
)

function toggleType(type) {
  const index = selectedTypes.value.indexOf(type)
  if (index === -1) selectedTypes.value.push(type)
  else selectedTypes.value.splice(index, 1)
}

const querying = ref(false)
const error = ref('')
/** 每个类型一条结果：{ type, status, records, elapsed, kind } */
const results = ref([])
const totalTime = ref(null)
const lastDomain = ref('')

/** 宽容化域名：去掉协议前缀、路径与末尾点 */
function normalizeDomain(raw) {
  let value = raw.trim()
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  value = value.split('/')[0]
  value = value.replace(/\.+$/, '')
  return value
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/** TXT 记录去掉包裹引号并拼接多段字符串 */
function formatRecordData(type, data) {
  if (type === 'TXT') {
    return data.replace(/^"/, '').replace(/"$/, '').replace(/"\s*"/g, '')
  }
  return data
}

/** 解析 MX 优先级（data 形如 "10 mx.example.com."） */
function parsePriority(data) {
  const n = parseInt(String(data).trim(), 10)
  return Number.isNaN(n) ? null : n
}

/** 单类型查询：永不 reject，错误统一归一化为结果对象 */
async function queryType(type, hostname) {
  const started = performance.now()
  try {
    const res = await fetchWithTimeout(
      'https://cloudflare-dns.com/dns-query?name=' +
        encodeURIComponent(hostname) +
        '&type=' + type,
      { headers: { accept: 'application/dns-json' } }
    )
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const status = typeof data.Status === 'number' ? data.Status : -1
    const answer = Array.isArray(data.Answer) ? data.Answer : []
    const records = answer.map(item => {
      const rawData = item.data || ''
      let value = formatRecordData(type, rawData)
      let priority = null
      if (type === 'MX') {
        const parts = rawData.trim().split(/\s+/)
        priority = parsePriority(parts[0])
        value = parts.slice(1).join(' ')
      }
      return {
        name: item.name || hostname,
        type: NUMBER_TO_TYPE[item.type] || type,
        ttl: typeof item.TTL === 'number' ? item.TTL : 0,
        value,
        priority,
      }
    })
    return {
      type,
      status,
      records,
      elapsed: Math.round(performance.now() - started),
      kind: 'ok',
    }
  } catch {
    return {
      type,
      status: -1,
      records: [],
      elapsed: Math.round(performance.now() - started),
      kind: 'network',
    }
  }
}

/** 一键并发查询所有所选类型 */
async function runLookup() {
  const hostname = normalizeDomain(domain.value)
  if (!hostname || !DOMAIN_RE.test(hostname)) {
    error.value = t('tools.dnsLookup.errInvalidDomain')
    return
  }
  if (!selectedTypes.value.length) {
    error.value = t('tools.dnsLookup.errNoType')
    return
  }
  error.value = ''
  querying.value = true
  results.value = []
  totalTime.value = null
  lastDomain.value = hostname
  const startedTotal = performance.now()
  const settled = await Promise.all(
    selectedTypes.value.map(type => queryType(type, hostname))
  )
  results.value = settled
  totalTime.value = Math.round(performance.now() - startedTotal)
  querying.value = false
  if (settled.some(item => item.kind === 'network')) {
    toast.error(t('toolsCommon.networkError'))
  } else {
    toast.success(t('toolsCommon.done'))
  }
}

/** 所有类型均为 NXDOMAIN 时展示统一友好提示 */
const allNxDomain = computed(
  () =>
    results.value.length > 0 && results.value.every(item => item.status === 3)
)

const successCount = computed(
  () => results.value.filter(item => item.kind === 'ok' && item.status === 0).length
)
</script>

<template>
  <ToolPage tool-id="dnsLookup">
    <!-- 输入区：域名 + 记录类型多选 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="dns-domain">{{ t('tools.dnsLookup.domainLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="dns-domain"
          v-model="domain"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.dnsLookup.domainPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="runLookup"
        />
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="querying"
          @click="runLookup"
        >
          {{ querying ? t('tools.dnsLookup.querying') : t('tools.dnsLookup.queryBtn') }}
        </button>
      </div>

      <p class="label-base mt-4">{{ t('tools.dnsLookup.typeLabel') }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="type in RECORD_TYPES"
          :key="type"
          type="button"
          class="chip cursor-pointer select-none font-mono"
          :class="selectedTypes.indexOf(type) !== -1 ? '' : '!bg-slate-50 !text-slate-500 !border-slate-200'"
          :aria-pressed="selectedTypes.indexOf(type) !== -1 ? 'true' : 'false'"
          @click="toggleType(type)"
        >
          {{ type }}
        </button>
      </div>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!querying && !results.length && !error"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.dnsLookup.emptyHint') }}
    </section>

    <!-- 查询中 -->
    <section v-if="querying" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-3 text-slate-500">
        <span
          class="inline-block w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        <span class="text-sm">{{ t('tools.dnsLookup.querying') }}</span>
      </div>
    </section>

    <!-- 结果区 -->
    <template v-if="results.length && !querying">
      <!-- 汇总：目标域名 + 总耗时 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200">
            {{ t('tools.dnsLookup.resultFor') }}: {{ lastDomain }}
          </span>
          <span v-if="totalTime !== null" class="chip">
            {{ t('tools.dnsLookup.elapsedLabel') }} {{ totalTime }} ms
          </span>
          <span v-if="successCount" class="chip !bg-green-50 !text-green-600 !border-green-200">
            {{ t('toolsCommon.done') }}
          </span>
        </div>
      </section>

      <!-- NXDOMAIN 统一友好提示 -->
      <div
        v-if="allNxDomain"
        class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/70 !border-amber-100 flex items-start gap-2.5"
        role="note"
      >
        <span class="text-lg leading-none mt-0.5" aria-hidden="true">⚠️</span>
        <p class="text-sm text-amber-700 leading-relaxed">{{ t('tools.dnsLookup.nxdomain') }}</p>
      </div>

      <!-- 每个类型一张结果卡 -->
      <section
        v-for="result in results"
        :key="result.type"
        class="glass-card p-4 sm:p-6 mb-4"
      >
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="chip font-mono font-semibold">{{ result.type }}</span>
          <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
            {{ result.elapsed }} ms
          </span>
          <span
            v-if="result.kind === 'ok' && result.records.length"
            class="text-xs text-slate-400 ml-auto"
          >
            {{ result.records.length }} {{ t('toolsCommon.items') }}
          </span>
        </div>

        <!-- 网络失败（单类型） -->
        <p v-if="result.kind === 'network'" class="text-sm text-red-600">
          {{ t('tools.dnsLookup.errNetwork') }}
        </p>
        <!-- 单类型 NXDOMAIN（混合场景兜底） -->
        <p v-else-if="result.status === 3" class="text-sm text-amber-600">
          {{ t('tools.dnsLookup.nxdomain') }}
        </p>
        <!-- 其他 DNS 错误状态 -->
        <p v-else-if="result.status !== 0" class="text-sm text-red-600">
          {{ t('tools.dnsLookup.statusError') }}
        </p>
        <!-- 成功但无记录 -->
        <p v-else-if="!result.records.length" class="text-sm text-slate-400">
          {{ t('tools.dnsLookup.noRecords') }}
        </p>

        <ul v-else class="divide-y divide-slate-100">
          <li
            v-for="(record, index) in result.records"
            :key="index"
            class="py-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center"
          >
            <div class="min-w-0 flex-1">
              <p class="font-mono text-sm text-slate-700 break-all">
                {{ record.value }}
              </p>
              <p class="mt-0.5 text-xs text-slate-400 break-all">
                {{ record.name }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0 flex-wrap">
              <span
                v-if="record.priority !== null"
                class="chip !bg-violet-50 !text-violet-600 !border-violet-200"
              >
                {{ t('tools.dnsLookup.recordPriority') }} {{ record.priority }}
              </span>
              <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
                {{ record.type }}
              </span>
              <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
                {{ t('tools.dnsLookup.recordTtl') }} {{ record.ttl }} {{ t('toolsCommon.seconds') }}
              </span>
              <CopyButton compact :text="record.value" />
            </div>
          </li>
        </ul>
      </section>
    </template>

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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.dnsLookup.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>

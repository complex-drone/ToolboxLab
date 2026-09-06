<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { randomInt } from '@/utils/random'

/**
 * Ping 检测：浏览器无法发送 ICMP，这里对目标发起 N 次 HTTP 请求
 * （no-cors 拉取 favicon，opaque 响应也算成功），用 performance.now()
 * 统计每次往返延迟；3 秒未响应判定为丢包（超时）
 */

const HOSTNAME_RE = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const PROBE_TIMEOUT = 3000
const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const { t } = useI18n()
const toast = useToast()

/** 持久化：探测次数 */
const config = useStorage('tool-ping-test-config', { count: 4 })
const savedCount = config.value.count
const probeCount = ref(COUNT_OPTIONS.indexOf(savedCount) !== -1 ? savedCount : 4)
watch(probeCount, value => {
  config.value.count = value
})

const targetInput = ref('')
const running = ref(false)
const error = ref('')
/** 每次探测一条记录：state 为 running / ok / timeout */
const probes = ref([])
const currentTarget = ref('')
/** 最近一次完整结果（新一轮探测开始时归档） */
const history = ref(null)

let stopped = false
onBeforeUnmount(() => {
  stopped = true
})

/** 宽容化目标：去协议前缀、去路径、去末尾点，保留可选端口 */
function normalizeTarget(raw) {
  let value = raw.trim()
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  value = value.split('/')[0]
  value = value.replace(/\.+$/, '')
  return value
}

/** 校验目标：域名或 IPv4，允许带端口（1-65535） */
function validateTarget(value) {
  if (!value) return false
  let host = value
  const portMatch = value.match(/:(\d{1,5})$/)
  if (portMatch) {
    const port = Number(portMatch[1])
    if (port < 1 || port > 65535) return false
    host = value.slice(0, value.length - portMatch[0].length)
  }
  if (IPV4_RE.test(host)) {
    return host.split('.').every(part => Number(part) <= 255)
  }
  return HOSTNAME_RE.test(host)
}

/**
 * 单次 HTTP 层探测：resolve 或 reject 都视为收到响应，
 * 仅 AbortController 3 秒超时判定为丢包
 */
function probeOnce(host) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT)
  const started = performance.now()
  const url = 'https://' + host + '/favicon.ico?_=' + String(randomInt(1000000000))
  return fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal }).then(
    () => ({ timeout: false, ms: performance.now() - started }),
    err => {
      if (err && err.name === 'AbortError') return { timeout: true, ms: null }
      return { timeout: false, ms: performance.now() - started }
    }
  ).finally(() => {
    clearTimeout(timer)
  })
}

/** 根据探测记录汇总统计 */
function summarize(host, list) {
  const okList = list
    .filter(item => item.state === 'ok')
    .map(item => item.ms)
  const lost = list.filter(item => item.state === 'timeout').length
  return {
    target: host,
    total: list.length,
    lost,
    lossRate: list.length ? Math.round((lost / list.length) * 1000) / 10 : 0,
    min: okList.length ? Math.round(Math.min(...okList)) : null,
    max: okList.length ? Math.round(Math.max(...okList)) : null,
    avg: okList.length
      ? Math.round(okList.reduce((sum, item) => sum + item, 0) / okList.length)
      : null,
    finishedAt: Date.now(),
  }
}

/** 逐次顺序探测，实时更新探测列表 */
async function runPing() {
  const host = normalizeTarget(targetInput.value)
  if (!validateTarget(host)) {
    error.value = t('tools.pingTest.errInvalidTarget')
    return
  }
  // 上一轮完整结果归档为历史
  if (
    !running.value &&
    probes.value.length &&
    currentTarget.value &&
    probes.value.every(item => item.state !== 'running')
  ) {
    history.value = summarize(currentTarget.value, probes.value)
  }
  stopped = false
  error.value = ''
  running.value = true
  currentTarget.value = host
  probes.value = []
  for (let i = 0; i < probeCount.value; i++) {
    if (stopped) return
    probes.value.push({ state: 'running', ms: null })
    const result = await probeOnce(host)
    if (stopped) return
    probes.value[i] = result.timeout
      ? { state: 'timeout', ms: null }
      : { state: 'ok', ms: result.ms }
  }
  running.value = false
  toast.success(t('toolsCommon.done'))
}

const finished = computed(
  () => probes.value.length > 0 && probes.value.every(item => item.state !== 'running')
)

/** 当前轮统计（探测过程中实时刷新） */
const liveStats = computed(() =>
  probes.value.length ? summarize(currentTarget.value, probes.value) : null
)

const doneCount = computed(
  () => probes.value.filter(item => item.state !== 'running').length
)

const progressText = computed(() => {
  if (!running.value) return ''
  return t('tools.pingTest.progress', {
    i: Math.min(doneCount.value + 1, probes.value.length),
    n: probes.value.length,
  })
})

function formatTime(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}
</script>

<template>
  <ToolPage tool-id="pingTest">
    <!-- 输入区：目标地址 + 探测次数 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="ping-target">{{ t('tools.pingTest.targetLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="ping-target"
          v-model="targetInput"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.pingTest.targetPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="runPing"
        />
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="running"
          @click="runPing"
        >
          {{ running ? t('tools.pingTest.running') : t('tools.pingTest.startBtn') }}
        </button>
      </div>

      <p class="label-base mt-4">{{ t('tools.pingTest.countLabel') }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="count in COUNT_OPTIONS"
          :key="count"
          type="button"
          class="chip cursor-pointer select-none"
          :class="probeCount === count ? '' : '!bg-slate-50 !text-slate-500 !border-slate-200'"
          :aria-pressed="probeCount === count ? 'true' : 'false'"
          @click="probeCount = count"
        >
          {{ count }}
        </button>
      </div>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!running && !probes.length && !history && !error"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.pingTest.emptyHint') }}
    </section>

    <!-- 历史结果卡片（新一轮探测进行中时展示上一轮） -->
    <section v-if="running && history" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pingTest.historyTitle') }}</h2>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200">
          {{ history.target }}
        </span>
        <span class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
          {{ formatTime(history.finishedAt) }}
        </span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
          <p class="text-xs text-slate-400">{{ t('tools.pingTest.statMin') }}</p>
          <p class="text-sm font-semibold text-slate-700 font-mono">
            {{ history.min === null ? '—' : history.min + ' ms' }}
          </p>
        </div>
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
          <p class="text-xs text-slate-400">{{ t('tools.pingTest.statAvg') }}</p>
          <p class="text-sm font-semibold text-slate-700 font-mono">
            {{ history.avg === null ? '—' : history.avg + ' ms' }}
          </p>
        </div>
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
          <p class="text-xs text-slate-400">{{ t('tools.pingTest.statMax') }}</p>
          <p class="text-sm font-semibold text-slate-700 font-mono">
            {{ history.max === null ? '—' : history.max + ' ms' }}
          </p>
        </div>
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2">
          <p class="text-xs text-slate-400">{{ t('tools.pingTest.statLoss') }}</p>
          <p class="text-sm font-semibold text-slate-700 font-mono">{{ history.lossRate }}%</p>
        </div>
      </div>
    </section>

    <!-- 本轮结果 -->
    <section v-if="probes.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title !mb-0">{{ t('tools.pingTest.resultTitle') }}</h2>
        <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200">
          {{ currentTarget }}
        </span>
        <span v-if="running" class="chip !bg-amber-50 !text-amber-600 !border-amber-200">
          {{ progressText }}
        </span>
      </div>

      <!-- 逐次探测延迟列表 -->
      <ul class="divide-y divide-slate-100">
        <li
          v-for="(probe, index) in probes"
          :key="index"
          class="py-2 flex items-center justify-between gap-3"
        >
          <span class="text-sm text-slate-500">
            {{ t('tools.pingTest.probeIndex', { i: index + 1 }) }}
          </span>
          <span
            v-if="probe.state === 'running'"
            class="inline-block w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
            aria-hidden="true"
          ></span>
          <span
            v-else-if="probe.state === 'timeout'"
            class="chip !bg-red-50 !text-red-600 !border-red-200 font-semibold"
          >
            {{ t('tools.pingTest.timeout') }}
          </span>
          <span v-else class="chip font-mono">{{ Math.round(probe.ms) }} ms</span>
        </li>
      </ul>

      <!-- 统计：最小 / 平均 / 最大延迟、丢包率 -->
      <div v-if="liveStats" class="mt-4 pt-3 border-t border-slate-100">
        <h3 class="section-title">{{ t('tools.pingTest.statsTitle') }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.pingTest.statMin') }}</p>
            <p class="text-sm font-semibold text-blue-700 font-mono">
              {{ liveStats.min === null ? '—' : liveStats.min + ' ms' }}
            </p>
          </div>
          <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.pingTest.statAvg') }}</p>
            <p class="text-sm font-semibold text-blue-700 font-mono">
              {{ liveStats.avg === null ? '—' : liveStats.avg + ' ms' }}
            </p>
          </div>
          <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2">
            <p class="text-xs text-slate-400">{{ t('tools.pingTest.statMax') }}</p>
            <p class="text-sm font-semibold text-blue-700 font-mono">
              {{ liveStats.max === null ? '—' : liveStats.max + ' ms' }}
            </p>
          </div>
          <div
            class="rounded-xl px-3 py-2 border"
            :class="finished && liveStats.lost > 0
              ? 'bg-red-50/80 border-red-100'
              : 'bg-blue-50/70 border-blue-100'"
          >
            <p class="text-xs text-slate-400">{{ t('tools.pingTest.statLoss') }}</p>
            <p
              class="text-sm font-semibold font-mono"
              :class="finished && liveStats.lost > 0 ? 'text-red-600' : 'text-blue-700'"
            >
              {{ liveStats.lossRate }}%
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 浏览器限制说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.pingTest.noteText') }}</p>
    </div>
  </ToolPage>
</template>

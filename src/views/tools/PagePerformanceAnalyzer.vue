<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { formatBytes } from '@/utils/format'

/**
 * 网页性能轻量分析（分析对象为本工具站当前页面，浏览器安全模型
 * 不允许读取其他站点页面的性能数据）：
 * 1. TTFB / DOM 解析耗时来自 navigation 条目；FCP / LCP / CLS 通过
 *    PerformanceObserver（buffered 回溯）采集，LCP、CLS 不支持时给出提示
 * 2. 资源统计汇总 resource 条目的 transferSize，为 0 的跨域资源单独标注
 * 3. JS 堆内存读取 performance.memory（Chrome 非标准 API）
 * 4. 评分 0-100：四项各 25 分线性递减；SVG 圆环三色 + 等级文字
 * 5. 建议规则引擎：LCP、TTFB、资源数、未压缩资源、DOM、CLS、无 LCP 观测
 * Observer 与定时器均在 onBeforeUnmount 清理
 */

const RING_RADIUS = 52
const RING_CIRC = 2 * Math.PI * RING_RADIUS
/** 各指标满分区间的推荐值与零分区间 */
const GOOD = { ttfb: 800, fcp: 1800, lcp: 2500, cls: 0.1 }
const POOR = { ttfb: 2400, fcp: 4500, lcp: 6000, cls: 0.3 }
/** DOM 解析耗时超过该值视为偏慢 */
const DOM_SLOW_MS = 1500
/** 资源请求数超过该值给出合并建议 */
const MANY_RESOURCES = 50
/** 传输大小超过该值且几乎无压缩收益的资源视为未压缩 */
const UNCOMPRESSED_MIN_TRANSFER = 10240
/** 等待 buffered 观测条目送达的间隔 */
const COLLECT_DELAY_MS = 300

const { t } = useI18n()
const toast = useToast()

const analyzing = ref(false)
const analyzed = ref(false)
const inlineError = ref('')
const metrics = ref(null)

let fcpObserver = null
let lcpObserver = null
let clsObserver = null
let collectTimer = null

onBeforeUnmount(() => {
  disconnectObservers()
  if (collectTimer !== null) {
    clearTimeout(collectTimer)
    collectTimer = null
  }
})

function disconnectObservers() {
  for (const observer of [fcpObserver, lcpObserver, clsObserver]) {
    if (observer) {
      try {
        observer.disconnect()
      } catch {
        /* 忽略断开异常 */
      }
    }
  }
  fcpObserver = null
  lcpObserver = null
  clsObserver = null
}

/** 线性计分：小于等于推荐值满分，达到零分区间 0 分，中间线性递减 */
function linearScore(value, good, poor) {
  if (!Number.isFinite(value)) return 0
  if (value <= good) return 25
  if (value >= poor) return 0
  return Math.round((25 * (poor - value)) / (poor - good))
}

/** 截取资源名称用于展示 */
function shortResourceName(url) {
  try {
    const parsed = new URL(url, window.location.href)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const name = parts.pop() || parsed.hostname
    return name.length > 42 ? name.slice(0, 39) + '...' : name
  } catch {
    return String(url).slice(0, 42)
  }
}

/** 开始 / 重新分析：重置观察器后重新采集 */
function analyze() {
  if (analyzing.value) return
  inlineError.value = ''
  analyzing.value = true
  analyzed.value = false
  disconnectObservers()
  if (collectTimer !== null) {
    clearTimeout(collectTimer)
    collectTimer = null
  }

  try {
    const m = {
      navAvailable: false,
      ttfb: null,
      domTime: null,
      fcp: null,
      fcpUnsupported: false,
      lcp: null,
      lcpUnsupported: false,
      cls: null,
      clsUnsupported: false,
      resourceCount: 0,
      transferTotal: 0,
      untestableCount: 0,
      uncompressed: [],
      memorySupported: false,
      memoryUsed: null,
      memoryLimit: null,
    }

    // 导航计时：TTFB 与 DOM 解析耗时
    const navEntries =
      typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('navigation')
        : []
    const nav = navEntries && navEntries.length > 0 ? navEntries[0] : null
    if (nav) {
      m.navAvailable = true
      if (
        Number.isFinite(nav.responseStart) &&
        Number.isFinite(nav.requestStart) &&
        nav.responseStart >= nav.requestStart
      ) {
        m.ttfb = Math.round(nav.responseStart - nav.requestStart)
      }
      if (Number.isFinite(nav.domContentLoadedEventEnd) && Number.isFinite(nav.startTime)) {
        m.domTime = Math.round(nav.domContentLoadedEventEnd - nav.startTime)
      }
    }

    // FCP：paint 观察器 buffered 回溯
    try {
      fcpObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint' && Number.isFinite(entry.startTime)) {
            m.fcp = Math.round(entry.startTime)
          }
        }
      })
      fcpObserver.observe({ type: 'paint', buffered: true })
    } catch {
      m.fcpUnsupported = true
    }

    // LCP：取最后一次观测值；不支持时置位
    try {
      lcpObserver = new PerformanceObserver(list => {
        const entries = list.getEntries()
        const last = entries.length > 0 ? entries[entries.length - 1] : null
        if (last && Number.isFinite(last.startTime)) {
          m.lcp = Math.round(last.startTime)
        }
      })
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      m.lcpUnsupported = true
    }

    // CLS：累计无 recentInput 的布局偏移，保留 3 位小数
    try {
      let clsSum = 0
      clsObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput && Number.isFinite(entry.value)) {
            clsSum += entry.value
          }
        }
        m.cls = Math.round(clsSum * 1000) / 1000
      })
      clsObserver.observe({ type: 'layout-shift', buffered: true })
    } catch {
      m.clsUnsupported = true
    }

    // 资源统计：数量、传输总量、跨域不可测数量、疑似未压缩资源
    const resources =
      typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('resource')
        : []
    m.resourceCount = resources ? resources.length : 0
    const uncompressed = []
    for (const entry of resources || []) {
      const transfer = Number(entry.transferSize)
      const decoded = Number(entry.decodedBodySize)
      if (Number.isFinite(transfer) && transfer > 0) {
        m.transferTotal += transfer
      } else {
        m.untestableCount++
      }
      if (
        Number.isFinite(transfer) &&
        Number.isFinite(decoded) &&
        transfer >= UNCOMPRESSED_MIN_TRANSFER &&
        decoded > 0 &&
        transfer > decoded * 0.9
      ) {
        uncompressed.push({
          name: shortResourceName(entry.name),
          transferSize: transfer,
          decodedBodySize: decoded,
        })
      }
    }
    uncompressed.sort((a, b) => b.transferSize - a.transferSize)
    m.uncompressed = uncompressed.slice(0, 5)

    // JS 堆内存（Chrome 非标准 API）
    if (
      performance.memory &&
      Number.isFinite(performance.memory.usedJSHeapSize) &&
      performance.memory.usedJSHeapSize > 0
    ) {
      m.memorySupported = true
      m.memoryUsed = performance.memory.usedJSHeapSize
      m.memoryLimit = Number.isFinite(performance.memory.jsHeapSizeLimit)
        ? performance.memory.jsHeapSizeLimit
        : null
    }

    // 等 buffered 条目送达后汇总
    collectTimer = setTimeout(() => {
      collectTimer = null
      disconnectObservers()
      metrics.value = m
      analyzed.value = true
      analyzing.value = false
      toast.success(t('toolsCommon.done'))
    }, COLLECT_DELAY_MS)
  } catch {
    analyzing.value = false
    disconnectObservers()
    inlineError.value = t('tools.pagePerformanceAnalyzer.errAnalyzeFailed')
    toast.error(t('tools.pagePerformanceAnalyzer.errAnalyzeFailed'))
  }
}

/** 总分与等级 */
const score = computed(() => {
  if (!metrics.value) return 0
  const m = metrics.value
  return (
    linearScore(m.ttfb, GOOD.ttfb, POOR.ttfb) +
    linearScore(m.fcp, GOOD.fcp, POOR.fcp) +
    linearScore(m.lcp, GOOD.lcp, POOR.lcp) +
    linearScore(m.cls, GOOD.cls, POOR.cls)
  )
})

const grade = computed(() => {
  if (score.value >= 80) return 'good'
  if (score.value >= 50) return 'mid'
  return 'bad'
})

const gradeText = computed(() => {
  if (grade.value === 'good') return t('tools.pagePerformanceAnalyzer.gradeGood')
  if (grade.value === 'mid') return t('tools.pagePerformanceAnalyzer.gradeMid')
  return t('tools.pagePerformanceAnalyzer.gradeBad')
})

const ringColor = computed(() => {
  if (grade.value === 'good') return '#10b981'
  if (grade.value === 'mid') return '#f59e0b'
  return '#ef4444'
})

const gradeChipClass = computed(() => {
  if (grade.value === 'good') return '!bg-emerald-50 !text-emerald-600 !border-emerald-200'
  if (grade.value === 'mid') return '!bg-amber-50 !text-amber-600 !border-amber-200'
  return '!bg-red-50 !text-red-600 !border-red-200'
})

const ringOffset = computed(() => RING_CIRC * (1 - Math.min(100, Math.max(0, score.value)) / 100))

const subScores = computed(() => {
  if (!metrics.value) return []
  const m = metrics.value
  return [
    { label: t('tools.pagePerformanceAnalyzer.subScoreTtfb'), value: linearScore(m.ttfb, GOOD.ttfb, POOR.ttfb) },
    { label: t('tools.pagePerformanceAnalyzer.subScoreFcp'), value: linearScore(m.fcp, GOOD.fcp, POOR.fcp) },
    { label: t('tools.pagePerformanceAnalyzer.subScoreLcp'), value: linearScore(m.lcp, GOOD.lcp, POOR.lcp) },
    { label: t('tools.pagePerformanceAnalyzer.subScoreCls'), value: linearScore(m.cls, GOOD.cls, POOR.cls) },
  ]
})

/** 优化建议规则引擎 */
const suggestions = computed(() => {
  if (!metrics.value) return []
  const m = metrics.value
  const list = []
  if (Number.isFinite(m.lcp) && m.lcp > GOOD.lcp) list.push({ key: 'lcp' })
  if (Number.isFinite(m.ttfb) && m.ttfb > GOOD.ttfb) list.push({ key: 'ttfb' })
  if (m.resourceCount > MANY_RESOURCES) list.push({ key: 'resources' })
  if (m.uncompressed.length > 0) list.push({ key: 'compress' })
  if (Number.isFinite(m.domTime) && m.domTime > DOM_SLOW_MS) list.push({ key: 'dom' })
  if (Number.isFinite(m.cls) && m.cls > GOOD.cls) list.push({ key: 'cls' })
  if (m.lcpUnsupported || !Number.isFinite(m.lcp)) list.push({ key: 'noLcp' })
  return list
})

function suggestionText(key) {
  return t('tools.pagePerformanceAnalyzer.sug' + key.charAt(0).toUpperCase() + key.slice(1))
}

/** 展示格式化 */
function fmtMs(value) {
  return Number.isFinite(value) ? Math.round(value) + ' ms' : '—'
}

function fmtCls(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '—'
}

function fmtBytesSafe(value) {
  return Number.isFinite(value) && value > 0 ? formatBytes(value) : '—'
}

const fcpDisplay = computed(() =>
  metrics.value && metrics.value.fcpUnsupported
    ? t('tools.pagePerformanceAnalyzer.notSupported')
    : fmtMs(metrics.value && metrics.value.fcp)
)
const lcpDisplay = computed(() =>
  metrics.value && metrics.value.lcpUnsupported
    ? t('tools.pagePerformanceAnalyzer.notSupported')
    : fmtMs(metrics.value && metrics.value.lcp)
)
const clsDisplay = computed(() =>
  metrics.value && metrics.value.clsUnsupported
    ? t('tools.pagePerformanceAnalyzer.notSupported')
    : fmtCls(metrics.value && metrics.value.cls)
)
const ttfbDisplay = computed(() => fmtMs(metrics.value && metrics.value.ttfb))
const domDisplay = computed(() => fmtMs(metrics.value && metrics.value.domTime))
const memoryDisplay = computed(() => {
  const m = metrics.value
  if (!m || !m.memorySupported) return t('tools.pagePerformanceAnalyzer.notSupported')
  return formatBytes(m.memoryUsed)
})
const memoryLimitDisplay = computed(() => {
  const m = metrics.value
  if (!m || !m.memorySupported || m.memoryLimit === null) return '—'
  return formatBytes(m.memoryLimit)
})
</script>

<template>
  <ToolPage tool-id="pagePerformanceAnalyzer">
    <!-- 分析入口 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="analyzing"
          @click="analyze"
        >
          <span
            v-if="analyzing"
            class="inline-block w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"
            aria-hidden="true"
          ></span>
          {{ analyzing ? t('tools.pagePerformanceAnalyzer.analyzing') : analyzed ? t('tools.pagePerformanceAnalyzer.rerunBtn') : t('tools.pagePerformanceAnalyzer.startBtn') }}
        </button>
        <p class="text-xs text-slate-400 leading-relaxed flex-1">
          {{ t('tools.pagePerformanceAnalyzer.runHint') }}
        </p>
      </div>
      <p v-if="inlineError" class="mt-3 text-sm text-red-600">{{ inlineError }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!analyzed && !analyzing"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('toolsCommon.none') }}
    </section>

    <!-- 性能评分 -->
    <section v-if="analyzed" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pagePerformanceAnalyzer.scoreTitle') }}</h2>
      <div class="flex flex-col items-center sm:flex-row sm:items-center gap-6">
        <div class="relative shrink-0">
          <svg viewBox="0 0 120 120" class="h-40 w-40 -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" stroke-width="10" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              :stroke="ringColor"
              stroke-width="10"
              stroke-linecap="round"
              :stroke-dasharray="RING_CIRC"
              :stroke-dashoffset="ringOffset"
              style="transition: stroke-dashoffset 0.3s ease"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-4xl font-extrabold text-slate-800 tabular-nums">{{ score }}</span>
            <span class="text-xs text-slate-400 font-mono">/ 100</span>
          </div>
        </div>

        <div class="flex-1 w-full">
          <div class="flex items-center gap-2 mb-2">
            <span class="chip font-semibold" :class="gradeChipClass">{{ gradeText }}</span>
            <span class="text-xs text-slate-400">
              {{ t('tools.pagePerformanceAnalyzer.scoreRule') }}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="sub in subScores"
              :key="sub.label"
              class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2"
            >
              <p class="text-xs text-slate-400 truncate">{{ sub.label }}</p>
              <p class="text-sm font-semibold text-slate-700 font-mono tabular-nums">
                {{ sub.value }} / 25
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 核心指标 -->
    <section v-if="analyzed" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pagePerformanceAnalyzer.metricsTitle') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.ttfbName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ ttfbDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.ttfbDesc') }}</p>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.fcpName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ fcpDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.fcpDesc') }}</p>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.lcpName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ lcpDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.lcpDesc') }}</p>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.domName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ domDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.domDesc') }}</p>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.clsName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ clsDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.clsDesc') }}</p>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.resName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">
              {{ metrics.resourceCount }}
            </p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">
            {{ t('tools.pagePerformanceAnalyzer.resDesc') }}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <span class="chip !bg-white !text-slate-600 !border-slate-200 font-mono">
              {{ t('tools.pagePerformanceAnalyzer.resTransferLabel') }} {{ fmtBytesSafe(metrics.transferTotal) }}
            </span>
            <span
              v-if="metrics.untestableCount > 0"
              class="chip !bg-amber-50 !text-amber-600 !border-amber-200 font-mono"
            >
              {{ metrics.untestableCount }} {{ t('tools.pagePerformanceAnalyzer.resCrossOriginNote') }}
            </span>
          </div>
        </div>

        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3.5 py-3 sm:col-span-2">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-xs font-medium text-slate-500">{{ t('tools.pagePerformanceAnalyzer.memoryName') }}</p>
            <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">{{ memoryDisplay }}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400 leading-relaxed">{{ t('tools.pagePerformanceAnalyzer.memoryDesc') }}</p>
          <p v-if="metrics.memorySupported" class="mt-1 text-xs text-slate-400 font-mono">
            {{ t('tools.pagePerformanceAnalyzer.memoryLimitLabel') }} {{ memoryLimitDisplay }}
          </p>
        </div>
      </div>
    </section>

    <!-- 优化建议 -->
    <section v-if="analyzed" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.pagePerformanceAnalyzer.suggestionsTitle') }}</h2>

      <p v-if="suggestions.length === 0" class="py-4 text-center text-sm text-emerald-600">
        {{ t('tools.pagePerformanceAnalyzer.allGood') }}
      </p>

      <ul v-else class="space-y-2.5">
        <li
          v-for="item in suggestions"
          :key="item.key"
          class="rounded-xl bg-amber-50/70 border border-amber-100 px-3.5 py-2.5"
        >
          <p class="text-sm text-amber-700 leading-relaxed">{{ suggestionText(item.key) }}</p>
          <table v-if="item.key === 'compress'" class="mt-2 w-full text-xs">
            <thead>
              <tr class="text-amber-600/80 text-left">
                <th class="font-medium py-1 pr-2">{{ t('tools.pagePerformanceAnalyzer.uncompressedColName') }}</th>
                <th class="font-medium py-1 pr-2 text-right">{{ t('tools.pagePerformanceAnalyzer.uncompressedColTransfer') }}</th>
                <th class="font-medium py-1 text-right">{{ t('tools.pagePerformanceAnalyzer.uncompressedColDecoded') }}</th>
              </tr>
            </thead>
            <tbody class="font-mono text-slate-600">
              <tr v-for="res in metrics.uncompressed" :key="res.name" class="border-t border-amber-100">
                <td class="py-1 pr-2 truncate max-w-0">{{ res.name }}</td>
                <td class="py-1 pr-2 text-right whitespace-nowrap">{{ fmtBytesSafe(res.transferSize) }}</td>
                <td class="py-1 text-right whitespace-nowrap">{{ fmtBytesSafe(res.decodedBodySize) }}</td>
              </tr>
            </tbody>
          </table>
        </li>
      </ul>
    </section>

    <!-- 分析范围说明 -->
    <section
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100"
      role="note"
    >
      <h2 class="section-title !text-blue-700">{{ t('tools.pagePerformanceAnalyzer.scopeNoteTitle') }}</h2>
      <p class="text-sm text-blue-700 leading-relaxed">
        {{ t('tools.pagePerformanceAnalyzer.scopeNote') }}
      </p>
    </section>
  </ToolPage>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { normalizeHttpUrl } from '@/utils/url'

/**
 * CORS 跨域检测：从「浏览器视角」探测目标 URL 是否允许跨域读取。
 * 主请求失败时用 mode no-cors 二次探测区分「网络不可达」与「CORS 拦截」，
 * 并按结果生成服务端配置建议。结果受浏览器同源策略限制，不能替代服务端检查。
 */

const TIMEOUT_MS = 10000
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
const TEST_HEADER_NAME = 'X-Test'
const TEST_HEADER_VALUE = '1'

/** 浏览器可能读到的关键 CORS 响应头 */
const CORS_HEADER_ROWS = [
  { name: 'Access-Control-Allow-Origin', key: 'allowOrigin' },
  { name: 'Access-Control-Allow-Methods', key: 'allowMethods' },
  { name: 'Access-Control-Allow-Headers', key: 'allowHeaders' },
  { name: 'Access-Control-Max-Age', key: 'maxAge' },
  { name: 'Access-Control-Allow-Credentials', key: 'allowCredentials' },
  { name: 'Access-Control-Expose-Headers', key: 'exposeHeaders' },
]

const { t } = useI18n()
const toast = useToast()

/** 持久化目标 URL */
const config = useStorage('tool-cors-checker-config', { url: '' })
const urlInput = ref(typeof config.value.url === 'string' ? config.value.url : '')
watch(urlInput, value => {
  config.value.url = value
})

const method = ref('GET')
const useCustomHeader = ref(false)
const loading = ref(false)
const inlineError = ref('')
/** 检测结果：type / status / elapsedMs / headers / finalUrl / probe / errorName */
const outcome = ref(null)
const showDetails = ref(false)

let activeController = null

async function runCheck() {
  const target = normalizeHttpUrl(urlInput.value)
  if (!target) {
    inlineError.value = t('tools.corsChecker.errInvalidUrl')
    outcome.value = null
    return
  }
  inlineError.value = ''
  showDetails.value = false
  loading.value = true
  outcome.value = null
  const headers = {}
  if (useCustomHeader.value) headers[TEST_HEADER_NAME] = TEST_HEADER_VALUE

  activeController = new AbortController()
  const timer = setTimeout(() => activeController.abort(), TIMEOUT_MS)
  const started = performance.now()
  try {
    try {
      const res = await fetch(target, {
        method: method.value,
        headers,
        mode: 'cors',
        redirect: 'follow',
        signal: activeController.signal,
      })
      const headerPairs = []
      res.headers.forEach((value, name) => {
        headerPairs.push([name, value])
      })
      outcome.value = {
        type: 'allowed',
        status: res.status,
        elapsedMs: Math.round(performance.now() - started),
        headers: headerPairs,
        finalUrl: res.url || target,
        probe: null,
        errorName: '',
      }
    } catch (firstError) {
      // TypeError 多为 CORS 拦截；再以 no-cors GET 探测区分网络可达性
      const aborted = firstError && firstError.name === 'AbortError'
      const probeController = new AbortController()
      activeController = probeController
      const probeTimer = setTimeout(() => probeController.abort(), TIMEOUT_MS)
      try {
        await fetch(target, { mode: 'no-cors', method: 'GET', cache: 'no-store', signal: probeController.signal })
        outcome.value = {
          type: aborted ? 'timeout' : 'blocked',
          status: null,
          elapsedMs: Math.round(performance.now() - started),
          headers: [],
          finalUrl: target,
          probe: 'ok',
          errorName: aborted ? 'AbortError' : (firstError && firstError.name) || 'TypeError',
        }
      } catch {
        outcome.value = {
          type: 'unreachable',
          status: null,
          elapsedMs: Math.round(performance.now() - started),
          headers: [],
          finalUrl: target,
          probe: 'failed',
          errorName: aborted ? 'AbortError' : (firstError && firstError.name) || 'TypeError',
        }
      } finally {
        clearTimeout(probeTimer)
      }
    }
  } catch {
    inlineError.value = t('tools.corsChecker.errCheckFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    clearTimeout(timer)
    loading.value = false
    activeController = null
  }
}

/** 结果分类展示配置 */
const outcomeMeta = computed(() => {
  switch (outcome.value && outcome.value.type) {
    case 'allowed':
      return {
        titleKey: 'resAllowed',
        descKey: 'resAllowedDesc',
        cls: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        iconCls: 'text-emerald-500',
      }
    case 'blocked':
      return {
        titleKey: 'resBlocked',
        descKey: 'resBlockedDesc',
        cls: 'bg-orange-50 border-orange-200 text-orange-700',
        iconCls: 'text-orange-500',
      }
    case 'timeout':
      return {
        titleKey: 'resTimeout',
        descKey: 'resTimeoutDesc',
        cls: 'bg-amber-50 border-amber-200 text-amber-700',
        iconCls: 'text-amber-500',
      }
    default:
      return {
        titleKey: 'resUnreachable',
        descKey: 'resUnreachableDesc',
        cls: 'bg-slate-100 border-slate-200 text-slate-600',
        iconCls: 'text-slate-400',
      }
  }
})

/** 可读响应头索引（小写化） */
const headerMap = computed(() => {
  const map = {}
  const pairs = (outcome.value && outcome.value.headers) || []
  for (const [name, value] of pairs) map[name.toLowerCase()] = value
  return map
})

/** 关键 CORS 响应头行：读不到的显示「浏览器不可读」 */
const corsHeaderRows = computed(() =>
  CORS_HEADER_ROWS.map(row => ({
    key: row.key,
    name: row.name,
    value: headerMap.value[row.name.toLowerCase()] || '',
  })),
)

const sameOrigin = computed(() => {
  const o = outcome.value
  if (!o || !o.finalUrl) return false
  try {
    return new URL(o.finalUrl).origin === window.location.origin
  } catch {
    return false
  }
})

/** 配置建议规则引擎 */
const suggestions = computed(() => {
  const list = []
  const o = outcome.value
  if (!o) return list
  const origin = window.location.origin
  const acao = headerMap.value['access-control-allow-origin']
  if (o.type === 'allowed') {
    if (sameOrigin.value) list.push(t('tools.corsChecker.sugSameOrigin'))
    if (acao === '*') list.push(t('tools.corsChecker.sugWildcardCredentials'))
    else if (acao) list.push(t('tools.corsChecker.sugAcoOk') + ' ' + acao)
    if (useCustomHeader.value) list.push(t('tools.corsChecker.sugCustomHeaderPassed') + ' ' + TEST_HEADER_NAME)
  } else if (o.type === 'blocked' || o.type === 'timeout') {
    list.push(t('tools.corsChecker.sugAddAco') + ' ' + origin)
    list.push(t('tools.corsChecker.sugPreflight'))
    if (method.value === 'PUT' || method.value === 'DELETE') {
      list.push(t('tools.corsChecker.sugAllowMethods') + ' ' + method.value)
    }
    if (method.value === 'POST') list.push(t('tools.corsChecker.sugPostJson'))
    if (useCustomHeader.value) {
      list.push(t('tools.corsChecker.sugAllowHeaders') + ' ' + TEST_HEADER_NAME)
    }
  } else if (o.type === 'unreachable') {
    list.push(t('tools.corsChecker.sugCheckDomain'))
    list.push(t('tools.corsChecker.sugMixedContent'))
  }
  if (o.type === 'timeout') list.push(t('tools.corsChecker.sugTimeout'))
  list.push(t('tools.corsChecker.sugCredentials'))
  list.push(t('tools.corsChecker.sugServerSide'))
  return list
})

function toggleDetails() {
  showDetails.value = !showDetails.value
}

onBeforeUnmount(() => {
  if (activeController) {
    try {
      activeController.abort()
    } catch {
      // 忽略中断异常
    }
    activeController = null
  }
})
</script>

<template>
  <ToolPage tool-id="corsChecker">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="cors-url-input">{{ t('tools.corsChecker.urlLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="cors-url-input"
          v-model="urlInput"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.corsChecker.urlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="runCheck"
        />
        <select v-model="method" class="input-base sm:w-32" :aria-label="t('tools.corsChecker.methodLabel')">
          <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
        <button type="button" class="btn-primary shrink-0" :disabled="loading" @click="runCheck">
          {{ loading ? t('toolsCommon.processing') : t('tools.corsChecker.checkBtn') }}
        </button>
      </div>
      <p v-if="inlineError" class="mt-2 text-sm text-red-600">{{ inlineError }}</p>

      <!-- 自定义请求头开关 -->
      <div class="mt-3 flex items-start gap-2.5">
        <input id="cors-custom-header" v-model="useCustomHeader" type="checkbox" class="mt-0.5 w-4 h-4 accent-blue-600" />
        <label for="cors-custom-header" class="text-sm text-slate-600 cursor-pointer select-none">
          {{ t('tools.corsChecker.customHeaderLabel') }}
          <span class="block text-xs text-slate-400 mt-0.5">{{ t('tools.corsChecker.customHeaderHint') }}</span>
        </label>
      </div>
    </section>

    <!-- 检测中 -->
    <section v-if="loading" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-3 text-slate-500">
        <span
          class="inline-block w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
          aria-hidden="true"
        ></span>
        <span class="text-sm">{{ t('tools.corsChecker.checking') }}</span>
      </div>
    </section>

    <!-- 结果区 -->
    <template v-if="outcome && !loading">
      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.corsChecker.resultTitle') }}</h2>
        <div class="rounded-xl border p-3.5" :class="outcomeMeta.cls">
          <div class="flex items-center gap-2 font-semibold text-sm">
            <svg
              class="w-5 h-5 shrink-0"
              :class="outcomeMeta.iconCls"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path v-if="outcome.type === 'allowed'" d="M8 12.5l2.5 2.5L16 9.5" />
              <path v-else d="M12 8v4M12 15.5v.5" />
            </svg>
            <span>{{ t('tools.corsChecker.' + outcomeMeta.titleKey) }}</span>
          </div>
          <p class="mt-1.5 text-sm leading-relaxed">{{ t('tools.corsChecker.' + outcomeMeta.descKey) }}</p>
        </div>

        <!-- 关键 CORS 响应头 -->
        <h3 class="mt-4 mb-2 text-sm font-medium text-slate-600">{{ t('tools.corsChecker.corsHeadersTitle') }}</h3>
        <div class="rounded-xl border border-slate-200 overflow-hidden">
          <div
            v-for="(row, index) in corsHeaderRows"
            :key="row.key"
            class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2"
            :class="index > 0 ? 'border-t border-slate-100' : ''"
          >
            <span class="text-xs font-mono text-slate-500 sm:w-72 shrink-0">{{ row.name }}</span>
            <span v-if="row.value" class="text-xs font-mono text-slate-700 break-all">{{ row.value }}</span>
            <span v-else class="text-xs text-slate-400">{{ t('tools.corsChecker.notReadable') }}</span>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400 leading-relaxed">{{ t('tools.corsChecker.exposeNote') }}</p>

        <!-- 可读响应头明细表 -->
        <template v-if="outcome.type === 'allowed'">
          <h3 class="mt-4 mb-2 text-sm font-medium text-slate-600">{{ t('tools.corsChecker.readableHeadersTitle') }}</h3>
          <p v-if="!outcome.headers.length" class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>
          <div v-else class="rounded-xl border border-slate-200 overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-slate-50 text-left text-xs text-slate-500">
                  <th class="px-3 py-2 font-medium">{{ t('tools.corsChecker.headerNameCol') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('tools.corsChecker.headerValueCol') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pair in outcome.headers" :key="pair[0]" class="border-t border-slate-100">
                  <td class="px-3 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{{ pair[0] }}</td>
                  <td class="px-3 py-2 font-mono text-xs text-slate-700 break-all">{{ pair[1] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- 配置建议 -->
        <h3 class="mt-4 mb-2 text-sm font-medium text-slate-600">{{ t('tools.corsChecker.suggestionsTitle') }}</h3>
        <ul class="space-y-1.5">
          <li v-for="(item, index) in suggestions" :key="index" class="flex items-start gap-2 text-sm text-slate-600">
            <span class="text-blue-500 mt-0.5 shrink-0" aria-hidden="true">•</span>
            <span class="leading-relaxed">{{ item }}</span>
          </li>
        </ul>

        <!-- 请求 / 响应详情折叠区 -->
        <div class="mt-4 pt-3 border-t border-slate-100">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            @click="toggleDetails"
          >
            <svg
              class="w-4 h-4 transition-transform"
              :class="showDetails ? 'rotate-90' : ''"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {{ t('tools.corsChecker.detailsToggle') }}
          </button>
          <dl v-if="showDetails" class="mt-2.5 divide-y divide-slate-100">
            <div class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailFinalUrl') }}</dt>
              <dd class="text-xs font-mono text-slate-700 break-all">{{ outcome.finalUrl }}</dd>
            </div>
            <div class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailStatus') }}</dt>
              <dd class="text-xs font-mono text-slate-700">
                <template v-if="outcome.status !== null">{{ outcome.status }}</template>
                <template v-else>{{ t('tools.corsChecker.statusHidden') }}</template>
              </dd>
            </div>
            <div class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailElapsed') }}</dt>
              <dd class="text-xs font-mono text-slate-700">{{ outcome.elapsedMs }} ms</dd>
            </div>
            <div class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailProbe') }}</dt>
              <dd class="text-xs text-slate-700">
                {{
                  outcome.probe === 'ok'
                    ? t('tools.corsChecker.probeOk')
                    : outcome.probe === 'failed'
                      ? t('tools.corsChecker.probeFailed')
                      : t('tools.corsChecker.probeSkipped')
                }}
              </dd>
            </div>
            <div v-if="outcome.errorName" class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailError') }}</dt>
              <dd class="text-xs font-mono text-slate-700">{{ outcome.errorName }}</dd>
            </div>
            <div class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
              <dt class="text-xs text-slate-500 sm:w-32 shrink-0">{{ t('tools.corsChecker.detailMethod') }}</dt>
              <dd class="text-xs font-mono text-slate-700">
                {{ method }}{{ useCustomHeader ? ' + ' + TEST_HEADER_NAME + ': ' + TEST_HEADER_VALUE : '' }}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </template>

    <!-- 浏览器限制说明 -->
    <div class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/70 !border-amber-100 flex items-start gap-2.5" role="note">
      <svg
        class="w-5 h-5 shrink-0 mt-0.5 text-amber-500"
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
      <p class="text-sm text-amber-700 leading-relaxed">{{ t('tools.corsChecker.browserLimitNote') }}</p>
    </div>

    <!-- 隐私说明 -->
    <div class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100 flex items-start gap-2.5" role="note">
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.corsChecker.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * HTTP Header 查看器：优先直连目标 URL 读取完整响应头（需站点允许
 * CORS）；被浏览器同源策略拦截时自动降级 allorigins 公共代理，
 * 仅展示状态码与内容类型等部分信息。URL 输入持久化
 */

const REQUEST_TIMEOUT = 10000
const PROXY_BASE = 'https://api.allorigins.win/get?url='

/** 关键字段高亮（小写头名 → i18n 键） */
const KEY_FIELDS = [
  { name: 'content-type', labelKey: 'fieldContentType' },
  { name: 'server', labelKey: 'fieldServer' },
  { name: 'content-length', labelKey: 'fieldContentLength' },
  { name: 'cache-control', labelKey: 'fieldCacheControl' },
  { name: 'set-cookie', labelKey: 'fieldSetCookie' },
]

const { t } = useI18n()
const toast = useToast()

/** 持久化：URL 输入 */
const config = useStorage('tool-http-headers-config', { url: '' })
const urlInput = ref(typeof config.value.url === 'string' ? config.value.url : '')
watch(urlInput, value => {
  config.value.url = value
})

const loading = ref(false)
const error = ref('')
/** { mode: 'direct' | 'proxy', url, ... } */
const result = ref(null)

/** 补全 https 前缀并用 URL 构造器校验，返回绝对 URL 或 null */
function buildUrl(raw) {
  let value = raw.trim()
  if (!value) return null
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = 'https://' + value
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

async function inspect() {
  const url = buildUrl(urlInput.value)
  if (!url) {
    error.value = t('tools.httpHeadersViewer.errInvalidUrl')
    return
  }
  loading.value = true
  error.value = ''
  result.value = null

  // 第一步：直连读取（CORS 允许时可获取完整响应头）
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' })
    const headers = []
    for (const [name, value] of res.headers.entries()) {
      headers.push({ name, value })
    }
    result.value = { mode: 'direct', url, status: res.status, headers }
    toast.success(t('toolsCommon.done'))
    loading.value = false
    return
  } catch {
    // 直连失败（多为 CORS 拦截），继续尝试代理
  }

  // 第二步：降级公共代理
  try {
    const res = await fetchWithTimeout(PROXY_BASE + encodeURIComponent(url))
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const status = data && data.status ? data.status : null
    const httpCode = status && Number(status.http_code)
    if (!status || !httpCode) throw new Error('proxy returned no status')
    result.value = {
      mode: 'proxy',
      url,
      httpCode,
      contentType: typeof status.content_type === 'string' ? status.content_type : '',
      contentLength: Number.isFinite(Number(status.content_length)) && status.content_length !== null
        ? Number(status.content_length)
        : null,
      responseTime: typeof status.response_time === 'number' ? status.response_time : null,
    }
    toast.info(t('tools.httpHeadersViewer.proxyNotice'))
  } catch {
    result.value = null
    error.value = t('tools.httpHeadersViewer.errFetchFailed')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    loading.value = false
  }
}

/** 大小写不敏感地查找响应头 */
function lookupHeader(name) {
  if (!result.value || result.value.mode !== 'direct') return ''
  const found = result.value.headers.find(
    item => item.name.toLowerCase() === name.toLowerCase()
  )
  return found ? found.value : ''
}

/** 关键字段高亮卡片（仅展示实际可见的） */
const keyFieldRows = computed(() => {
  if (!result.value || result.value.mode !== 'direct') return []
  return KEY_FIELDS.map(field => ({
    name: field.name,
    label: t('tools.httpHeadersViewer.' + field.labelKey),
    value: lookupHeader(field.name),
  })).filter(field => field.value !== '')
})

const allHeadersText = computed(() => {
  if (!result.value || result.value.mode !== 'direct') return ''
  return result.value.headers.map(item => item.name + ': ' + item.value).join('\n')
})

function statusClasses(code) {
  if (code >= 200 && code < 300) return '!bg-green-50 !text-green-600 !border-green-200'
  if (code >= 300 && code < 400) return '!bg-blue-50 !text-blue-600 !border-blue-200'
  if (code >= 400 && code < 500) return '!bg-orange-50 !text-orange-600 !border-orange-200'
  return '!bg-red-50 !text-red-600 !border-red-200'
}
</script>

<template>
  <ToolPage tool-id="httpHeadersViewer">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="headers-url">{{ t('tools.httpHeadersViewer.urlLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="headers-url"
          v-model="urlInput"
          type="text"
          class="input-base font-mono flex-1"
          :placeholder="t('tools.httpHeadersViewer.urlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="inspect"
        />
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="loading"
          @click="inspect"
        >
          {{ loading ? t('tools.httpHeadersViewer.inspecting') : t('tools.httpHeadersViewer.inspectBtn') }}
        </button>
      </div>
      <p v-if="loading" class="mt-2 text-sm text-slate-400">
        {{ t('tools.httpHeadersViewer.inspecting') }}
      </p>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!loading && !result && !error"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('tools.httpHeadersViewer.emptyHint') }}
    </section>

    <!-- 结果区 -->
    <template v-if="result">
      <!-- 汇总：目标 + 来源模式 + 状态码 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip font-mono !bg-slate-50 !text-slate-600 !border-slate-200 break-all">
            {{ result.url }}
          </span>
          <span
            v-if="result.mode === 'direct'"
            class="chip !bg-green-50 !text-green-600 !border-green-200"
          >
            {{ t('tools.httpHeadersViewer.modeDirect') }}
          </span>
          <span
            v-else
            class="chip !bg-amber-50 !text-amber-600 !border-amber-200"
          >
            {{ t('tools.httpHeadersViewer.modeProxy') }}
          </span>
          <span
            v-if="result.mode === 'direct'"
            class="chip font-mono font-semibold"
            :class="statusClasses(result.status)"
          >
            HTTP {{ result.status }}
          </span>
          <span
            v-else
            class="chip font-mono font-semibold"
            :class="statusClasses(result.httpCode)"
          >
            HTTP {{ result.httpCode }}
          </span>
        </div>
      </section>

      <!-- 直连模式：关键字段 + 完整响应头表 -->
      <template v-if="result.mode === 'direct'">
        <!-- 关键字段高亮 -->
        <section v-if="keyFieldRows.length" class="glass-card p-4 sm:p-6 mb-4">
          <h2 class="section-title">{{ t('tools.httpHeadersViewer.keyFields') }}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              v-for="field in keyFieldRows"
              :key="field.name"
              class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2.5"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold text-blue-600 break-all">{{ field.label }}</p>
                <CopyButton compact :text="field.name + ': ' + field.value" />
              </div>
              <p class="mt-1 text-sm text-slate-700 font-mono break-all">{{ field.value }}</p>
            </div>
          </div>
        </section>

        <!-- 全部响应头 -->
        <section class="glass-card p-4 sm:p-6 mb-4">
          <div class="flex items-center justify-between gap-2 mb-2">
            <h2 class="section-title !mb-0">
              {{ t('tools.httpHeadersViewer.allHeaders') }}
              <span class="text-xs text-slate-400 font-normal ml-1">
                {{ result.headers.length }} {{ t('toolsCommon.items') }}
              </span>
            </h2>
            <CopyButton
              v-if="result.headers.length"
              :text="allHeadersText"
              :label="t('toolsCommon.copyAll')"
            />
          </div>
          <p v-if="!result.headers.length" class="text-sm text-slate-400">
            {{ t('toolsCommon.none') }}
          </p>
          <ul v-else class="divide-y divide-slate-100">
            <li
              v-for="header in result.headers"
              :key="header.name"
              class="py-2.5 flex items-start justify-between gap-3"
            >
              <div class="min-w-0 flex-1">
                <p class="text-xs font-semibold text-slate-500 break-all">{{ header.name }}</p>
                <p class="mt-0.5 text-sm text-slate-700 font-mono break-all">
                  {{ header.value || '—' }}
                </p>
              </div>
              <CopyButton compact :text="header.name + ': ' + header.value" />
            </li>
          </ul>
        </section>
      </template>

      <!-- 代理模式：仅部分信息 -->
      <template v-else>
        <section class="glass-card p-4 sm:p-6 mb-4">
          <h2 class="section-title">{{ t('tools.httpHeadersViewer.proxySectionTitle') }}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2.5">
              <p class="text-xs text-slate-400">{{ t('tools.httpHeadersViewer.proxyContentType') }}</p>
              <p class="mt-1 text-sm text-slate-700 font-mono break-all">
                {{ result.contentType || '—' }}
              </p>
            </div>
            <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2.5">
              <p class="text-xs text-slate-400">{{ t('tools.httpHeadersViewer.proxyContentLength') }}</p>
              <p class="mt-1 text-sm text-slate-700 font-mono">
                {{ result.contentLength === null ? '—' : result.contentLength + ' ' + t('toolsCommon.bytes') }}
              </p>
            </div>
            <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2.5">
              <p class="text-xs text-slate-400">{{ t('tools.httpHeadersViewer.proxyResponseTime') }}</p>
              <p class="mt-1 text-sm text-slate-700 font-mono">
                {{ result.responseTime === null ? '—' : result.responseTime + ' ms' }}
              </p>
            </div>
          </div>
        </section>

        <!-- 浏览器限制说明 -->
        <div
          class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/70 !border-amber-100 flex items-start gap-2.5"
          role="note"
        >
          <span class="text-lg leading-none mt-0.5" aria-hidden="true">⚠️</span>
          <p class="text-sm text-amber-700 leading-relaxed">
            {{ t('tools.httpHeadersViewer.proxyInfo') }}
          </p>
        </div>
      </template>
    </template>
  </ToolPage>
</template>

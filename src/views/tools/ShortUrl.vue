<script setup>
import { ref, watch } from 'vue'
import { normalizeHttpUrl } from '@/utils/url'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * 短链接生成：主通道 spoo.me（原生支持浏览器跨域），
 * 备选 is.gd（部分网络环境无法跨域访问）；支持可选自定义后缀。
 * 历史记录经 useStorage 持久化（上限 20 条），当前会话生成的条目带「本次会话」标记
 */

const PRIMARY_ENDPOINT = 'https://spoo.me/'
const FALLBACK_ENDPOINT = 'https://is.gd/create.php'
const REQUEST_TIMEOUT = 10000
const HISTORY_LIMIT = 20
const ALIAS_RE = /^[A-Za-z0-9]+$/

/** 会话标识：用于在持久化历史中标记本次会话生成的条目 */
const SESSION_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const { t } = useI18n()
const toast = useToast()

/** 持久化输入内容 */
const config = useStorage('tool-short-url-config', { longUrl: '', customAlias: '' })
const longUrl = ref(typeof config.value.longUrl === 'string' ? config.value.longUrl : '')
const customAlias = ref(typeof config.value.customAlias === 'string' ? config.value.customAlias : '')
watch(longUrl, value => {
  config.value.longUrl = value
})
watch(customAlias, value => {
  config.value.customAlias = value
})

/** 持久化历史记录（最新在前，最多 20 条） */
const history = useStorage('tool-short-url-history', [])
if (!Array.isArray(history.value)) {
  history.value = []
} else {
  history.value = history.value.filter(e => e && typeof e.long === 'string' && typeof e.short === 'string')
}

const loading = ref(false)
const error = ref('')
const result = ref('')

/** 判断是否已带协议头（排除 host:port 形式，如 localhost:3000） */
function hasProtocol(value) {
  const m = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/)
  if (!m) return false
  if (/^\d/.test(m[2])) return false
  return !m[1].includes('.')
}

/** 自动补 https:// 并用 URL 构造校验，非法返回空字符串 */

function isSessionEntry(entry) {
  return Boolean(entry) && entry.sid === SESSION_ID
}

function pushHistory(longUrlValue, shortUrlValue) {
  const entry = { long: longUrlValue, short: shortUrlValue, sid: SESSION_ID, time: Date.now() }
  history.value = [entry, ...history.value.filter(e => e && e.short !== shortUrlValue)].slice(0, HISTORY_LIMIT)
}

function clearHistory() {
  history.value = []
}

async function generate() {
  if (loading.value) return
  error.value = ''
  const normalized = normalizeHttpUrl(longUrl.value)
  if (!normalized) {
    error.value = t('tools.shortUrl.errInvalidUrl')
    return
  }
  const alias = customAlias.value.trim()
  if (alias && !ALIAS_RE.test(alias)) {
    error.value = t('tools.shortUrl.errInvalidSuffix')
    return
  }
  loading.value = true
  result.value = ''
  try {
    /** 单通道请求：spoo.me 走 POST 表单，is.gd 走 GET 查询参数 */
    async function requestVia(provider) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
      try {
        let res
        if (provider === 'spoo') {
          const body = new URLSearchParams({ url: normalized })
          if (alias) body.set('alias', alias)
          res = await fetch(PRIMARY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: body.toString(),
            signal: controller.signal,
          })
        } else {
          let endpoint = FALLBACK_ENDPOINT + '?format=json&url=' + encodeURIComponent(normalized)
          if (alias) endpoint += '&shorturl=' + encodeURIComponent(alias)
          res = await fetch(endpoint, { signal: controller.signal })
        }
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return await res.json()
      } finally {
        clearTimeout(timer)
      }
    }

    let data
    try {
      data = await requestVia('spoo')
    } catch {
      // 主通道失败：降级 is.gd
      data = await requestVia('isgd')
    }

    const shortLink = data && (data.short_url || data.shorturl)
    if (shortLink) {
      result.value = String(shortLink)
      pushHistory(normalized, result.value)
      toast.success(t('tools.shortUrl.generated'))
    } else {
      // API 业务错误（如自定义后缀已被占用）：行内展示原始信息
      const apiMsg = data && (data.error || data.errormessage)
      error.value = (apiMsg ? String(apiMsg) : '') || t('tools.shortUrl.errApi')
    }
  } catch {
    error.value = t('toolsCommon.networkError')
    toast.error(t('toolsCommon.networkError'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <ToolPage tool-id="shortUrl">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col gap-3">
        <div>
          <label class="label-base" for="short-url-input">{{ t('tools.shortUrl.longLabel') }}</label>
          <input
            id="short-url-input"
            v-model="longUrl"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.shortUrl.longPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="generate"
          />
        </div>
        <div class="flex flex-col sm:flex-row sm:items-end gap-3">
          <div class="flex-1 min-w-0">
            <label class="label-base" for="short-url-alias">{{ t('tools.shortUrl.customLabel') }}</label>
            <input
              id="short-url-alias"
              v-model="customAlias"
              type="text"
              class="input-base font-mono"
              :placeholder="t('tools.shortUrl.customPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              maxlength="64"
              @keyup.enter="generate"
            />
          </div>
          <button type="button" class="btn-primary shrink-0" :disabled="loading" :aria-busy="loading" @click="generate">
            <span
              v-if="loading"
              class="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
              aria-hidden="true"
            ></span>
            {{ t('tools.shortUrl.generateBtn') }}
          </button>
        </div>
        <p v-if="error" class="text-sm text-red-600 break-all">{{ error }}</p>
      </div>
    </section>

    <!-- 生成结果 -->
    <section v-if="result" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.shortUrl.resultTitle') }}</h2>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <a
          :href="result"
          target="_blank"
          rel="noopener noreferrer"
          class="text-base font-semibold text-blue-600 hover:text-blue-700 hover:underline break-all font-mono min-w-0"
        >
          {{ result }}
        </a>
        <div class="flex items-center gap-2 sm:ml-auto shrink-0">
          <CopyButton :text="result" :label="t('toolsCommon.copy')" />
          <a :href="result" target="_blank" rel="noopener noreferrer" class="btn-ghost">
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
            {{ t('tools.shortUrl.openBtn') }}
          </a>
        </div>
      </div>
    </section>

    <!-- 历史记录 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-1">
        <h2 class="section-title !mb-0">
          {{ t('tools.shortUrl.historyTitle') }} · {{ history.length }} {{ t('toolsCommon.items') }}
        </h2>
        <button v-if="history.length > 0" type="button" class="btn-danger" @click="clearHistory">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <p v-if="history.length === 0" class="py-6 text-center text-sm text-slate-400">
        {{ t('toolsCommon.none') }}
      </p>
      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="entry in history"
          :key="entry.short + entry.time"
          class="py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
        >
          <span class="text-xs text-slate-400 truncate sm:max-w-[38%]" :title="entry.long">{{ entry.long }}</span>
          <span class="text-slate-300 text-sm hidden sm:block" aria-hidden="true">→</span>
          <a
            :href="entry.short"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm font-medium text-blue-600 hover:underline truncate font-mono min-w-0"
          >
            {{ entry.short }}
          </a>
          <span class="flex items-center gap-1.5 sm:ml-auto shrink-0">
            <span v-if="isSessionEntry(entry)" class="chip">{{ t('tools.shortUrl.sessionChip') }}</span>
            <CopyButton compact :text="entry.short" />
          </span>
        </li>
      </ul>
    </section>

    <!-- 隐私说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.shortUrl.privacyNote') }}</p>
    </div>
  </ToolPage>
</template>

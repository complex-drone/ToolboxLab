<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { normalizeHttpUrl } from '@/utils/url'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'
import { randomInt } from '@/utils/random'
import { downloadBlob } from '@/utils/download'

/**
 * 网页截图生成：
 * - 主服务 WordPress mShots：首次请求可能返回灰色占位图，
 *   onload 后延时 3 秒追加时间戳参数重载，最多重试 2 次
 * - 备用服务 thum.io：可通过选项卡切换，主服务加载失败时自动切换
 * - 下载：fetch 截图转 blob；CORS 失败则新标签页打开原图并提示手动保存
 */

const WIDTH_OPTIONS = [640, 1024, 1280, 1600]
const CAPTURE_HEIGHT = 960
const MSHOTS_BASE = 'https://s.wordpress.com/mshots/v1/'
const THUMIO_BASE = 'https://image.thum.io/get/'
const RELOAD_DELAY = 3000
const MAX_RELOADS = 2
const DOWNLOAD_TIMEOUT = 10000

const PROVIDERS = [
  { value: 'mshots', labelKey: 'tools.webpageScreenshot.providerPrimary' },
  { value: 'thumio', labelKey: 'tools.webpageScreenshot.providerBackup' },
]

const { t } = useI18n()
const toast = useToast()

/** 持久化：URL、宽度与截图服务 */
const config = useStorage('tool-webpage-screenshot-config', { url: '', width: 1280, provider: 'mshots' })
const urlInput = ref(typeof config.value.url === 'string' ? config.value.url : '')
const width = ref(WIDTH_OPTIONS.includes(Number(config.value.width)) ? Number(config.value.width) : 1280)
const provider = ref(PROVIDERS.some(p => p.value === config.value.provider) ? config.value.provider : 'mshots')
watch(urlInput, value => {
  config.value.url = value
})
watch(width, value => {
  config.value.width = value
})
watch(provider, value => {
  config.value.provider = value
})

/** 当前正在渲染的截图请求状态 */
const submittedUrl = ref('')
const requestKey = ref(0)
const reloadToken = ref(0)
const reloadCount = ref(0)
const loading = ref(false)
const loadFailed = ref(false)
const error = ref('')
const downloading = ref(false)
let reloadTimer = null

function clearReloadTimer() {
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
}

/** 判断是否已带协议头（排除 host:port 形式，如 localhost:3000） */
function hasProtocol(value) {
  const m = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/)
  if (!m) return false
  if (/^\d/.test(m[2])) return false
  return !m[1].includes('.')
}

/** 自动补 https:// 并用 URL 构造校验，非法返回空字符串 */

const currentSrc = computed(() => {
  if (!submittedUrl.value) return ''
  if (provider.value === 'thumio') {
    let src = THUMIO_BASE + 'width/' + width.value + '/crop/' + CAPTURE_HEIGHT + '/' + submittedUrl.value
    if (reloadToken.value > 0) src += '?_t=' + reloadToken.value
    return src
  }
  let src = MSHOTS_BASE + encodeURIComponent(submittedUrl.value) + '?w=' + width.value + '&h=' + CAPTURE_HEIGHT
  if (reloadToken.value > 0) src += '&_t=' + reloadToken.value
  return src
})

/** 发起一次新的截图请求（重置重载计数与占位状态） */
function startRequest() {
  if (!submittedUrl.value) return
  clearReloadTimer()
  reloadCount.value = 0
  reloadToken.value = 0
  loadFailed.value = false
  loading.value = true
  requestKey.value++
}

function generate() {
  const normalized = normalizeHttpUrl(urlInput.value)
  if (!normalized) {
    error.value = t('tools.webpageScreenshot.errInvalidUrl')
    return
  }
  error.value = ''
  submittedUrl.value = normalized
  startRequest()
}

function retry() {
  if (urlInput.value.trim()) generate()
  else startRequest()
}

// 宽度或服务切换：用当前 URL 重新生成
watch([provider, width], () => {
  startRequest()
})

function onImgLoad() {
  if (provider.value !== 'mshots' || reloadCount.value >= MAX_RELOADS) {
    loading.value = false
    return
  }
  // mshots 首次请求可能返回灰色占位图：onload 后延时 3 秒
  // 追加时间戳参数重新加载，最多重试 2 次
  clearReloadTimer()
  reloadTimer = setTimeout(() => {
    reloadCount.value++
    reloadToken.value = randomInt(1000000000)
    loading.value = true
    requestKey.value++
  }, RELOAD_DELAY)
}

function onImgError() {
  clearReloadTimer()
  if (provider.value === 'mshots' && submittedUrl.value) {
    // 加载失败自动切换到备用服务（watch 会触发重新请求）
    provider.value = 'thumio'
    toast.info(t('tools.webpageScreenshot.switchedBackup'))
    return
  }
  loading.value = false
  loadFailed.value = true
}

function screenshotFilename() {
  let host = 'screenshot'
  try {
    host = new URL(submittedUrl.value).hostname || 'screenshot'
  } catch {
    // 保持默认文件名
  }
  return host + '-' + width.value + '.png'
}

/** fetch 截图转 blob 下载；CORS 失败则新标签页打开原图 */
async function download() {
  if (!currentSrc.value || downloading.value) return
  downloading.value = true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)
  try {
    const res = await fetch(currentSrc.value, { signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const ext = blob.type && blob.type.includes('jpeg') ? 'jpg' : 'png'
    downloadBlob(blob, screenshotFilename().replace(/\.png$/, '.' + ext))
  } catch {
    window.open(currentSrc.value, '_blank', 'noopener,noreferrer')
    toast.info(t('tools.webpageScreenshot.openManually'))
  } finally {
    clearTimeout(timer)
    downloading.value = false
  }
}

onMounted(() => {
  // 存在持久化 URL 时自动生成一次
  if (normalizeHttpUrl(urlInput.value)) generate()
})

onBeforeUnmount(() => {
  clearReloadTimer()
})
</script>

<template>
  <ToolPage tool-id="webpageScreenshot">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col gap-3">
        <div>
          <label class="label-base" for="screenshot-url">{{ t('tools.webpageScreenshot.urlLabel') }}</label>
          <input
            id="screenshot-url"
            v-model="urlInput"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.webpageScreenshot.urlPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="generate"
          />
        </div>
        <div class="flex flex-col sm:flex-row sm:items-end gap-3">
          <div class="sm:w-36 shrink-0">
            <label class="label-base" for="screenshot-width">{{ t('tools.webpageScreenshot.widthLabel') }}</label>
            <select id="screenshot-width" v-model.number="width" class="input-base">
              <option v-for="w in WIDTH_OPTIONS" :key="w" :value="w">{{ w }} px</option>
            </select>
          </div>
          <div class="shrink-0">
            <span class="label-base">{{ t('tools.webpageScreenshot.providerLabel') }}</span>
            <div class="inline-flex rounded-xl border border-slate-200 bg-white/70 p-1">
              <button
                v-for="p in PROVIDERS"
                :key="p.value"
                type="button"
                class="px-3 py-1.5 rounded-lg text-sm font-medium transition"
                :class="provider === p.value ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-blue-600'"
                :aria-pressed="provider === p.value"
                @click="provider = p.value"
              >
                {{ t(p.labelKey) }}
              </button>
            </div>
          </div>
          <button type="button" class="btn-primary sm:ml-auto shrink-0" :disabled="loading" :aria-busy="loading" @click="generate">
            <span
              v-if="loading"
              class="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
              aria-hidden="true"
            ></span>
            {{ t('tools.webpageScreenshot.generateBtn') }}
          </button>
        </div>
        <p v-if="error" class="text-sm text-red-600 break-all">{{ error }}</p>
      </div>
    </section>

    <!-- 截图预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h2 class="section-title !mb-0">{{ t('toolsCommon.preview') }}</h2>
        <button
          v-if="submittedUrl && !loadFailed"
          type="button"
          class="btn-ghost"
          :disabled="downloading || loading"
          @click="download"
        >
          <span
            v-if="downloading"
            class="inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin"
            aria-hidden="true"
          ></span>
          <svg
            v-else
            class="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('toolsCommon.download') }}
        </button>
      </div>

      <!-- 空状态 -->
      <div
        v-if="!submittedUrl"
        class="aspect-[4/3] rounded-xl border-2 border-dashed border-slate-200 bg-white/50 flex flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <svg
          class="w-8 h-8 text-slate-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <p class="text-sm text-slate-400">{{ t('tools.webpageScreenshot.emptyHint') }}</p>
      </div>

      <!-- 截图画布 -->
      <div v-else class="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        <img
          v-if="!loadFailed"
          :key="requestKey"
          :src="currentSrc"
          class="w-full h-full object-contain bg-white"
          :alt="t('tools.webpageScreenshot.altText')"
          decoding="async"
          @load="onImgLoad"
          @error="onImgError"
        />
        <!-- 失败状态 -->
        <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center bg-white/70">
          <p class="text-sm text-red-600">{{ t('tools.webpageScreenshot.loadFailed') }}</p>
          <button type="button" class="btn-ghost" @click="retry">{{ t('tools.webpageScreenshot.retryBtn') }}</button>
        </div>
        <!-- 加载中 skeleton 遮罩 -->
        <div
          v-if="loading && !loadFailed"
          class="absolute inset-0 z-10 bg-slate-200/70 animate-pulse flex items-center justify-center"
        >
          <span
            class="inline-block w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-500 animate-spin"
            aria-hidden="true"
          ></span>
        </div>
      </div>
      <p v-if="loading && !loadFailed" class="mt-2 text-xs text-slate-400">
        {{ t('tools.webpageScreenshot.loadingHint') }}
      </p>
    </section>

    <!-- 说明 -->
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.webpageScreenshot.note') }}</p>
    </div>
  </ToolPage>
</template>

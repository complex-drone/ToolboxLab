<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { normalizeHttpUrl } from '@/utils/url'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

/**
 * RSS / Atom 阅读器：主用 rss2json 公共接口（CORS 友好），
 * 失败时降级为直连抓取源地址并用 DOMParser 解析 RSS 2.0 / Atom XML；
 * 摘要经 DOMPurify 清洗后按纯文本截断 200 字符展示
 */

const REQUEST_TIMEOUT = 10000
const SUMMARY_MAX = 200
const MAX_ITEMS = 25

const { t } = useI18n()
const toast = useToast()

/** 订阅源地址持久化 */
const config = useStorage('tool-rss-reader-config', { url: '' })
const url = ref(typeof config.value.url === 'string' ? config.value.url : '')
watch(url, value => {
  config.value.url = value
})

const loading = ref(false)
const tryingDirect = ref(false)
const error = ref('')
/** 归一化后的订阅源数据：{ title, description, link, host, items } */
const feed = ref(null)
const faviconBroken = ref(false)

/** 校验订阅源地址：缺协议时自动补 https 前提下仍需为合法 http(s) 地址 */


/** 从地址中提取主机名（用于 favicon 与站点展示） */
function hostOf(value) {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

/** 带超时与 AbortController 的 fetch 封装 */
function fetchWithTimeout(target, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(target, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/** 惰性加载 DOMPurify（动态 import） */
let dompurifyModule = null
async function getDomPurify() {
  if (!dompurifyModule) dompurifyModule = await import('dompurify')
  return dompurifyModule.default
}

/** HTML 清洗为纯文本：先用 DOMPurify 去除全部标签与脚本，再解码实体 */
async function htmlToText(raw) {
  const html = String(raw || '')
  if (!html) return ''
  const DOMPurify = await getDomPurify()
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/** 纯文本摘要截断 */
function truncateText(text, max) {
  const value = String(text || '')
  if (value.length <= max) return value
  return value.slice(0, max) + '…'
}

/** 日期格式化为本地时间（yyyy-MM-dd hh:mm） */
function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  )
}

/** 构建展示条目（摘要异步清洗） */
async function buildItem(raw) {
  const summary = truncateText(await htmlToText(raw.summaryRaw), SUMMARY_MAX)
  return {
    title: String(raw.title || '').trim() || t('tools.rssReader.untitled'),
    link: String(raw.link || '').trim(),
    author: String(raw.author || '').trim(),
    date: formatDateTime(raw.pubDate),
    thumb: String(raw.thumb || '').trim(),
    thumbBroken: false,
    summary,
  }
}

/** 主通道：rss2json 公共接口 */
async function loadViaRss2json(target) {
  const res = await fetchWithTimeout(
    'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(target) + '&count=' + MAX_ITEMS
  )
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const data = await res.json()
  if (!data || data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('rss2json failed')
  const header = data.feed || {}
  return {
    title: String(header.title || ''),
    description: String(header.description || ''),
    link: String(header.link || ''),
    host: hostOf(header.link || target),
    items: await Promise.all(
      data.items.map(item =>
        buildItem({
          title: item.title,
          link: item.link,
          author: item.author,
          pubDate: item.pubDate,
          thumb: item.thumbnail || (item.enclosure && item.enclosure.link) || '',
          summaryRaw: item.description || item.content || '',
        })
      )
    ),
  }
}

/** XML 工具：读取指定子标签文本 */
function childText(parent, tag) {
  const els = parent.getElementsByTagName(tag)
  if (els.length) return (els[0].textContent || '').trim()
  return ''
}

/** Atom 的 link 取 href 属性（优先 alternate） */
function atomLink(parent) {
  const links = parent.getElementsByTagName('link')
  for (let i = 0; i < links.length; i++) {
    const rel = links[i].getAttribute('rel')
    const href = links[i].getAttribute('href') || ''
    if ((!rel || rel === 'alternate') && href) return href
  }
  return ''
}

/** 缩略图：enclosure 或 media 扩展 */
function enclosureUrl(el) {
  const enclosures = el.getElementsByTagName('enclosure')
  if (enclosures.length) {
    const found = enclosures[0].getAttribute('url')
    if (found) return found
  }
  const media = el.getElementsByTagName('media:content')
  if (media.length) {
    const found = media[0].getAttribute('url')
    if (found) return found
  }
  return ''
}

/** 降级通道：直连抓取源地址并解析 RSS 2.0 / Atom XML */
async function loadDirect(target) {
  const res = await fetchWithTimeout(target)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid xml')

  const channel = doc.getElementsByTagName('channel')[0]
  const atomFeed = doc.getElementsByTagName('feed')[0]
  const root = channel || atomFeed
  if (!root) throw new Error('no channel or feed')

  const itemEls = channel ? root.getElementsByTagName('item') : root.getElementsByTagName('entry')
  if (!itemEls.length) throw new Error('empty feed')

  const rawItems = Array.prototype.slice.call(itemEls, 0, MAX_ITEMS).map(el => {
    if (channel) {
      return {
        title: childText(el, 'title'),
        link: childText(el, 'link'),
        author: childText(el, 'author') || childText(el, 'dc:creator'),
        pubDate: childText(el, 'pubDate') || childText(el, 'dc:date'),
        thumb: enclosureUrl(el),
        summaryRaw: childText(el, 'description'),
      }
    }
    return {
      title: childText(el, 'title'),
      link: atomLink(el),
      author: childText(el, 'name') || childText(el, 'author'),
      pubDate: childText(el, 'published') || childText(el, 'updated'),
      thumb: enclosureUrl(el),
      summaryRaw: childText(el, 'summary') || childText(el, 'content'),
    }
  })

  return {
    title: childText(root, 'title'),
    description: channel ? childText(root, 'description') : childText(root, 'subtitle'),
    link: atomLink(root),
    host: hostOf(target),
    items: await Promise.all(rawItems.map(buildItem)),
  }
}

/** 请求序号：防止自动加载与手动点击并发时旧请求覆盖新结果 */
let loadSeq = 0

async function loadFeed() {
  const seq = ++loadSeq
  const raw = url.value.trim()
  if (!normalizeHttpUrl(raw)) {
    error.value = t('tools.rssReader.errInvalidUrl')
    feed.value = null
    return
  }
  const target = normalizeHttpUrl(raw)
  loading.value = true
  tryingDirect.value = false
  error.value = ''
  faviconBroken.value = false
  try {
    const data = await loadViaRss2json(target)
    if (seq !== loadSeq) return
    feed.value = data
  } catch {
    // 主通道失败：降级为直连抓取解析
    if (seq !== loadSeq) return
    tryingDirect.value = true
    try {
      const data = await loadDirect(target)
      if (seq !== loadSeq) return
      feed.value = data
      toast.info(t('tools.rssReader.usingFallback'))
    } catch {
      if (seq !== loadSeq) return
      feed.value = null
      error.value = t('tools.rssReader.errFetchFailed')
      toast.error(t('toolsCommon.networkError'))
    } finally {
      if (seq === loadSeq) tryingDirect.value = false
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

const faviconUrl = computed(() => {
  const host = feed.value && feed.value.host
  return host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=64' : ''
})

onMounted(() => {
  if (url.value.trim()) loadFeed()
})
</script>

<template>
  <ToolPage tool-id="rssReader">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="rss-url-input">{{ t('tools.rssReader.urlLabel') }}</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="rss-url-input"
          v-model="url"
          type="text"
          class="input-base font-mono"
          :placeholder="t('tools.rssReader.urlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="loadFeed"
        />
        <button type="button" class="btn-primary shrink-0" :disabled="loading" @click="loadFeed">
          <svg
            v-if="loading"
            class="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-9-9" />
            <polyline points="21 3 21 12 12 12" />
          </svg>
          <svg
            v-else
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
          {{ t('tools.rssReader.fetchBtn') }}
        </button>
      </div>
      <p v-if="error && !loading" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </section>

    <!-- 降级提示 -->
    <p v-if="tryingDirect" class="mb-4 flex items-center gap-2 text-sm text-amber-600">
      <span
        class="inline-block w-3.5 h-3.5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"
        aria-hidden="true"
      ></span>
      {{ t('tools.rssReader.tryingDirect') }}
    </p>

    <!-- 加载骨架屏 -->
    <section v-if="loading" class="glass-card p-4 sm:p-6 mb-4" aria-hidden="true">
      <div class="animate-pulse">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-slate-200/70 shrink-0"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-slate-200/70 rounded w-1/3"></div>
            <div class="h-3 bg-slate-200/70 rounded w-2/3"></div>
          </div>
        </div>
        <div class="mt-5 space-y-4">
          <div v-for="i in 5" :key="i" class="flex gap-3">
            <div class="w-20 h-20 rounded-xl bg-slate-200/70 shrink-0"></div>
            <div class="flex-1 space-y-2 py-1">
              <div class="h-3.5 bg-slate-200/70 rounded w-3/4"></div>
              <div class="h-3 bg-slate-200/70 rounded w-1/2"></div>
              <div class="h-3 bg-slate-200/70 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <template v-else>
      <!-- Feed 头部卡片 -->
      <section v-if="feed" class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-start gap-3 sm:gap-4">
          <img
            v-if="faviconUrl && !faviconBroken"
            :src="faviconUrl"
            class="w-12 h-12 rounded-xl border border-slate-200 bg-white object-contain p-1.5 shrink-0"
            alt=""
            @error="faviconBroken = true"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 flex-wrap">
              <h2 class="text-base sm:text-lg font-bold text-slate-800 break-words">
                {{ feed.title || feed.host }}
              </h2>
              <span class="chip shrink-0">{{ t('tools.rssReader.articleCount', { n: feed.items.length }) }}</span>
            </div>
            <p v-if="feed.description" class="mt-1 text-xs sm:text-sm text-slate-500 leading-relaxed line-clamp-3">
              {{ feed.description }}
            </p>
            <a
              v-if="feed.link"
              :href="feed.link"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline break-all"
            >
              {{ feed.host }}
              <svg
                class="w-3 h-3 shrink-0"
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
        </div>
      </section>

      <!-- 文章列表 -->
      <section v-if="feed" class="glass-card p-4 sm:p-6 mb-4">
        <p v-if="!feed.items.length" class="py-10 text-center text-sm text-slate-400">
          {{ t('tools.rssReader.emptyFeed') }}
        </p>
        <div v-else class="divide-y divide-slate-100">
          <article v-for="(item, index) in feed.items" :key="index" class="py-4 flex gap-3 sm:gap-4">
            <a
              v-if="item.thumb && !item.thumbBroken && item.link"
              :href="item.link"
              target="_blank"
              rel="noopener noreferrer"
              class="shrink-0"
            >
              <img
                :src="item.thumb"
                class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border border-slate-200 bg-white"
                loading="lazy"
                :alt="item.title"
                @error="item.thumbBroken = true"
              />
            </a>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm sm:text-base font-semibold leading-snug">
                <a
                  v-if="item.link"
                  :href="item.link"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-blue-600 hover:text-blue-700 hover:underline break-words"
                >
                  {{ item.title }}
                </a>
                <span v-else class="text-slate-700">{{ item.title }}</span>
              </h3>
              <div class="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-slate-400">
                <span
                  v-if="item.date"
                  class="chip !bg-slate-50 !text-slate-500 !border-slate-200 font-mono !text-xs"
                >
                  {{ item.date }}
                </span>
                <span v-if="item.author" class="truncate max-w-full">
                  {{ t('tools.rssReader.authorLabel') }}: {{ item.author }}
                </span>
              </div>
              <p v-if="item.summary" class="mt-1.5 text-xs sm:text-sm text-slate-500 leading-relaxed line-clamp-2">
                {{ item.summary }}
              </p>
            </div>
          </article>
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
      <p class="text-sm text-blue-700 leading-relaxed">{{ t('tools.rssReader.note') }}</p>
    </div>
  </ToolPage>
</template>

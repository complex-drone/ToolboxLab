<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsText, downloadText } from '@/utils/download'

/**
 * 书签失效链接清理器：
 * 1. 解析浏览器导出的书签 HTML（DOMParser），提取 a[href] 并去重
 * 2. 批量探测：fetch no-cors（opaque 响应 = 网络可达，HTTP 状态码不可知），
 *    并发 6 路 worker pool，AbortController 8 秒超时；抛错或超时视为无法访问
 * 3. 结果三档：可达 / 跳过（非 http https）/ 无法访问；支持筛选、勾选
 * 4. 导出：剔除失效链接后的书签 HTML、检测结果 CSV
 * 受 CORS 限制无法读取跨域状态码，结果仅供参考（UI 中已诚实说明）
 */

const PROBE_TIMEOUT = 8000
const CONCURRENCY = 6
const HTTP_URL_RE = /^https?:\/\//i

const { t } = useI18n()
const toast = useToast()

/** 解析后的链接列表：id / url / title / status（pending checking ok fail skipped） */
const links = ref([])
/** 解析统计：rawTotal 锚点总数、deduped 去重后、skipped 跳过数 */
const parseStats = ref(null)
const htmlInput = ref('')
const inlineError = ref('')

/** 检测状态 */
const checking = ref(false)
const stopRequested = ref(false)
let activeControllers = new Set()
let nextId = 1

/** 结果筛选与勾选 */
const activeTab = ref('all')
const selectedIds = ref([])
/** 清理范围：仅剔除勾选的失效链接 */
const cleanOnlySelected = ref(false)

onBeforeUnmount(() => {
  // 卸载时中止所有在途探测
  stopRequested.value = true
  for (const controller of activeControllers) {
    try {
      controller.abort()
    } catch {
      /* 忽略中止异常 */
    }
  }
  activeControllers = new Set()
})

/** 解析书签 HTML：提取、过滤、去重 */
function parseBookmarkHtml(html) {
  let doc
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
  const anchors = Array.from(doc.querySelectorAll('a[href]'))
  const seen = new Set()
  const parsed = []
  let checkable = 0
  let skipped = 0
  for (const anchor of anchors) {
    const href = (anchor.getAttribute('href') || '').trim()
    const title = (anchor.textContent || '').replace(/\s+/g, ' ').trim()
    // 仅探测 http/https；javascript:、#、空链接等标记为跳过
    if (!HTTP_URL_RE.test(href)) {
      skipped++
      if (href && !seen.has(href)) {
        seen.add(href)
        parsed.push({ id: nextId++, url: href, title: title || href, status: 'skipped' })
      }
      continue
    }
    if (seen.has(href)) continue
    seen.add(href)
    checkable++
    parsed.push({ id: nextId++, url: href, title: title || href, status: 'pending' })
  }
  return { parsed, rawTotal: anchors.length, deduped: parsed.length, checkable, skipped }
}

/** 执行解析（上传文件与粘贴共用） */
function applyParse(html) {
  // 若正在检测，先停止上一轮
  stopRequested.value = true
  for (const controller of activeControllers) {
    try {
      controller.abort()
    } catch {
      /* 忽略 */
    }
  }
  activeControllers = new Set()
  checking.value = false

  inlineError.value = ''
  selectedIds.value = []
  activeTab.value = 'all'
  cleanOnlySelected.value = false

  const result = parseBookmarkHtml(html)
  if (!result || result.rawTotal === 0 || result.deduped === 0) {
    links.value = []
    parseStats.value = null
    inlineError.value = t('tools.bookmarkLinkChecker.errNoLinks')
    return
  }
  links.value = result.parsed
  parseStats.value = {
    rawTotal: result.rawTotal,
    deduped: result.deduped,
    checkable: result.checkable,
    skipped: result.skipped,
  }
}

async function onFile(file) {
  try {
    const text = await readFileAsText(file)
    applyParse(text)
  } catch {
    inlineError.value = t('tools.bookmarkLinkChecker.errParseFailed')
  }
}

function onPasteParse() {
  const html = htmlInput.value
  if (!html.trim()) {
    inlineError.value = t('tools.bookmarkLinkChecker.errEmptyInput')
    return
  }
  applyParse(html)
}

/** 单个链接探测：no-cors + 8 秒超时 */
function probeLink(item) {
  const controller = new AbortController()
  activeControllers.add(controller)
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT)
  return fetch(item.url, {
    mode: 'no-cors',
    redirect: 'follow',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(() => {
      // opaque 响应：网络可达（状态码不可知）
      item.status = 'ok'
    })
    .catch(err => {
      const aborted = err && err.name === 'AbortError'
      // 用户主动停止的回置为待检测；超时或网络错误视为无法访问
      item.status = aborted && stopRequested.value ? 'pending' : 'fail'
    })
    .finally(() => {
      clearTimeout(timer)
      activeControllers.delete(controller)
    })
}

/** 批量探测：6 路并发 worker pool */
async function startCheck() {
  if (checking.value) return
  const queue = links.value.filter(item => item.status === 'pending')
  if (queue.length === 0) return
  inlineError.value = ''
  checking.value = true
  stopRequested.value = false

  let cursor = 0
  const worker = async () => {
    while (!stopRequested.value) {
      const item = queue[cursor++]
      if (!item) break
      item.status = 'checking'
      await probeLink(item)
    }
  }
  const workerCount = Math.min(CONCURRENCY, queue.length)
  const workers = []
  for (let i = 0; i < workerCount; i++) workers.push(worker())
  try {
    await Promise.all(workers)
  } catch {
    inlineError.value = t('toolsCommon.networkError')
  }
  checking.value = false
  if (!stopRequested.value) {
    toast.success(t('toolsCommon.done'))
  }
}

function stopCheck() {
  stopRequested.value = true
  for (const controller of activeControllers) {
    try {
      controller.abort()
    } catch {
      /* 忽略 */
    }
  }
  toast.info(t('tools.bookmarkLinkChecker.stoppedMsg'))
}

/** 待检测链接（不含跳过项） */
const checkableItems = computed(() => links.value.filter(item => item.status !== 'skipped'))
const checkedCount = computed(
  () => checkableItems.value.filter(item => item.status === 'ok' || item.status === 'fail').length
)
const totalCount = computed(() => checkableItems.value.length)
const progressPercent = computed(() =>
  totalCount.value === 0 ? 0 : Math.round((checkedCount.value / totalCount.value) * 100)
)
const hasPending = computed(() => links.value.some(item => item.status === 'pending'))
const progressText = computed(
  () => t('tools.bookmarkLinkChecker.checkedLabel') + ' ' + checkedCount.value + ' / ' + totalCount.value
)

/** 筛选 Tab */
const tabList = computed(() => [
  { key: 'all', label: t('tools.bookmarkLinkChecker.tabAll'), count: links.value.length },
  {
    key: 'fail',
    label: t('tools.bookmarkLinkChecker.tabFail'),
    count: links.value.filter(item => item.status === 'fail').length,
  },
  {
    key: 'ok',
    label: t('tools.bookmarkLinkChecker.tabOk'),
    count: links.value.filter(item => item.status === 'ok').length,
  },
  {
    key: 'skipped',
    label: t('tools.bookmarkLinkChecker.tabSkipped'),
    count: links.value.filter(item => item.status === 'skipped').length,
  },
])
const filteredItems = computed(() => {
  if (activeTab.value === 'fail') return links.value.filter(item => item.status === 'fail')
  if (activeTab.value === 'ok') return links.value.filter(item => item.status === 'ok')
  if (activeTab.value === 'skipped') return links.value.filter(item => item.status === 'skipped')
  return links.value
})

function switchTab(key) {
  activeTab.value = key
}

/** 状态徽章文案与配色 */
function statusText(status) {
  const map = {
    pending: 'statusPending',
    checking: 'statusChecking',
    ok: 'statusOk',
    fail: 'statusFail',
    skipped: 'statusSkipped',
  }
  return t('tools.bookmarkLinkChecker.' + (map[status] || 'statusPending'))
}

function statusClass(status) {
  switch (status) {
    case 'ok':
      return '!bg-emerald-50 !text-emerald-600 !border-emerald-200'
    case 'fail':
      return '!bg-red-50 !text-red-600 !border-red-200'
    case 'skipped':
      return '!bg-amber-50 !text-amber-600 !border-amber-200'
    case 'checking':
      return '!bg-blue-50 !text-blue-600 !border-blue-200'
    default:
      return '!bg-slate-50 !text-slate-500 !border-slate-200'
  }
}

/** 失效链接勾选 */
const failItems = computed(() => links.value.filter(item => item.status === 'fail'))
const selectedCount = computed(() => selectedIds.value.length)
const allFailSelected = computed(
  () => failItems.value.length > 0 && failItems.value.every(item => selectedIds.value.includes(item.id))
)

function toggleSelect(id) {
  const index = selectedIds.value.indexOf(id)
  if (index === -1) {
    selectedIds.value = selectedIds.value.concat(id)
  } else {
    selectedIds.value = selectedIds.value.filter(value => value !== id)
  }
}

function toggleSelectAll() {
  if (allFailSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = failItems.value.map(item => item.id)
  }
}

/** 生成清理后的书签 HTML（NETSCAPE-BOOKMARK 结构） */
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildCleanHtml() {
  const onlySelected = cleanOnlySelected.value && selectedIds.value.length > 0
  const kept = links.value.filter(item => {
    if (item.status !== 'fail') return true
    return onlySelected ? selectedIds.value.includes(item.id) : false
  })
  const lines = []
  lines.push('<!DOCTYPE NETSCAPE-BOOKMARK-file>')
  lines.push('<!-- Cleaned by ToolboxLab Bookmark Link Checker -->')
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
  const fileTitle = escapeHtmlText(t('tools.bookmarkLinkChecker.fileTitle'))
  lines.push('<TITLE>' + fileTitle + '</TITLE>')
  lines.push('<H1>' + fileTitle + '</H1>')
  lines.push('<DL><p>')
  const addDate = String(Math.floor(Date.now() / 1000))
  for (const item of kept) {
    lines.push(
      '    <DT><A HREF="' +
        escapeHtmlText(item.url) +
        '" ADD_DATE="' +
        addDate +
        '">' +
        escapeHtmlText(item.title) +
        '</A>'
    )
  }
  lines.push('</DL><p>')
  return lines.join('\n')
}

function exportCleanHtml() {
  if (links.value.length === 0) {
    inlineError.value = t('tools.bookmarkLinkChecker.errNoResults')
    return
  }
  const hasRemovable = cleanOnlySelected.value
    ? links.value.some(item => item.status === 'fail' && selectedIds.value.includes(item.id))
    : failItems.value.length > 0
  if (!hasRemovable) {
    inlineError.value = t('tools.bookmarkLinkChecker.errNoFail')
    return
  }
  const html = buildCleanHtml()
  downloadText(html, 'bookmarks-cleaned.html', 'text/html;charset=utf-8')
  toast.success(t('tools.bookmarkLinkChecker.cleanDoneMsg'))
}

/** 导出检测结果 CSV（逗号引号合规转义） */
function csvCell(value) {
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return text
}

function exportCsv() {
  if (links.value.length === 0) {
    inlineError.value = t('tools.bookmarkLinkChecker.errNoResults')
    return
  }
  const head = [
    t('tools.bookmarkLinkChecker.csvHeadUrl'),
    t('tools.bookmarkLinkChecker.csvHeadTitle'),
    t('tools.bookmarkLinkChecker.csvHeadStatus'),
  ]
  const rows = [head]
  for (const item of links.value) {
    rows.push([item.url, item.title, statusText(item.status)])
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  downloadText(csv, 'bookmark-link-check-results.csv', 'text/csv;charset=utf-8')
  toast.success(t('tools.bookmarkLinkChecker.csvDoneMsg'))
}
</script>

<template>
  <ToolPage tool-id="bookmarkLinkChecker">
    <!-- 输入区：上传书签 HTML 或粘贴片段 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.bookmarkLinkChecker.inputTitle') }}</h2>
      <FileDropZone
        accept=".html,.htm"
        :maxSizeMB="10"
        :hint="t('tools.bookmarkLinkChecker.dropHint')"
        @files="onFile"
      />

      <p class="label-base mt-4">{{ t('tools.bookmarkLinkChecker.pasteLabel') }}</p>
      <textarea
        v-model="htmlInput"
        class="input-base font-mono text-xs leading-relaxed"
        rows="5"
        :placeholder="t('tools.bookmarkLinkChecker.pastePlaceholder')"
        spellcheck="false"
      ></textarea>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary" @click="onPasteParse">
          {{ t('tools.bookmarkLinkChecker.parseBtn') }}
        </button>
      </div>

      <p v-if="inlineError" class="mt-3 text-sm text-red-600">{{ inlineError }}</p>
    </section>

    <!-- 解析统计 + 批量检测 -->
    <section v-if="links.length" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.bookmarkLinkChecker.statsTitle') }}</h2>
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-xl bg-slate-50/80 border border-slate-100 px-3 py-2 text-center">
          <p class="text-xs text-slate-400">{{ t('tools.bookmarkLinkChecker.statRaw') }}</p>
          <p class="text-lg font-semibold text-slate-700 font-mono tabular-nums">
            {{ parseStats.rawTotal }}
          </p>
        </div>
        <div class="rounded-xl bg-blue-50/70 border border-blue-100 px-3 py-2 text-center">
          <p class="text-xs text-slate-400">{{ t('tools.bookmarkLinkChecker.statDeduped') }}</p>
          <p class="text-lg font-semibold text-blue-700 font-mono tabular-nums">
            {{ parseStats.deduped }}
          </p>
        </div>
        <div class="rounded-xl bg-amber-50/70 border border-amber-100 px-3 py-2 text-center">
          <p class="text-xs text-slate-400">{{ t('tools.bookmarkLinkChecker.statSkipped') }}</p>
          <p class="text-lg font-semibold text-amber-600 font-mono tabular-nums">
            {{ parseStats.skipped }}
          </p>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="section-title !mb-0">{{ t('tools.bookmarkLinkChecker.checkTitle') }}</h3>
          <div class="flex-1"></div>
          <button
            type="button"
            class="btn-primary"
            :disabled="checking || !hasPending"
            @click="startCheck"
          >
            {{
              checking
                ? t('toolsCommon.processing')
                : hasPending && checkedCount > 0
                  ? t('tools.bookmarkLinkChecker.continueCheckBtn')
                  : t('tools.bookmarkLinkChecker.startCheckBtn')
            }}
          </button>
          <button v-if="checking" type="button" class="btn-danger" @click="stopCheck">
            {{ t('tools.bookmarkLinkChecker.stopCheckBtn') }}
          </button>
        </div>

        <!-- 实时进度条 -->
        <div v-if="totalCount > 0" class="mt-3">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs text-slate-400">
              {{ t('tools.bookmarkLinkChecker.progressLabel') }}
            </span>
            <span class="text-xs font-medium text-slate-600 font-mono tabular-nums">
              {{ progressText }}
            </span>
          </div>
          <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              class="h-full rounded-full bg-blue-500 transition-all duration-200"
              :style="{ width: progressPercent + '%' }"
            ></div>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400 leading-relaxed">
          {{ t('tools.bookmarkLinkChecker.probeHint') }}
        </p>
      </div>
    </section>

    <!-- 结果列表：筛选 Tab + 勾选 -->
    <section v-if="links.length" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title !mb-0">{{ t('tools.bookmarkLinkChecker.resultsTitle') }}</h2>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="tab in tabList"
            :key="tab.key"
            type="button"
            class="chip cursor-pointer select-none"
            :class="activeTab === tab.key ? '' : '!bg-slate-50 !text-slate-500 !border-slate-200'"
            :aria-pressed="activeTab === tab.key ? 'true' : 'false'"
            @click="switchTab(tab.key)"
          >
            {{ tab.label }} {{ tab.count }}
          </button>
        </div>
      </div>

      <div v-if="failItems.length" class="flex flex-wrap items-center gap-3 mb-2 pb-2 border-b border-slate-100">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            class="w-4 h-4 accent-blue-600"
            :checked="allFailSelected"
            @change="toggleSelectAll"
          />
          {{ t('tools.bookmarkLinkChecker.selectBrokenAll') }}
        </label>
        <span v-if="selectedCount" class="chip !bg-blue-50 font-mono">
          {{ t('tools.bookmarkLinkChecker.selectedLabel') }} {{ selectedCount }}
        </span>
      </div>

      <p v-if="filteredItems.length === 0" class="py-8 text-center text-sm text-slate-400">
        {{ t('tools.bookmarkLinkChecker.tabEmpty') }}
      </p>

      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="item in filteredItems"
          :key="item.id"
          class="py-2.5 flex items-start gap-2.5"
        >
          <input
            v-if="item.status === 'fail'"
            type="checkbox"
            class="w-4 h-4 mt-1 shrink-0 accent-blue-600"
            :checked="selectedIds.includes(item.id)"
            :aria-label="item.title"
            @change="toggleSelect(item.id)"
          />
          <span v-else class="w-4 h-4 mt-1 shrink-0" aria-hidden="true"></span>

          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-slate-700 truncate">{{ item.title }}</p>
            <p class="text-xs text-slate-400 font-mono break-all leading-relaxed">{{ item.url }}</p>
          </div>

          <span class="chip shrink-0 font-semibold" :class="statusClass(item.status)">
            <span
              v-if="item.status === 'checking'"
              class="inline-block w-3 h-3 mr-1 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
              aria-hidden="true"
            ></span>
            {{ statusText(item.status) }}
          </span>
        </li>
      </ul>
    </section>

    <!-- 导出 -->
    <section v-if="links.length" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.bookmarkLinkChecker.exportTitle') }}</h2>
      <label class="flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none mb-1">
        <input
          v-model="cleanOnlySelected"
          type="checkbox"
          class="w-4 h-4 mt-0.5 shrink-0 accent-blue-600"
        />
        {{ t('tools.bookmarkLinkChecker.cleanOption') }}
      </label>
      <p class="text-xs text-slate-400 mb-3 leading-relaxed">
        {{ t('tools.bookmarkLinkChecker.cleanOptionHint') }}
      </p>
      <div class="flex flex-col sm:flex-row flex-wrap gap-2">
        <button type="button" class="btn-primary" @click="exportCleanHtml">
          {{ t('tools.bookmarkLinkChecker.exportCleanBtn') }}
        </button>
        <button type="button" class="btn-ghost" @click="exportCsv">
          {{ t('tools.bookmarkLinkChecker.exportCsvBtn') }}
        </button>
      </div>
    </section>

    <!-- 初始空状态 -->
    <section
      v-if="!links.length && !inlineError"
      class="glass-card p-8 sm:p-12 mb-4 text-center text-sm text-slate-400"
    >
      {{ t('toolsCommon.none') }}
    </section>

    <!-- 浏览器限制与三档结果说明 -->
    <section
      class="glass-card p-4 sm:p-6 mb-4 !bg-blue-50/70 !border-blue-100"
      role="note"
    >
      <h2 class="section-title !text-blue-700">{{ t('tools.bookmarkLinkChecker.noteTitle') }}</h2>
      <p class="text-sm text-blue-700 leading-relaxed mb-3">
        {{ t('tools.bookmarkLinkChecker.noteText') }}
      </p>
      <ul class="space-y-1.5 text-xs text-blue-600 leading-relaxed">
        <li>✅ {{ t('tools.bookmarkLinkChecker.statusOkNote') }}</li>
        <li>❌ {{ t('tools.bookmarkLinkChecker.statusFailNote') }}</li>
        <li>⚠️ {{ t('tools.bookmarkLinkChecker.statusSkippedNote') }}</li>
      </ul>
    </section>
  </ToolPage>
</template>

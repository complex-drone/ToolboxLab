<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t } = useI18n()

/**
 * MIME 类型参考
 * - 数据集为组件常量（130 条），按分类注释组织
 * - 智能识别搜索方向：含 / 按 MIME 反查，否则按扩展名正查；也可手动切换 Tab
 * - 实时过滤：正查先精确后前缀/包含，反查子串匹配
 * - 结果行展示「扩展名 ↔ MIME」并按方向复制对应值
 */

/* ---------------- 数据集（组件常量，分类注释） ---------------- */

// —— 文本 / 标记 / 数据格式 ——
const TEXT_DATA = [
  { ext: 'html', mime: 'text/html' },
  { ext: 'htm', mime: 'text/html' },
  { ext: 'css', mime: 'text/css' },
  { ext: 'js', mime: 'text/javascript' },
  { ext: 'mjs', mime: 'text/javascript' },
  { ext: 'json', mime: 'application/json' },
  { ext: 'jsonld', mime: 'application/ld+json' },
  { ext: 'geojson', mime: 'application/geo+json' },
  { ext: 'ndjson', mime: 'application/x-ndjson' },
  { ext: 'webmanifest', mime: 'application/manifest+json' },
  { ext: 'xml', mime: 'application/xml' },
  { ext: 'xhtml', mime: 'application/xhtml+xml' },
  { ext: 'txt', mime: 'text/plain' },
  { ext: 'log', mime: 'text/plain' },
  { ext: 'ini', mime: 'text/plain' },
  { ext: 'md', mime: 'text/markdown' },
  { ext: 'markdown', mime: 'text/markdown' },
  { ext: 'csv', mime: 'text/csv' },
  { ext: 'tsv', mime: 'text/tab-separated-values' },
  { ext: 'ics', mime: 'text/calendar' },
  { ext: 'rtf', mime: 'application/rtf' },
  { ext: 'yaml', mime: 'text/yaml' },
  { ext: 'yml', mime: 'text/yaml' },
  { ext: 'sh', mime: 'application/x-sh' },
  { ext: 'vtt', mime: 'text/vtt' },
  { ext: 'srt', mime: 'application/x-subrip' },
]

// —— 文档 / Office ——
const DOC_DATA = [
  { ext: 'pdf', mime: 'application/pdf' },
  { ext: 'doc', mime: 'application/msword' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: 'xls', mime: 'application/vnd.ms-excel' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { ext: 'ppt', mime: 'application/vnd.ms-powerpoint' },
  { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text' },
  { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
  { ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation' },
  { ext: 'epub', mime: 'application/epub+zip' },
]

// —— 图片 ——
const IMAGE_DATA = [
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'jpeg', mime: 'image/jpeg' },
  { ext: 'jfif', mime: 'image/jpeg' },
  { ext: 'png', mime: 'image/png' },
  { ext: 'apng', mime: 'image/apng' },
  { ext: 'gif', mime: 'image/gif' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'svg', mime: 'image/svg+xml' },
  { ext: 'avif', mime: 'image/avif' },
  { ext: 'ico', mime: 'image/x-icon' },
  { ext: 'cur', mime: 'image/x-icon' },
  { ext: 'bmp', mime: 'image/bmp' },
  { ext: 'tif', mime: 'image/tiff' },
  { ext: 'tiff', mime: 'image/tiff' },
  { ext: 'heic', mime: 'image/heic' },
  { ext: 'heif', mime: 'image/heif' },
  { ext: 'jxl', mime: 'image/jxl' },
  { ext: 'psd', mime: 'image/vnd.adobe.photoshop' },
]

// —— 音频 ——
const AUDIO_DATA = [
  { ext: 'mp3', mime: 'audio/mpeg' },
  { ext: 'wav', mime: 'audio/wav' },
  { ext: 'ogg', mime: 'audio/ogg' },
  { ext: 'oga', mime: 'audio/ogg' },
  { ext: 'm4a', mime: 'audio/mp4' },
  { ext: 'aac', mime: 'audio/aac' },
  { ext: 'flac', mime: 'audio/flac' },
  { ext: 'opus', mime: 'audio/opus' },
  { ext: 'mid', mime: 'audio/midi' },
  { ext: 'midi', mime: 'audio/midi' },
  { ext: 'aif', mime: 'audio/aiff' },
  { ext: 'aiff', mime: 'audio/aiff' },
  { ext: 'wma', mime: 'audio/x-ms-wma' },
  { ext: 'm3u', mime: 'audio/x-mpegurl' },
  { ext: 'm3u8', mime: 'application/vnd.apple.mpegurl' },
  { ext: 'pls', mime: 'audio/x-scpls' },
]

// —— 视频 ——
const VIDEO_DATA = [
  { ext: 'mp4', mime: 'video/mp4' },
  { ext: 'm4v', mime: 'video/x-m4v' },
  { ext: 'webm', mime: 'video/webm' },
  { ext: 'mov', mime: 'video/quicktime' },
  { ext: 'avi', mime: 'video/x-msvideo' },
  { ext: 'mkv', mime: 'video/x-matroska' },
  { ext: 'flv', mime: 'video/x-flv' },
  { ext: 'wmv', mime: 'video/x-ms-wmv' },
  { ext: 'mpeg', mime: 'video/mpeg' },
  { ext: 'mpg', mime: 'video/mpeg' },
  { ext: '3gp', mime: 'video/3gpp' },
  { ext: '3g2', mime: 'video/3gpp2' },
  { ext: 'ogv', mime: 'video/ogg' },
  { ext: 'ts', mime: 'video/mp2t' },
]

// —— 压缩包 / 二进制 / 安装包 ——
const BINARY_DATA = [
  { ext: 'zip', mime: 'application/zip' },
  { ext: 'gz', mime: 'application/gzip' },
  { ext: 'tgz', mime: 'application/gzip' },
  { ext: 'tar', mime: 'application/x-tar' },
  { ext: 'rar', mime: 'application/vnd.rar' },
  { ext: '7z', mime: 'application/x-7z-compressed' },
  { ext: 'bz2', mime: 'application/x-bzip2' },
  { ext: 'xz', mime: 'application/x-xz' },
  { ext: 'iso', mime: 'application/x-iso9660-image' },
  { ext: 'dmg', mime: 'application/x-apple-diskimage' },
  { ext: 'exe', mime: 'application/x-msdownload' },
  { ext: 'msi', mime: 'application/x-msi' },
  { ext: 'apk', mime: 'application/vnd.android.package-archive' },
  { ext: 'jar', mime: 'application/java-archive' },
  { ext: 'war', mime: 'application/java-archive' },
  { ext: 'deb', mime: 'application/vnd.debian.binary-package' },
  { ext: 'rpm', mime: 'application/x-rpm' },
  { ext: 'cab', mime: 'application/vnd.ms-cab-compressed' },
  { ext: 'crx', mime: 'application/x-chrome-extension' },
  { ext: 'xpi', mime: 'application/x-xpinstall' },
  { ext: 'torrent', mime: 'application/x-bittorrent' },
  { ext: 'bin', mime: 'application/octet-stream' },
  { ext: 'dll', mime: 'application/octet-stream' },
  { ext: 'so', mime: 'application/octet-stream' },
  { ext: 'dylib', mime: 'application/octet-stream' },
  { ext: 'dat', mime: 'application/octet-stream' },
]

// —— 字体 ——
const FONT_DATA = [
  { ext: 'woff', mime: 'font/woff' },
  { ext: 'woff2', mime: 'font/woff2' },
  { ext: 'ttf', mime: 'font/ttf' },
  { ext: 'otf', mime: 'font/otf' },
  { ext: 'eot', mime: 'application/vnd.ms-fontobject' },
  { ext: 'ttc', mime: 'font/collection' },
]

// —— Web / 开发 / 其他 ——
const MISC_DATA = [
  { ext: 'wasm', mime: 'application/wasm' },
  { ext: 'swf', mime: 'application/x-shockwave-flash' },
  { ext: 'rss', mime: 'application/rss+xml' },
  { ext: 'atom', mime: 'application/atom+xml' },
  { ext: 'eml', mime: 'message/rfc822' },
  { ext: 'ps', mime: 'application/postscript' },
  { ext: 'eps', mime: 'application/postscript' },
  { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml' },
  { ext: 'gpx', mime: 'application/gpx+xml' },
]

/** 全量数据（顺序拼接，便于正查排序） */
const MIME_DATA = [
  ...TEXT_DATA,
  ...DOC_DATA,
  ...IMAGE_DATA,
  ...AUDIO_DATA,
  ...VIDEO_DATA,
  ...BINARY_DATA,
  ...FONT_DATA,
  ...MISC_DATA,
]

/* ---------------- 搜索方向 ---------------- */

const MODES = ['auto', 'ext', 'mime']

const query = ref('')
const mode = useStorage('tool-mime-lookup-mode', 'auto')

/** 实际生效方向：auto 时含 / 走 MIME 反查，否则按扩展名正查 */
const effectiveMode = computed(() => {
  if (mode.value !== 'auto') return mode.value
  return query.value.includes('/') ? 'mime' : 'ext'
})

/* ---------------- 过滤 ---------------- */

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (q === '') return []
  try {
    if (effectiveMode.value === 'mime') {
      return MIME_DATA.filter((item) => item.mime.includes(q))
    }
    const ext = q.startsWith('.') ? q.slice(1) : q
    if (ext === '') return []
    const exact = MIME_DATA.filter((item) => item.ext === ext)
    if (exact.length > 0) return exact
    return MIME_DATA.filter(
      (item) => item.ext.startsWith(ext) || item.ext.includes(ext)
    )
  } catch {
    return []
  }
})

const copyTextFor = (item) =>
  effectiveMode.value === 'mime' ? item.ext : item.mime

const copyLabelFor = () =>
  effectiveMode.value === 'mime'
    ? t('tools.mimeLookup.copyExt')
    : t('tools.mimeLookup.copyMime')
</script>

<template>
  <ToolPage tool-id="mimeLookup">
    <!-- 搜索与方向切换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="relative">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="query"
          type="text"
          class="input-base pl-9 pr-9 font-mono"
          :placeholder="t('tools.mimeLookup.searchPlaceholder')"
          :aria-label="t('tools.mimeLookup.searchLabel')"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md transition"
          @click="query = ''"
        >
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1.5" role="tablist" :aria-label="t('tools.mimeLookup.searchLabel')">
          <button
            v-for="m in MODES"
            :key="m"
            type="button"
            role="tab"
            class="px-3 py-1 rounded-full text-xs font-medium border transition select-none"
            :class="
              mode === m
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white/70 text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
            "
            :aria-selected="mode === m ? 'true' : 'false'"
            @click="mode = m"
          >
            {{ m === 'auto' ? t('tools.mimeLookup.tabAuto') : m === 'ext' ? t('tools.mimeLookup.tabExt') : t('tools.mimeLookup.tabMime') }}
          </button>
        </div>
        <span class="chip ml-auto">{{ MIME_DATA.length }} {{ t('tools.mimeLookup.mappingsTotal') }}</span>
      </div>

      <p class="mt-2 text-xs text-slate-400">
        {{ effectiveMode === 'mime' ? t('tools.mimeLookup.modeMimeHint') : t('tools.mimeLookup.modeExtHint') }}
      </p>
    </section>

    <!-- 结果列表 -->
    <template v-if="query.trim() !== ''">
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex items-center gap-2 mb-3">
          <h2 class="section-title flex-1 mb-0">{{ t('toolsCommon.result') }}</h2>
          <span class="chip">{{ results.length }} {{ t('tools.mimeLookup.resultsUnit') }}</span>
        </div>

        <div v-if="results.length" class="space-y-2">
          <div
            v-for="item in results"
            :key="item.ext + ':' + item.mime"
            class="flex items-center gap-2 sm:gap-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2.5"
          >
            <span class="chip font-mono font-semibold shrink-0">.{{ item.ext }}</span>
            <svg
              class="w-3.5 h-3.5 shrink-0 text-slate-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3 4 7l4 4" />
              <path d="M4 7h16" />
              <path d="m16 21 4-4-4-4" />
              <path d="M20 17H4" />
            </svg>
            <span class="font-mono text-xs sm:text-sm text-slate-700 break-all min-w-0 flex-1">
              {{ item.mime }}
            </span>
            <CopyButton
              compact
              :text="copyTextFor(item)"
              :label="copyLabelFor()"
            />
          </div>
        </div>
        <div
          v-else
          class="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400"
        >
          {{ t('tools.mimeLookup.noResults') }}
        </div>
      </section>
    </template>

    <!-- 空查询提示 -->
    <section v-else class="glass-card p-8 sm:p-12 mb-4 text-center">
      <p class="text-sm text-slate-400">{{ t('tools.mimeLookup.emptyQuery') }}</p>
    </section>
  </ToolPage>
</template>

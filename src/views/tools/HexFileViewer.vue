<script setup>
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { formatBytes } from '@/utils/format'
import { readFileAsArrayBuffer } from '@/utils/download'

/**
 * 二进制 / HEX 文件查看器
 * - 真正按需分块读取：初始窗口 2KB，「加载更多」每次追加 4KB（File.slice + FileReader）
 * - 每行 16 字节：偏移量 8 位 hex + 十六进制字节 + ASCII 对照（不可打印字符显示 ·）
 * - 查找：HEX 字节序列 / ASCII 文本两种模式，跨块扫描定位并高亮所在行，支持下一个
 * - 跳转偏移：支持 0x 前缀，按需渲染目标附近窗口
 * - Magic Number 识别：读取文件头部 16 字节自动判断格式并显示徽章
 */
const { t } = useI18n()
const toast = useToast()

const ROW = 16
const INITIAL_BYTES = 2048
const STEP_BYTES = 4096
const MAX_VIEW_BYTES = 65536 // 单窗口视图上限，防止 DOM 过大
const FIND_CHUNK = 65536
const GOTO_WINDOW = 2048
const GOTO_CONTEXT = 256 // 匹配点之前保留的上下文字节数

const file = ref(null)
const fileSize = ref(0)
const viewData = ref(null)
const viewStart = ref(0)
const viewLen = ref(0)
const loading = ref(false)
const loadError = ref('')
const magicKey = ref('')
const highlightOffset = ref(-1)
const matchOffset = ref(-1)
const gotoInput = ref('')
const gotoError = ref('')
const findMode = ref('hex') // hex | text
const findInput = ref('')
const findError = ref('')
const findWrap = ref(false)
const tableRef = ref(null)

/* ---------- 列头 ---------- */

const COL_HEADERS = Array.from({ length: ROW }, (_, i) => i.toString(16).padStart(2, '0'))

const headerHexText = COL_HEADERS.join(' ')

/* ---------- Magic Number 识别 ---------- */

function startsWithBytes(u8, bytes) {
  if (u8.length < bytes.length) return false
  return bytes.every((b, i) => u8[i] === b)
}

function asciiAt(u8, offset, len) {
  let out = ''
  for (let i = offset; i < offset + len && i < u8.length; i++) out += String.fromCharCode(u8[i])
  return out
}

function detectMagic(u8) {
  if (startsWithBytes(u8, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWithBytes(u8, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWithBytes(u8, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWithBytes(u8, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (u8[0] === 0x50 && u8[1] === 0x4b && u8.length > 3) {
    // PK 头：本地文件头 / 中央目录 / 跨卷等 ZIP 家族
    if ((u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) && (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08)) {
      return 'zip'
    }
  }
  if (startsWithBytes(u8, [0x52, 0x61, 0x72, 0x21])) return 'rar'
  if (startsWithBytes(u8, [0x37, 0x7a, 0xbc, 0xaf])) return 'sevenZip'
  if (asciiAt(u8, 0, 3) === 'ID3') return 'mp3'
  if (u8[0] === 0xff && (u8[1] === 0xfb || u8[1] === 0xf3 || u8[1] === 0xf2)) return 'mp3'
  if (asciiAt(u8, 4, 4) === 'ftyp') return 'mp4'
  if (asciiAt(u8, 0, 4) === 'RIFF') {
    const sub = asciiAt(u8, 8, 4)
    if (sub === 'WEBP') return 'webp'
    if (sub === 'WAVE') return 'wav'
  }
  if (startsWithBytes(u8, [0x7f, 0x45, 0x4c, 0x46])) return 'elf'
  if (startsWithBytes(u8, [0x4d, 0x5a])) return 'exe'
  if (asciiAt(u8, 0, 6) === 'SQLite') return 'sqlite'
  if (startsWithBytes(u8, [0x1f, 0x8b])) return 'gzip'
  if (startsWithBytes(u8, [0x00, 0x00, 0x01, 0x00])) return 'ico'
  if (startsWithBytes(u8, [0x42, 0x4d])) return 'bmp'
  return ''
}

/* ---------- 按需分块读取 ---------- */

async function readSlice(start, end) {
  const buf = await readFileAsArrayBuffer(file.value.slice(start, end))
  return new Uint8Array(buf)
}

async function showWindow(start, len) {
  const size = fileSize.value
  const s = Math.max(0, Math.min(start, Math.max(0, size - 1)))
  const l = Math.max(0, Math.min(len, size - s))
  const data = l > 0 ? await readSlice(s, s + l) : new Uint8Array(0)
  viewData.value = data
  viewStart.value = s
  viewLen.value = l
}

async function onFile(f) {
  file.value = f
  fileSize.value = f.size
  viewData.value = null
  viewStart.value = 0
  viewLen.value = 0
  magicKey.value = ''
  highlightOffset.value = -1
  matchOffset.value = -1
  gotoError.value = ''
  findError.value = ''
  loadError.value = ''
  loading.value = true
  try {
    const head = await readSlice(0, Math.min(16, f.size))
    magicKey.value = detectMagic(head)
    await showWindow(0, Math.min(INITIAL_BYTES, f.size))
  } catch {
    loadError.value = t('tools.hexFileViewer.readFailed')
  } finally {
    loading.value = false
  }
}

const canLoadMore = computed(() => !!file.value && viewStart.value + viewLen.value < fileSize.value)
const viewLimitReached = computed(() => viewLen.value >= MAX_VIEW_BYTES)

async function loadMore() {
  if (!file.value || loading.value || !canLoadMore.value || viewLimitReached.value) return
  loading.value = true
  try {
    await showWindow(viewStart.value, Math.min(viewLen.value + STEP_BYTES, MAX_VIEW_BYTES))
  } catch {
    loadError.value = t('tools.hexFileViewer.readFailed')
  } finally {
    loading.value = false
  }
}

/* ---------- 十六进制视图 ---------- */

const rows = computed(() => {
  const data = viewData.value
  if (!data || !data.length) return []
  const out = []
  for (let i = 0; i < data.length; i += ROW) {
    const slice = data.subarray(i, i + ROW)
    const hex = []
    const ascii = []
    for (let j = 0; j < ROW; j++) {
      if (j < slice.length) {
        hex.push(slice[j].toString(16).padStart(2, '0'))
        const code = slice[j]
        ascii.push(code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '·')
      } else {
        hex.push('  ')
        ascii.push(' ')
      }
    }
    const offset = viewStart.value + i
    out.push({
      offset,
      offsetHex: offset.toString(16).padStart(8, '0'),
      hexText: hex.join(' '),
      asciiText: ascii.join(''),
    })
  }
  return out
})

function isHit(row) {
  return highlightOffset.value >= 0 && highlightOffset.value >= row.offset && highlightOffset.value < row.offset + ROW
}

function scrollHitIntoView() {
  nextTick(() => {
    const el = tableRef.value && tableRef.value.querySelector('[data-hit="1"]')
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' })
    }
  })
}

/* ---------- 跳转偏移 ---------- */

function parseOffsetInput(str) {
  const raw = (str || '').trim().toLowerCase()
  if (!raw) return NaN
  if (raw.startsWith('0x')) {
    const body = raw.slice(2)
    return /^[0-9a-f]+$/.test(body) ? parseInt(body, 16) : NaN
  }
  return /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : NaN
}

async function gotoOffset() {
  if (!file.value || loading.value) return
  const value = parseOffsetInput(gotoInput.value)
  if (Number.isNaN(value) || value < 0 || value >= fileSize.value) {
    gotoError.value = t('tools.hexFileViewer.gotoInvalid')
    return
  }
  gotoError.value = ''
  loading.value = true
  try {
    const start = Math.floor(value / ROW) * ROW
    highlightOffset.value = value
    await showWindow(start, Math.max(GOTO_WINDOW, viewLen.value))
    scrollHitIntoView()
  } catch {
    gotoError.value = t('tools.hexFileViewer.readFailed')
  } finally {
    loading.value = false
  }
}

/* ---------- 查找 ---------- */

function parseQueryBytes() {
  const raw = findInput.value
  if (!raw) return { bytes: null, invalid: false }
  if (findMode.value === 'text') {
    return { bytes: new TextEncoder().encode(raw), invalid: false }
  }
  const cleaned = raw.trim().toLowerCase().replace(/0x/g, '').replace(/[\s,]+/g, '')
  if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-f]+$/.test(cleaned)) {
    return { bytes: null, invalid: true }
  }
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return { bytes, invalid: false }
}

function indexOfBytes(hay, needle) {
  if (!needle.length || needle.length > hay.length) return -1
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** 跨块顺序扫描，返回匹配的绝对偏移或 -1 */
async function searchBytes(needle, from) {
  const size = fileSize.value
  let pos = Math.max(0, from)
  let carry = new Uint8Array(0)
  while (pos < size) {
    const end = Math.min(size, pos + FIND_CHUNK)
    const buf = await readSlice(pos, end)
    let window = buf
    let base = pos
    if (carry.length) {
      window = new Uint8Array(carry.length + buf.length)
      window.set(carry, 0)
      window.set(buf, carry.length)
      base = pos - carry.length
    }
    const idx = indexOfBytes(window, needle)
    if (idx >= 0) {
      const absolute = base + idx
      if (absolute >= from) return absolute
    }
    const overlap = Math.min(needle.length - 1, window.length)
    carry = window.slice(window.length - overlap)
    pos = end
  }
  return -1
}

async function findNext() {
  if (!file.value || loading.value) return
  const { bytes, invalid } = parseQueryBytes()
  if (invalid) {
    findError.value = t('tools.hexFileViewer.findInvalidHex')
    return
  }
  if (!bytes || !bytes.length) {
    findError.value = t('toolsCommon.invalidInput')
    return
  }
  findError.value = ''
  loading.value = true
  try {
    const from = matchOffset.value >= 0 ? matchOffset.value + 1 : 0
    let found = -1
    if (from < fileSize.value) {
      found = await searchBytes(bytes, from)
    }
    if (found < 0 && from > 0 && findWrap.value) {
      found = await searchBytes(bytes, 0)
    }
    if (found < 0) {
      findError.value = t('tools.hexFileViewer.findNoMatch')
      matchOffset.value = -1
      highlightOffset.value = -1
      return
    }
    matchOffset.value = found
    highlightOffset.value = found
    const start = Math.floor(Math.max(0, found - GOTO_CONTEXT) / ROW) * ROW
    await showWindow(start, Math.max(GOTO_WINDOW, viewLen.value))
    scrollHitIntoView()
  } catch {
    findError.value = t('tools.hexFileViewer.readFailed')
  } finally {
    loading.value = false
  }
}

function switchFindMode(mode) {
  findMode.value = mode
  findError.value = ''
}

function fileTypeLabel() {
  return file.value && file.value.type ? file.value.type : t('tools.hexFileViewer.typeUnknown')
}

function magicLabel() {
  if (!magicKey.value) return t('tools.hexFileViewer.magicUnknown')
  return t(`tools.hexFileViewer.magic.${magicKey.value}`)
}

function onDropError() {
  toast.error(t('toolsCommon.unsupportedFile'))
}
</script>

<template>
  <ToolPage tool-id="hexFileViewer">
    <!-- 上传与文件信息 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <FileDropZone :max-size-mb="50" @files="onFile" @error="onDropError" />

      <div v-if="file" class="mt-4">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="label-base mb-0">{{ t('tools.hexFileViewer.fileInfo') }}</span>
          <span
            class="chip"
            :class="magicKey ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'"
          >
            {{ t('tools.hexFileViewer.magicBadge') }} · {{ magicLabel() }}
          </span>
        </div>
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          <div class="flex gap-2 min-w-0">
            <dt class="text-slate-400 flex-shrink-0">{{ t('tools.hexFileViewer.fileName') }}</dt>
            <dd class="text-slate-600 truncate" :title="file.name">{{ file.name }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-slate-400 flex-shrink-0">{{ t('tools.hexFileViewer.fileSize') }}</dt>
            <dd class="text-slate-600">{{ formatBytes(fileSize) }}（{{ fileSize }} {{ t('toolsCommon.bytes') }}）</dd>
          </div>
          <div class="flex gap-2 min-w-0">
            <dt class="text-slate-400 flex-shrink-0">{{ t('tools.hexFileViewer.fileType') }}</dt>
            <dd class="text-slate-600 truncate" :title="file.type">{{ fileTypeLabel() }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 跳转与查找 -->
    <section v-if="file" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title mb-3">{{ t('tools.hexFileViewer.locateTitle') }}</h2>

      <div class="flex flex-col sm:flex-row gap-3">
        <div class="sm:w-64">
          <label for="hex-goto" class="label-base">{{ t('tools.hexFileViewer.gotoLabel') }}</label>
          <div class="flex gap-2">
            <input
              id="hex-goto"
              v-model="gotoInput"
              type="text"
              class="input-base flex-1 min-w-0 font-mono"
              :placeholder="t('tools.hexFileViewer.gotoPlaceholder')"
              @keydown.enter="gotoOffset"
            />
            <button type="button" class="btn-ghost flex-shrink-0" :disabled="loading" @click="gotoOffset">
              {{ t('tools.hexFileViewer.gotoBtn') }}
            </button>
          </div>
          <p v-if="gotoError" class="mt-1 text-xs text-red-600">{{ gotoError }}</p>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-3 mb-1">
            <span class="label-base mb-0">{{ t('tools.hexFileViewer.findTitle') }}</span>
            <span class="inline-flex rounded-lg overflow-hidden border border-slate-300 text-xs">
              <button
                type="button"
                class="px-2.5 py-1"
                :class="findMode === 'hex' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'"
                @click="switchFindMode('hex')"
              >
                {{ t('tools.hexFileViewer.findModeHex') }}
              </button>
              <button
                type="button"
                class="px-2.5 py-1 border-l border-slate-300"
                :class="findMode === 'text' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'"
                @click="switchFindMode('text')"
              >
                {{ t('tools.hexFileViewer.findModeText') }}
              </button>
            </span>
            <label class="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
              <input v-model="findWrap" type="checkbox" class="w-3.5 h-3.5 accent-blue-600" />
              {{ t('tools.hexFileViewer.findWrap') }}
            </label>
          </div>
          <div class="flex gap-2">
            <input
              v-model="findInput"
              type="text"
              class="input-base flex-1 min-w-0 font-mono"
              :placeholder="findMode === 'hex'
                ? t('tools.hexFileViewer.findPlaceholderHex')
                : t('tools.hexFileViewer.findPlaceholderText')"
              @keydown.enter="findNext"
            />
            <button type="button" class="btn-primary flex-shrink-0" :disabled="loading" @click="findNext">
              {{ t('tools.hexFileViewer.findBtn') }}
            </button>
          </div>
          <p v-if="findError" class="mt-1 text-xs text-red-600">{{ findError }}</p>
          <p v-else-if="matchOffset >= 0" class="mt-1 text-xs text-emerald-600">
            {{ t('tools.hexFileViewer.matchAt') }} 0x{{ matchOffset.toString(16).padStart(8, '0') }}（{{ matchOffset }} {{ t('toolsCommon.bytes') }}）
          </p>
        </div>
      </div>
    </section>

    <!-- 十六进制视图 -->
    <section v-if="file" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="label-base mb-0">{{ t('toolsCommon.preview') }}</span>
        <span class="chip bg-slate-100 text-slate-500">
          {{ t('tools.hexFileViewer.windowLabel') }} 0x{{ viewStart.toString(16).padStart(8, '0') }}
          {{ t('tools.hexFileViewer.windowTo') }} 0x{{ (viewStart + viewLen).toString(16).padStart(8, '0') }}
        </span>
        <span class="text-xs text-slate-400">
          {{ viewLen }} / {{ fileSize }} {{ t('toolsCommon.bytes') }}
        </span>
        <button
          v-if="canLoadMore && !viewLimitReached"
          type="button"
          class="btn-ghost ml-auto"
          :disabled="loading"
          @click="loadMore"
        >
          {{ t('tools.hexFileViewer.loadMore') }}
        </button>
      </div>

      <p v-if="viewLimitReached" class="mb-3 text-xs text-amber-600">{{ t('tools.hexFileViewer.viewLimit') }}</p>
      <p v-else-if="!canLoadMore" class="mb-3 text-xs text-emerald-600">{{ t('tools.hexFileViewer.endReached') }}</p>
      <p v-if="loadError" class="mb-3 text-sm text-red-600">{{ loadError }}</p>

      <div v-if="loading" class="text-sm text-slate-400 py-6 text-center">{{ t('tools.hexFileViewer.reading') }}</div>

      <div v-else class="overflow-x-auto rounded-xl border border-slate-200 bg-white/90">
        <table ref="tableRef" class="hex-table w-full border-collapse font-mono text-xs leading-5">
          <thead>
            <tr class="bg-slate-100 text-slate-500">
              <th class="hex-offset-cell font-medium">{{ t('tools.hexFileViewer.columnOffset') }}</th>
              <th class="hex-bytes-cell font-medium text-left">{{ headerHexText }}</th>
              <th class="hex-ascii-cell font-medium text-left">{{ t('tools.hexFileViewer.columnAscii') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.offset"
              :data-hit="isHit(row) ? '1' : '0'"
              class="border-t border-slate-100"
              :class="isHit(row) ? 'hex-hit' : ''"
            >
              <td class="hex-offset-cell text-slate-400 select-none">{{ row.offsetHex }}</td>
              <td class="hex-bytes-cell text-slate-700 whitespace-pre select-text">{{ row.hexText }}</td>
              <td class="hex-ascii-cell text-slate-500 whitespace-pre select-text">{{ row.asciiText }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!rows.length" class="text-sm text-slate-400 text-center py-6">{{ t('toolsCommon.none') }}</p>
      </div>
    </section>
  </ToolPage>
</template>

<style scoped>
.hex-offset-cell {
  width: 76px;
  padding: 2px 8px;
  text-align: left;
  position: sticky;
  left: 0;
  background: inherit;
}

thead .hex-offset-cell {
  background: #f1f5f9;
}

tbody .hex-offset-cell {
  background: #ffffff;
}

.hex-bytes-cell {
  padding: 2px 10px;
  letter-spacing: 0.08em;
}

.hex-ascii-cell {
  padding: 2px 10px;
  white-space: pre;
}

.hex-hit,
.hex-hit .hex-offset-cell {
  background: #fef08a;
}

.hex-hit td {
  background: #fef08a;
  color: #713f12;
}
</style>

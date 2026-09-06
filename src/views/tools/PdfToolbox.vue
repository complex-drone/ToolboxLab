<script setup>
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { downloadBlob, readFileAsArrayBuffer } from '@/utils/download'
import { formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

const BASE = 'tools.pdfToolbox'

/* ---------------- 状态 ---------------- */
// 文件列表：{ id, file, name, size, pages, encrypted }
const files = ref([])
const mode = useStorage('tool-pdf-toolbox-mode', 'merge') // merge | split | compress
const targetIndex = ref(0)
const rangeText = ref('')
const busy = ref(false)
const errorMsg = ref('')
const result = ref(null) // { kind, blob, size, before, saved }

let uid = 0

const modes = computed(() => [
  { key: 'merge', label: t(`${BASE}.opMerge`), desc: t(`${BASE}.opMergeDesc`) },
  { key: 'split', label: t(`${BASE}.opSplit`), desc: t(`${BASE}.opSplitDesc`) },
  { key: 'compress', label: t(`${BASE}.opCompress`), desc: t(`${BASE}.opCompressDesc`) },
])

const hasEncrypted = computed(() => files.value.some((f) => f.encrypted))
const targetFile = computed(() => files.value[targetIndex.value] || null)
const percent = computed(() => {
  if (!result.value || !result.value.before) return null
  return Math.round(((result.value.before - result.value.size) / result.value.before) * 100)
})

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/* ---------------- 上传与列表 ---------------- */
async function onFiles(list) {
  const incoming = Array.isArray(list) ? list : [list]
  errorMsg.value = ''
  const { PDFDocument } = await import('pdf-lib')

  for (const file of incoming) {
    try {
      const bytes = await readFileAsArrayBuffer(file)
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      files.value.push({
        id: ++uid,
        file,
        name: file.name || `file-${uid}.pdf`,
        size: file.size,
        pages: doc.getPageCount(),
        encrypted: doc.isEncrypted === true,
      })
    } catch {
      toast.error(t(`${BASE}.loadFailedOne`, { name: file.name || '?' }))
    }
  }
  if (targetIndex.value >= files.value.length) targetIndex.value = 0
}

function removeFile(id) {
  const idx = files.value.findIndex((f) => f.id === id)
  if (idx === -1) return
  files.value.splice(idx, 1)
  if (targetIndex.value >= files.value.length) targetIndex.value = Math.max(0, files.value.length - 1)
  if (files.value.length === 0) {
    rangeText.value = ''
    result.value = null
  }
}

function clearAll() {
  files.value = []
  rangeText.value = ''
  result.value = null
  errorMsg.value = ''
}

/* ---------------- 结果处理 ---------------- */
function setResult(kind, bytes, before) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  result.value = { kind, blob, size: blob.size, before: before || 0 }
}

function downloadResult() {
  if (!result.value) return
  const nameMap = { merge: 'merged.pdf', split: 'extracted.pdf', compress: 'compressed.pdf' }
  downloadBlob(result.value.blob, nameMap[result.value.kind] || 'output.pdf')
}

/* ---------------- 解析页码范围 ---------------- */
function parseRange(text, maxPage) {
  const s = String(text || '').trim()
  if (!s) return { error: 'empty' }
  const pages = []
  const seen = new Set()
  for (const part of s.split(',')) {
    const p = part.trim()
    if (!p) return { error: 'invalid' }
    const m = p.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) return { error: 'invalid' }
    const a = parseInt(m[1], 10)
    const b = m[2] !== undefined ? parseInt(m[2], 10) : a
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return { error: 'invalid' }
    if (b > maxPage) return { error: 'range', max: maxPage }
    for (let i = a; i <= b; i++) {
      if (!seen.has(i)) {
        seen.add(i)
        pages.push(i - 1) // 转 0 基索引
      }
    }
  }
  if (pages.length === 0) return { error: 'invalid' }
  return { pages }
}

/* ---------------- 合并 ---------------- */
async function doMerge() {
  if (busy.value) return
  if (files.value.length < 2) {
    toast.info(t(`${BASE}.mergeNeedMore`))
    return
  }
  busy.value = true
  errorMsg.value = ''
  result.value = null
  await nextTick()
  try {
    const { PDFDocument } = await import('pdf-lib')
    const out = await PDFDocument.create()
    for (const item of files.value) {
      const bytes = await readFileAsArrayBuffer(item.file)
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const copied = await out.copyPages(src, src.getPageIndices())
      for (const page of copied) out.addPage(page)
      await yieldToUi()
    }
    const outBytes = await out.save()
    setResult('merge', outBytes, 0)
    toast.success(t(`${BASE}.mergeDone`))
  } catch {
    errorMsg.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    busy.value = false
  }
}

/* ---------------- 拆分（范围提取） ---------------- */
async function doExtract() {
  if (busy.value) return
  if (!targetFile.value) {
    toast.info(t(`${BASE}.needFiles`))
    return
  }
  const parsed = parseRange(rangeText.value, targetFile.value.pages)
  if (parsed.error === 'empty') {
    errorMsg.value = t(`${BASE}.needRange`)
    toast.error(t(`${BASE}.needRange`))
    return
  }
  if (parsed.error === 'invalid') {
    errorMsg.value = t(`${BASE}.rangeInvalid`)
    toast.error(t(`${BASE}.rangeInvalid`))
    return
  }
  if (parsed.error === 'range') {
    errorMsg.value = t(`${BASE}.rangeOutOfRange`, { n: targetFile.value.pages })
    toast.error(t(`${BASE}.rangeOutOfRange`, { n: targetFile.value.pages }))
    return
  }
  busy.value = true
  errorMsg.value = ''
  result.value = null
  await nextTick()
  try {
    const { PDFDocument } = await import('pdf-lib')
    const bytes = await readFileAsArrayBuffer(targetFile.value.file)
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, parsed.pages)
    for (const page of copied) out.addPage(page)
    const outBytes = await out.save()
    setResult('split', outBytes, 0)
    toast.success(t(`${BASE}.extractDone`))
  } catch {
    errorMsg.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    busy.value = false
  }
}

/* ---------------- 压缩 ---------------- */
async function doCompress() {
  if (busy.value) return
  if (!targetFile.value) {
    toast.info(t(`${BASE}.needFiles`))
    return
  }
  busy.value = true
  errorMsg.value = ''
  result.value = null
  await nextTick()
  try {
    const { PDFDocument } = await import('pdf-lib')
    const item = targetFile.value
    const bytes = await readFileAsArrayBuffer(item.file)
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    // 移除元信息
    doc.setTitle('')
    doc.setAuthor('')
    doc.setSubject('')
    doc.setKeywords([])
    doc.setProducer('')
    doc.setCreator('')
    const outBytes = await doc.save({ useObjectStreams: true })
    setResult('compress', outBytes, item.size)
    toast.success(t(`${BASE}.compressDone`))
  } catch {
    errorMsg.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    busy.value = false
  }
}

function sizeText(n) {
  return formatBytes(n)
}
</script>

<template>
  <ToolPage tool-id="pdfToolbox">
    <!-- 上传与文件列表 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.uploadTitle`) }}</h2>
      <FileDropZone
        accept=".pdf"
        multiple
        :maxSizeMB="50"
        :hint="t(`${BASE}.uploadHint`)"
        @files="onFiles"
      />

      <p v-if="hasEncrypted" class="mt-3 text-xs text-amber-600 leading-relaxed">
        {{ t(`${BASE}.encryptedHint`) }}
      </p>

      <div v-if="files.length" class="mt-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-slate-400">
            {{ t('toolsCommon.total') }} {{ files.length }} {{ t('toolsCommon.items') }}
          </span>
          <button type="button" class="btn-danger" :disabled="busy" @click="clearAll">
            {{ t(`${BASE}.clearAll`) }}
          </button>
        </div>
        <div class="overflow-x-auto -mx-1 px-1">
          <table class="w-full min-w-100 text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-400 border-b border-slate-200">
                <th class="py-2 pr-3 font-medium">{{ t(`${BASE}.fileLabel`) }}</th>
                <th class="py-2 pr-3 font-medium whitespace-nowrap">{{ t(`${BASE}.sizeLabel`) }}</th>
                <th class="py-2 pr-3 font-medium whitespace-nowrap">{{ t(`${BASE}.pagesLabel`) }}</th>
                <th class="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, idx) in files"
                :key="item.id"
                class="border-b border-slate-100 last:border-0"
              >
                <td class="py-2 pr-3 text-slate-700 break-all min-w-40">
                  <span class="inline-flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs text-slate-400">{{ idx + 1 }}.</span>
                    {{ item.name }}
                    <span v-if="item.encrypted" class="chip !bg-amber-50 !text-amber-600 !border-amber-100">
                      {{ t(`${BASE}.encryptedBadge`) }}
                    </span>
                  </span>
                </td>
                <td class="py-2 pr-3 text-slate-500 whitespace-nowrap">{{ sizeText(item.size) }}</td>
                <td class="py-2 pr-3 text-slate-500 whitespace-nowrap">
                  {{ t(`${BASE}.pagesCount`, { n: item.pages }) }}
                </td>
                <td class="py-2 text-right">
                  <button
                    type="button"
                    class="btn-danger"
                    :disabled="busy"
                    @click="removeFile(item.id)"
                  >
                    {{ t(`${BASE}.removeFile`) }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 操作选择 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.opsTitle`) }}</h2>

      <div class="flex flex-wrap gap-2 mb-3" role="tablist">
        <button
          v-for="m in modes"
          :key="m.key"
          type="button"
          role="tab"
          :aria-selected="mode === m.key"
          class="px-4 py-2 rounded-xl text-sm font-medium border transition select-none"
          :class="mode === m.key
            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
            : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'"
          :disabled="busy"
          @click="mode = m.key"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="text-xs text-slate-400 mb-4">{{ modes.find((m) => m.key === mode)?.desc }}</p>

      <!-- 合并 -->
      <div v-if="mode === 'merge'">
        <p class="text-sm text-slate-500 mb-4">{{ t(`${BASE}.mergeDesc`) }}</p>
        <button type="button" class="btn-primary" :disabled="busy || files.length < 2" @click="doMerge">
          <svg
            v-if="busy"
            class="animate-spin w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
          {{ busy ? t('toolsCommon.processing') : t(`${BASE}.mergeBtn`) }}
        </button>
      </div>

      <!-- 拆分 -->
      <div v-else-if="mode === 'split'">
        <p class="text-sm text-slate-500 mb-4">{{ t(`${BASE}.splitDesc`) }}</p>
        <div class="grid gap-4 sm:grid-cols-2 mb-4">
          <div>
            <label class="label-base" for="ptb-target">{{ t(`${BASE}.targetFile`) }}</label>
            <select id="ptb-target" v-model.number="targetIndex" class="input-base" :disabled="busy">
              <option v-for="(item, idx) in files" :key="item.id" :value="idx">
                {{ item.name }}（{{ t(`${BASE}.pagesCount`, { n: item.pages }) }}）
              </option>
            </select>
          </div>
          <div>
            <label class="label-base" for="ptb-range">{{ t(`${BASE}.rangeLabel`) }}</label>
            <input
              id="ptb-range"
              v-model="rangeText"
              type="text"
              class="input-base"
              :placeholder="t(`${BASE}.rangePlaceholder`)"
              :disabled="busy"
              @keyup.enter="doExtract"
            />
          </div>
        </div>
        <p class="text-xs text-slate-400 mb-4">{{ t(`${BASE}.rangeHint`) }}</p>
        <button type="button" class="btn-primary" :disabled="busy || !files.length" @click="doExtract">
          <svg
            v-if="busy"
            class="animate-spin w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
          {{ busy ? t('toolsCommon.processing') : t(`${BASE}.extractBtn`) }}
        </button>
      </div>

      <!-- 压缩 -->
      <div v-else>
        <p class="text-sm text-slate-500 mb-4">{{ t(`${BASE}.compressDesc`) }}</p>
        <div class="mb-4">
          <label class="label-base" for="ptb-target-c">{{ t(`${BASE}.targetFile`) }}</label>
          <select id="ptb-target-c" v-model.number="targetIndex" class="input-base sm:max-w-md" :disabled="busy">
            <option v-for="(item, idx) in files" :key="item.id" :value="idx">
              {{ item.name }}（{{ sizeText(item.size) }}）
            </option>
          </select>
        </div>
        <button type="button" class="btn-primary" :disabled="busy || !files.length" @click="doCompress">
          <svg
            v-if="busy"
            class="animate-spin w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
          {{ busy ? t('toolsCommon.processing') : t(`${BASE}.compressBtn`) }}
        </button>
        <p class="mt-3 text-xs text-amber-600">{{ t(`${BASE}.compressNote`) }}</p>
      </div>

      <p v-if="errorMsg" class="mt-4 text-sm text-red-600">{{ errorMsg }}</p>
    </div>

    <!-- 结果 -->
    <div v-if="result" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t(`${BASE}.resultTitle`) }}</h2>
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <div class="flex-1 min-w-0 grid gap-1 text-sm">
          <div class="flex gap-2">
            <span class="text-slate-400 shrink-0">{{ t(`${BASE}.resultFile`) }}:</span>
            <span class="text-slate-700">
              {{ result.kind === 'merge' ? 'merged.pdf' : result.kind === 'split' ? 'extracted.pdf' : 'compressed.pdf' }}
            </span>
          </div>
          <div class="flex gap-2">
            <span class="text-slate-400 shrink-0">{{ t(`${BASE}.newSize`) }}:</span>
            <span class="text-slate-700">{{ sizeText(result.size) }}</span>
          </div>
          <template v-if="result.kind === 'compress'">
            <div class="flex gap-2">
              <span class="text-slate-400 shrink-0">{{ t(`${BASE}.originalSize`) }}:</span>
              <span class="text-slate-700">{{ sizeText(result.before) }}</span>
            </div>
            <div class="flex gap-2">
              <span class="text-slate-400 shrink-0">{{ t('toolsCommon.result') }}:</span>
              <span
                class="font-medium"
                :class="percent === null ? 'text-slate-700' : percent > 0 ? 'text-emerald-600' : percent < 0 ? 'text-red-500' : 'text-slate-700'"
              >
                {{
                  percent === null
                    ? '-'
                    : percent > 0
                      ? t(`${BASE}.savedPercent`, { n: percent })
                      : percent < 0
                        ? t(`${BASE}.increasedPercent`, { n: Math.abs(percent) })
                        : t(`${BASE}.sameSize`)
                }}
              </span>
            </div>
          </template>
        </div>
        <button type="button" class="btn-primary shrink-0" @click="downloadResult">
          <svg
            viewBox="0 0 24 24"
            class="w-4 h-4"
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
          {{
            result.kind === 'merge'
              ? t(`${BASE}.downloadMerged`)
              : result.kind === 'split'
                ? t(`${BASE}.downloadExtracted`)
                : t(`${BASE}.downloadCompressed`)
          }}
        </button>
      </div>
    </div>
  </ToolPage>
</template>

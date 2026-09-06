<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { readFileAsText, downloadText } from '@/utils/download'
import { byteLength, formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/** 编辑器命名空间前缀：属性与 xmlns 声明一并移除 */
const EDITOR_NS = ['inkscape', 'sodipodi', 'sketch']
const DEBOUNCE_MS = 400

/** 仅持久化优化选项，不持久化原始 SVG 内容 */
const options = useStorage('tool-svg-optimizer-config', {
  removeTitleDesc: false,
  decimals: true,
  removeSize: true,
})

const inputText = ref('')
const uploadedName = ref('')
const previewUrl = ref('')
const previewError = ref(false)
const optimizing = ref(false)
const optimized = ref('')
const origBytes = ref(0)
const optBytes = ref(0)
const errorMsg = ref('')

let previewObjectUrl = ''

const hasInput = computed(() => inputText.value.trim().length > 0)
const inputBytes = computed(() => byteLength(inputText.value))

/** 体积变化百分比，正数表示减小 */
const savedPercent = computed(() => {
  if (!optimized.value || !origBytes.value) return null
  return (1 - optBytes.value / origBytes.value) * 100
})
const savedLabel = computed(() => {
  const p = savedPercent.value
  if (p === null) return ''
  if (Math.abs(p) < 0.05) return '±0%'
  return (p > 0 ? '-' : '+') + Math.abs(p).toFixed(1) + '%'
})
const downloadName = computed(() => {
  const base = (uploadedName.value || 'image').replace(/\.[^.]+$/, '') || 'image'
  return base + '-optimized.svg'
})

/** 预览走 object URL + img 标签，不注入 DOM，避免 SVG 内脚本执行 */
watchDebounced(
  inputText,
  (text) => {
    previewError.value = false
    if (previewObjectUrl) {
      try {
        URL.revokeObjectURL(previewObjectUrl)
      } catch {
        // ignore
      }
      previewObjectUrl = ''
    }
    const trimmed = text.trim()
    if (!trimmed) {
      previewUrl.value = ''
      return
    }
    try {
      previewObjectUrl = URL.createObjectURL(new Blob([trimmed], { type: 'image/svg+xml' }))
      previewUrl.value = previewObjectUrl
    } catch {
      previewUrl.value = ''
    }
  },
  { debounce: DEBOUNCE_MS }
)

watch(uploadedName, () => {
  // 换文件后不保留上一次的优化结果
  optimized.value = ''
})

onBeforeUnmount(() => {
  if (previewObjectUrl) {
    try {
      URL.revokeObjectURL(previewObjectUrl)
    } catch {
      // ignore
    }
  }
})

async function onFile(f) {
  if (!f) return
  errorMsg.value = ''
  try {
    const text = await readFileAsText(f)
    uploadedName.value = f.name || ''
    inputText.value = text
  } catch {
    errorMsg.value = t('toolsCommon.loadFailed')
    toast.error(errorMsg.value)
  }
}

function isEditorNsName(name) {
  const lower = name.toLowerCase()
  return (
    EDITOR_NS.some((ns) => lower.startsWith(ns + ':')) ||
    EDITOR_NS.some((ns) => lower === 'xmlns:' + ns)
  )
}

/** 数值小数位压缩：仅处理不含 URL 的属性值，把 3 位以上小数四舍五入到 2 位 */
function compressDecimals(value) {
  if (value.indexOf('://') !== -1) return value
  return value.replace(/-?\d+\.\d{3,}/g, (m) => {
    let out = Number.parseFloat(m).toFixed(2)
    if (out.indexOf('.') !== -1) {
      out = out.replace(/0+$/, '').replace(/\.$/, '')
    }
    if (out === '-0' || out === '') out = '0'
    return out
  })
}

/** 根元素 + 全部后代（querySelectorAll 不含根节点自身） */
function allElements(svgDoc, svg) {
  return [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')))
}

function cleanDocument(svgDoc) {
  const svg = svgDoc.documentElement

  // 1. 注释
  const walker = svgDoc.createTreeWalker(svg, NodeFilter.SHOW_COMMENT)
  const comments = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((c) => c.parentNode && c.parentNode.removeChild(c))

  // 2. metadata 元素
  svg.querySelectorAll('metadata').forEach((el) => el.parentNode && el.parentNode.removeChild(el))

  // 3. 可选：title 与 desc
  if (options.value.removeTitleDesc) {
    svg.querySelectorAll('title, desc').forEach((el) => el.parentNode && el.parentNode.removeChild(el))
  }

  // 4. 编辑器命名空间属性与 xmlns 声明
  allElements(svgDoc, svg).forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (isEditorNsName(attr.name)) el.removeAttribute(attr.name)
    })
  })

  // 5. 空 g 节点（循环到不存在为止，处理嵌套空组）
  let hadEmpty = true
  while (hadEmpty) {
    hadEmpty = false
    svg.querySelectorAll('g').forEach((el) => {
      if (el.children.length === 0 && !el.textContent.trim()) {
        el.parentNode.removeChild(el)
        hadEmpty = true
      }
    })
  }

  // 6. 可选：数值小数位压缩 + 合并连续空白
  allElements(svgDoc, svg).forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase() === 'xmlns' || attr.name.toLowerCase().startsWith('xmlns:')) return
      let val = attr.value
      if (options.value.decimals) val = compressDecimals(val)
      val = val.replace(/\s+/g, ' ').trim()
      if (val !== attr.value) el.setAttribute(attr.name, val)
    })
  })

  // 文本节点合并连续空白
  const textWalker = svgDoc.createTreeWalker(svg, NodeFilter.SHOW_TEXT)
  const texts = []
  while (textWalker.nextNode()) texts.push(textWalker.currentNode)
  texts.forEach((node) => {
    const val = String(node.nodeValue).replace(/\s+/g, ' ')
    if (val !== node.nodeValue) node.nodeValue = val
  })

  // 7. 可选：移除根节点 width/height（仅在存在 viewBox 时）
  if (options.value.removeSize && svg.hasAttribute('viewBox')) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
  }

  return svg
}

function optimize() {
  if (optimizing.value) return
  const src = inputText.value
  if (!src.trim()) {
    errorMsg.value = t('tools.svgOptimizer.emptyInput')
    toast.error(errorMsg.value)
    return
  }
  optimizing.value = true
  errorMsg.value = ''
  try {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
    if (doc.querySelector('parsererror')) throw new Error('parse error')
    const root = doc.documentElement
    if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('not an svg document')

    const svg = cleanDocument(doc)
    const out = new XMLSerializer().serializeToString(svg)
    origBytes.value = byteLength(src)
    optBytes.value = byteLength(out)
    optimized.value = out
    toast.success(t('toolsCommon.done'))
  } catch {
    optimized.value = ''
    errorMsg.value = t('tools.svgOptimizer.invalidSvg')
    toast.error(errorMsg.value)
  } finally {
    optimizing.value = false
  }
}

function reset() {
  inputText.value = ''
  optimized.value = ''
  uploadedName.value = ''
  errorMsg.value = ''
}

function downloadResult() {
  if (!optimized.value) return
  try {
    downloadText(optimized.value, downloadName.value, 'image/svg+xml;charset=utf-8')
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="svgOptimizer">
    <!-- 输入 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.svgOptimizer.inputTitle') }}</h2>
        <div class="flex items-center gap-2">
          <span class="chip">{{ inputBytes }} {{ t('toolsCommon.bytes') }}</span>
          <button
            type="button"
            class="btn-ghost"
            :disabled="!hasInput"
            @click="reset"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="inputText"
        class="input-base font-mono text-xs leading-relaxed"
        rows="8"
        :placeholder="t('tools.svgOptimizer.pastePlaceholder')"
        spellcheck="false"
      ></textarea>
      <div class="mt-4">
        <h2 class="section-title">{{ t('tools.svgOptimizer.uploadTitle') }}</h2>
        <FileDropZone
          accept=".svg,image/svg+xml"
          :multiple="false"
          :maxSizeMB="20"
          @files="onFile"
        />
      </div>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>
    </div>

    <!-- 预览 -->
    <div v-if="previewUrl" class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.svgOptimizer.previewTitle') }}</h2>
      <p v-if="previewError" class="text-red-600 text-sm">{{ t('tools.svgOptimizer.invalidSvg') }}</p>
      <div
        v-else
        class="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-center min-h-[160px] overflow-auto"
      >
        <img
          :src="previewUrl"
          :alt="t('tools.svgOptimizer.previewTitle')"
          class="max-w-full max-h-64"
          @error="previewError = true"
        />
      </div>
    </div>

    <!-- 优化选项 -->
    <div class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.svgOptimizer.optionsTitle') }}</h2>
      <div class="grid gap-2.5">
        <label class="flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
          <input
            v-model="options.removeTitleDesc"
            type="checkbox"
            class="w-4 h-4 accent-blue-600"
          />
          {{ t('tools.svgOptimizer.optTitleDesc') }}
        </label>
        <label class="flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="options.decimals" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.svgOptimizer.optDecimals') }}
        </label>
        <label class="flex items-center gap-2.5 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="options.removeSize" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.svgOptimizer.optSize') }}
        </label>
      </div>
      <p class="text-xs text-slate-400 mt-3">{{ t('tools.svgOptimizer.optAlwaysHint') }}</p>

      <div class="mt-4">
        <button
          type="button"
          class="btn-primary"
          :disabled="!hasInput || optimizing"
          @click="optimize"
        >
          {{ optimizing ? t('toolsCommon.processing') : t('tools.svgOptimizer.optimize') }}
        </button>
      </div>
    </div>

    <!-- 结果 -->
    <div v-if="optimized" class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.svgOptimizer.resultTitle') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <CopyButton :text="optimized" />
          <button type="button" class="btn-ghost" @click="downloadResult">
            {{ t('toolsCommon.download') }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
          <p class="text-xs text-slate-400">{{ t('tools.svgOptimizer.originalSize') }}</p>
          <p class="text-sm font-semibold text-slate-700 mt-0.5">{{ formatBytes(origBytes) }}</p>
        </div>
        <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
          <p class="text-xs text-slate-400">{{ t('tools.svgOptimizer.optimizedSize') }}</p>
          <p class="text-sm font-semibold text-slate-700 mt-0.5">{{ formatBytes(optBytes) }}</p>
        </div>
        <div class="rounded-xl bg-white/70 border border-slate-200 px-2 py-2.5">
          <p class="text-xs text-slate-400">{{ t('tools.svgOptimizer.sizeChange') }}</p>
          <p
            class="text-sm font-semibold mt-0.5"
            :class="savedPercent !== null && savedPercent >= 0 ? 'text-green-600' : 'text-orange-600'"
          >
            {{ savedLabel }}
          </p>
        </div>
      </div>
      <p v-if="savedPercent !== null && savedPercent < -0.05" class="text-xs text-orange-600 mt-2 text-center">
        {{ t('tools.svgOptimizer.increased') }}，{{ t('tools.svgOptimizer.alreadyOptimal') }}
      </p>
      <p
        v-else-if="savedPercent !== null && Math.abs(savedPercent) < 0.05"
        class="text-xs text-slate-400 mt-2 text-center"
      >
        {{ t('tools.svgOptimizer.sameSize') }}，{{ t('tools.svgOptimizer.alreadyOptimal') }}
      </p>

      <pre
        class="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-xs leading-relaxed text-slate-700 overflow-auto max-h-96 whitespace-pre-wrap break-all"
      >{{ optimized }}</pre>
    </div>
  </ToolPage>
</template>

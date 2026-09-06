<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { formatBytes, byteLength } from '@/utils/format'

/**
 * 哈希生成：文本 / 文件 双入口，MD5、SHA-1、SHA-256、SHA-512 同时输出
 * 文件走 hash-wasm 流式接口，按 4MB 分块喂入，避免大文件卡 UI
 */

const ALGOS = [
  { id: 'md5', create: 'createMD5', label: 'MD5' },
  { id: 'sha1', create: 'createSHA1', label: 'SHA-1' },
  { id: 'sha256', create: 'createSHA256', label: 'SHA-256' },
  { id: 'sha512', create: 'createSHA512', label: 'SHA-512' },
]
const CHUNK_SIZE = 4 * 1024 * 1024

const { t } = useI18n()
const toast = useToast()

/** 仅持久化偏好：大小写 + 要展示的算法 */
const config = useStorage('tool-hash-generator-config', {
  uppercase: false,
  algos: ['md5', 'sha1', 'sha256', 'sha512'],
})

const inputMode = ref('text') // 'text' | 'file'
const text = ref('')
const file = ref(null)
const busy = ref(false)
const inlineError = ref('')
/** 各算法最近一次哈希结果（原始小写 hex） */
const hashes = ref({ md5: '', sha1: '', sha256: '', sha512: '' })

/** 并发保护：新一轮计算开始后旧结果作废 */
let computeSeq = 0

const enabledAlgos = computed(() =>
  ALGOS.filter(a => Array.isArray(config.value.algos) && config.value.algos.includes(a.id))
)

const hasResult = computed(() => ALGOS.some(a => hashes.value[a.id]))

const textStats = computed(() => ({
  chars: text.value.length,
  bytes: byteLength(text.value),
}))

function formatHash(hex) {
  if (!hex) return ''
  return config.value.uppercase ? hex.toUpperCase() : hex
}

function toggleAlgo(id) {
  const current = new Set(config.value.algos || [])
  if (current.has(id)) {
    if (current.size <= 1) return // 至少保留一种算法
    current.delete(id)
  } else {
    current.add(id)
  }
  config.value.algos = ALGOS.map(a => a.id).filter(x => current.has(x))
}

/** 文本：一次性计算（TextEncoder 统一按 UTF-8 字节） */
async function computeTextHashes() {
  const seq = ++computeSeq
  busy.value = false // 文本计算会取代进行中的文件计算
  const value = text.value
  if (!value) {
    hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
    inlineError.value = ''
    return
  }
  try {
    const hw = await import('hash-wasm')
    const data = new TextEncoder().encode(value)
    const [md5, sha1, sha256, sha512] = await Promise.all([
      hw.md5(data),
      hw.sha1(data),
      hw.sha256(data),
      hw.sha512(data),
    ])
    if (seq !== computeSeq) return
    hashes.value = { md5, sha1, sha256, sha512 }
    inlineError.value = ''
  } catch {
    if (seq !== computeSeq) return
    inlineError.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}
const debouncedComputeText = useDebounceFn(computeTextHashes, 300)
watch(text, () => debouncedComputeText())

/**
 * 文件：优先 file.stream() 逐块读取，逐块喂给四个 hasher；
 * 不支持 stream 的环境降级为 Blob.slice + arrayBuffer
 */
async function handleFile(selected) {
  const f = selected
  if (!f) return
  const seq = ++computeSeq
  file.value = f
  busy.value = true
  inlineError.value = ''
  try {
    const hw = await import('hash-wasm')
    const hashers = {}
    for (const algo of ALGOS) {
      hashers[algo.id] = await hw[algo.create]()
    }

    const feed = chunk => {
      for (const algo of ALGOS) hashers[algo.id].update(chunk)
    }

    if (typeof f.stream === 'function') {
      const reader = f.stream().getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) feed(value)
        if (seq !== computeSeq) return
      }
    } else {
      for (let pos = 0; pos < f.size; pos += CHUNK_SIZE) {
        const buf = new Uint8Array(await f.slice(pos, pos + CHUNK_SIZE).arrayBuffer())
        feed(buf)
        if (seq !== computeSeq) return
      }
    }

    if (seq !== computeSeq) return
    const results = {}
    for (const algo of ALGOS) results[algo.id] = hashers[algo.id].digest('hex')
    hashes.value = results
    toast.success(t('tools.hashGenerator.fileDone'))
  } catch {
    if (seq !== computeSeq) return
    hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
    inlineError.value = t('tools.hashGenerator.fileReadError')
    toast.error(t('tools.hashGenerator.fileReadError'))
  } finally {
    if (seq === computeSeq) busy.value = false
  }
}

function clearFile() {
  computeSeq++
  file.value = null
  busy.value = false
  hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
  inlineError.value = ''
}

onBeforeUnmount(() => {
  computeSeq++ // 作废未完成的异步计算
})
</script>

<template>
  <ToolPage tool-id="hashGenerator">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span class="section-title mb-0 mr-1">{{ t('tools.hashGenerator.inputMode') }}</span>
        <div class="flex gap-1.5">
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': inputMode === 'text' }"
            :aria-pressed="inputMode === 'text'"
            @click="inputMode = 'text'"
          >
            {{ t('tools.hashGenerator.tabText') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :class="{ '!bg-blue-600 !text-white !border-blue-600': inputMode === 'file' }"
            :aria-pressed="inputMode === 'file'"
            @click="inputMode = 'file'"
          >
            {{ t('tools.hashGenerator.tabFile') }}
          </button>
        </div>
      </div>

      <!-- 文本输入 -->
      <div v-if="inputMode === 'text'">
        <label class="label-base" for="hash-text-input">{{ t('toolsCommon.input') }}</label>
        <textarea
          id="hash-text-input"
          v-model="text"
          rows="6"
          class="input-base w-full font-mono"
          :placeholder="t('tools.hashGenerator.textPlaceholder')"
          :aria-label="t('tools.hashGenerator.textPlaceholder')"
        ></textarea>
        <p class="mt-1.5 text-xs text-slate-400">
          {{ t('toolsCommon.chars') }} {{ textStats.chars }} · {{ t('toolsCommon.bytes') }} {{ textStats.bytes }}
        </p>
      </div>

      <!-- 文件输入 -->
      <div v-else>
        <FileDropZone
          accept="*/*"
          :multiple="false"
          :max-size-m-b="2048"
          :hint="busy ? t('toolsCommon.processing') : t('tools.hashGenerator.fileHint')"
        />
        <div
          v-if="file"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2"
        >
          <span class="chip">{{ t('tools.hashGenerator.currentFile') }}</span>
          <span class="text-sm text-slate-700 truncate max-w-full" :title="file.name">{{ file.name }}</span>
          <span class="text-xs text-slate-400">{{ formatBytes(file.size) }}</span>
          <button
            type="button"
            class="btn-danger ml-auto"
            :disabled="busy"
            :aria-label="t('toolsCommon.clear')"
            @click="clearFile"
          >
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>

      <p v-if="inlineError" class="mt-2 text-red-600 text-sm">{{ inlineError }}</p>
    </section>

    <!-- 算法与大小写设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.hashGenerator.algoSettings') }}</h2>
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-medium text-slate-500">{{ t('tools.hashGenerator.algos') }}</span>
          <button
            v-for="algo in ALGOS"
            :key="algo.id"
            type="button"
            class="chip cursor-pointer select-none transition"
            :class="config.algos.includes(algo.id)
              ? ''
              : '!bg-slate-50 !text-slate-400 !border-slate-200 line-through'"
            :aria-pressed="config.algos.includes(algo.id)"
            :aria-label="algo.label"
            @click="toggleAlgo(algo.id)"
          >
            {{ algo.label }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-slate-500">{{ t('tools.hashGenerator.caseLabel') }}</span>
          <div class="flex gap-1.5">
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': !config.uppercase }"
              :aria-pressed="!config.uppercase"
              @click="config.uppercase = false"
            >
              {{ t('tools.hashGenerator.lower') }}
            </button>
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.uppercase }"
              :aria-pressed="config.uppercase"
              @click="config.uppercase = true"
            >
              {{ t('tools.hashGenerator.upper') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 结果区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.hashGenerator.results') }}</h2>
        <span v-if="busy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
      </div>

      <p v-if="!hasResult && !busy" class="text-sm text-slate-400 py-4 text-center">
        {{ t('tools.hashGenerator.noInput') }}
      </p>

      <ul v-else class="space-y-3">
        <li
          v-for="algo in enabledAlgos"
          :key="algo.id"
          class="flex items-start gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5"
        >
          <span class="chip shrink-0 mt-0.5 min-w-[4.5rem] justify-center">{{ algo.label }}</span>
          <code class="flex-1 min-w-0 break-all font-mono text-[13px] leading-5 text-slate-700">
            {{ formatHash(hashes[algo.id]) || t('tools.hashGenerator.emptyResult') }}
          </code>
          <CopyButton
            compact
            :text="formatHash(hashes[algo.id])"
            :disabled="!hashes[algo.id]"
          />
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

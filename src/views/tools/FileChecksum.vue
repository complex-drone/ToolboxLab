<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import FileDropZone from '@/components/tools/FileDropZone.vue'
import { useToast } from '@/composables/useToast'
import { formatBytes } from '@/utils/format'

/**
 * 文件校验和：hash-wasm 流式计算 MD5 / SHA-1 / SHA-256 / SHA-512
 * 文件按 4MB 分块（file.slice + arrayBuffer），四个 hasher 并行创建、单次遍历同时喂入
 */

const ALGOS = [
  { id: 'md5', create: 'createMD5', label: 'MD5' },
  { id: 'sha1', create: 'createSHA1', label: 'SHA-1' },
  { id: 'sha256', create: 'createSHA256', label: 'SHA-256' },
  { id: 'sha512', create: 'createSHA512', label: 'SHA-512' },
]
const CHUNK_SIZE = 4 * 1024 * 1024
const MB = 1024 * 1024
const DEFAULT_ALGOS = ['md5', 'sha1', 'sha256', 'sha512']

const { t } = useI18n()
const toast = useToast()

/** 持久化：算法选择（至少一个）与结果大小写偏好 */
const config = useStorage('tool-file-checksum-config', {
  uppercase: false,
  algos: [...DEFAULT_ALGOS],
})
// 脏数据兜底：算法列表必须至少有一个
if (!Array.isArray(config.value.algos) || config.value.algos.length === 0) {
  config.value.algos = [...DEFAULT_ALGOS]
}

const file = ref(null)
const busy = ref(false)
const inlineError = ref('')
const hashes = ref({ md5: '', sha1: '', sha256: '', sha512: '' })
const progress = ref({ pct: 0, speed: 0, elapsed: 0 })

/** 并发保护：新一轮计算开始后旧结果作废 */
let computeSeq = 0

const enabledAlgos = computed(() =>
  ALGOS.filter(a => Array.isArray(config.value.algos) && config.value.algos.includes(a.id))
)
const hasResult = computed(() => enabledAlgos.value.some(a => hashes.value[a.id]))
const pctLabel = computed(() => progress.value.pct.toFixed(1))
const speedLabel = computed(() => progress.value.speed.toFixed(1))
const elapsedLabel = computed(() => progress.value.elapsed.toFixed(1))

/** 复制全部：每算法一行「算法名  哈希值」 */
const copyAllText = computed(() =>
  enabledAlgos.value
    .map(a => (hashes.value[a.id] ? `${a.label}  ${formatHash(hashes.value[a.id])}` : ''))
    .filter(Boolean)
    .join('\n')
)

function formatHash(hex) {
  if (!hex) return ''
  return config.value.uppercase ? hex.toUpperCase() : hex
}

function toggleAlgo(id) {
  const current = new Set(config.value.algos || [])
  if (current.has(id)) {
    if (current.size <= 1) {
      toast.info(t('tools.fileChecksum.atLeastOne'))
      return
    }
    current.delete(id)
  } else {
    current.add(id)
  }
  config.value.algos = ALGOS.map(a => a.id).filter(x => current.has(x))
}

/** 处理中阻止关闭页面，完成后自动解除 */
function onBeforeUnload(e) {
  e.preventDefault()
  e.returnValue = ''
}
watch(busy, value => {
  if (value) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
})

async function handleFiles(selected) {
  if (!selected) return
  await computeFile(selected)
}

/** 同一文件重新计算 */
function recompute() {
  if (file.value) computeFile(file.value)
}

async function computeFile(f) {
  if (!f || busy.value) return
  if (enabledAlgos.value.length === 0) {
    toast.error(t('tools.fileChecksum.atLeastOne'))
    return
  }
  const seq = ++computeSeq
  file.value = f
  busy.value = true
  inlineError.value = ''
  hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
  progress.value = { pct: 0, speed: 0, elapsed: 0 }
  const start = performance.now()
  try {
    const hw = await import('hash-wasm')
    const algos = enabledAlgos.value
    // 四个 hasher 并行创建，随后单次遍历文件同时喂入
    const hashers = await Promise.all(algos.map(a => hw[a.create]()))
    let processed = 0
    for (let pos = 0; pos < f.size; pos += CHUNK_SIZE) {
      const buf = new Uint8Array(await f.slice(pos, pos + CHUNK_SIZE).arrayBuffer())
      for (const hasher of hashers) hasher.update(buf)
      processed = Math.min(pos + CHUNK_SIZE, f.size)
      if (seq !== computeSeq) return
      const elapsed = (performance.now() - start) / 1000
      progress.value = {
        pct: f.size > 0 ? (processed / f.size) * 100 : 100,
        speed: elapsed > 0 ? processed / MB / elapsed : 0,
        elapsed,
      }
    }
    if (seq !== computeSeq) return
    const results = { md5: '', sha1: '', sha256: '', sha512: '' }
    algos.forEach((algo, i) => {
      results[algo.id] = hashers[i].digest('hex')
    })
    hashes.value = results
    progress.value.pct = 100
    toast.success(t('tools.fileChecksum.done'))
  } catch {
    if (seq !== computeSeq) return
    hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
    inlineError.value = t('tools.fileChecksum.readError')
    toast.error(t('tools.fileChecksum.readError'))
  } finally {
    if (seq === computeSeq) busy.value = false
  }
}

function clearFile() {
  computeSeq++
  file.value = null
  busy.value = false
  hashes.value = { md5: '', sha1: '', sha256: '', sha512: '' }
  progress.value = { pct: 0, speed: 0, elapsed: 0 }
  inlineError.value = ''
}

onBeforeUnmount(() => {
  computeSeq++
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <ToolPage tool-id="fileChecksum">
    <!-- 上传与进度 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.fileChecksum.uploadTitle') }}</h2>

      <!-- 处理中隐藏上传区，禁止重复上传 -->
      <FileDropZone
        v-if="!busy"
        accept="*/*"
        :multiple="false"
        :max-size-m-b="2048"
        :hint="t('tools.fileChecksum.fileHint')"
        @files="handleFiles"
      />

      <!-- 流式计算进度：百分比 + 速度 + 已用时间 -->
      <div v-else class="rounded-2xl border border-blue-100 bg-blue-50/50 px-4 py-5">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
          <span class="text-sm font-semibold text-blue-600 tabular-nums">{{ pctLabel }}%</span>
        </div>
        <div class="h-2.5 w-full overflow-hidden rounded-full bg-white">
          <div
            class="h-full rounded-full bg-blue-500 transition-all duration-200"
            :style="{ width: progress.pct + '%' }"
          ></div>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 tabular-nums">
          <span class="max-w-full truncate" :title="file && file.name">{{ file && file.name }}</span>
          <span>{{ t('tools.fileChecksum.speedText', { speed: speedLabel }) }}</span>
          <span>{{ t('tools.fileChecksum.elapsedText', { time: elapsedLabel }) }}</span>
        </div>
      </div>

      <!-- 已选文件：重算 / 清除 -->
      <div
        v-if="file && !busy"
        class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2"
      >
        <span class="chip shrink-0">{{ t('tools.fileChecksum.currentFile') }}</span>
        <span class="min-w-0 flex-1 truncate text-sm text-slate-700" :title="file.name">{{ file.name }}</span>
        <span class="shrink-0 text-xs text-slate-400 tabular-nums">{{ formatBytes(file.size) }}</span>
        <button
          type="button"
          class="btn-primary !py-1.5"
          :disabled="enabledAlgos.length === 0"
          @click="recompute"
        >
          {{ t('tools.fileChecksum.recompute') }}
        </button>
        <button type="button" class="btn-danger" @click="clearFile">{{ t('toolsCommon.clear') }}</button>
      </div>

      <p v-if="inlineError" class="mt-2 text-sm text-red-600">{{ inlineError }}</p>
    </section>

    <!-- 算法选择 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.fileChecksum.algoSettings') }}</h2>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="algo in ALGOS"
          :key="algo.id"
          type="button"
          class="chip cursor-pointer select-none transition"
          :class="config.algos.includes(algo.id) ? '' : '!bg-slate-50 !text-slate-400 !border-slate-200 line-through'"
          :aria-pressed="config.algos.includes(algo.id)"
          :aria-label="algo.label"
          @click="toggleAlgo(algo.id)"
        >
          {{ algo.label }}
        </button>
      </div>
    </section>

    <!-- 结果区：每算法一行 + 全局大小写 + 复制全部 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.fileChecksum.results') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <span class="hidden text-xs font-medium text-slate-500 sm:inline">
            {{ t('tools.fileChecksum.caseLabel') }}
          </span>
          <div class="flex gap-1.5">
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': !config.uppercase }"
              :aria-pressed="!config.uppercase"
              @click="config.uppercase = false"
            >
              {{ t('tools.fileChecksum.lower') }}
            </button>
            <button
              type="button"
              class="btn-ghost !py-1"
              :class="{ '!bg-blue-600 !text-white !border-blue-600': config.uppercase }"
              :aria-pressed="config.uppercase"
              @click="config.uppercase = true"
            >
              {{ t('tools.fileChecksum.upper') }}
            </button>
          </div>
          <CopyButton :label="t('toolsCommon.copyAll')" :text="copyAllText" />
        </div>
      </div>

      <p v-if="!hasResult && !busy" class="py-4 text-center text-sm text-slate-400">
        {{ t('tools.fileChecksum.noResult') }}
      </p>

      <ul v-else class="space-y-3">
        <li
          v-for="algo in enabledAlgos"
          :key="algo.id"
          class="flex items-start gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5"
        >
          <span class="chip mt-0.5 min-w-[4.5rem] shrink-0 justify-center">{{ algo.label }}</span>
          <code class="min-w-0 flex-1 break-all font-mono text-[13px] leading-5 text-slate-700">
            {{ formatHash(hashes[algo.id]) || t('tools.fileChecksum.pending') }}
          </code>
          <CopyButton compact :text="formatHash(hashes[algo.id])" :disabled="!hashes[algo.id]" />
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

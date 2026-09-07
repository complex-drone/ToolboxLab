<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { padZero } from '@/utils/format'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 批量重命名工具（规则引擎）
 * - 输入文件名列表（每行一个），规则按顺序应用：查找替换 → 前后缀 → 序号 → 大小写 → 清理
 * - 实时预览 + 重名冲突检测 + 可选自动解决（重复名追加序号后缀）
 * - 规则集与输入均持久化
 */
const { t } = useI18n()
const toast = useToast()

const SAMPLE_FILES = [
  'vacation photo 1.JPG',
  'vacation photo 2.JPG',
  'IMG_2023:final.png',
  'report draft v1.docx',
  'REPORT DRAFT V2.DOCX',
  'budget 2024?.xlsx',
  'song|track.mp3',
  '.gitignore',
  'README',
].join('\n')

const CASE_MODES = [
  { key: 'none' },
  { key: 'lower' },
  { key: 'upper' },
  { key: 'extLower' },
]

/* ---------- 持久化 ---------- */

const config = useStorage(
  'tool-batch-rename-config',
  {
    enableReplace: true,
    findText: '',
    replaceText: '',
    useRegex: false,
    nameOnly: true,
    enableAffix: false,
    prefix: '',
    suffix: '',
    suffixBeforeExt: true,
    enableNumbering: false,
    startNumber: 1,
    digits: 2,
    numSeparator: '_',
    caseMode: 'none',
    enableCleanup: false,
    spaceToUnderscore: true,
    removeSpecial: true,
    autoResolveConflicts: true,
  },
  undefined,
  { deep: true }
)

const inputStorage = useStorage('tool-batch-rename-input', { text: '' })
const inputText = computed({
  get: () => inputStorage.value.text,
  set: v => {
    inputStorage.value.text = v
  },
})

/* ---------- 工具函数 ---------- */

/** 拆分文件名与扩展名：以最后一个点为准（点在首位视为无扩展名，如 .gitignore） */
function splitNameExt(name) {
  const idx = name.lastIndexOf('.')
  if (idx > 0 && idx < name.length - 1) {
    return { base: name.slice(0, idx), ext: name.slice(idx) }
  }
  return { base: name, ext: '' }
}

const regexValid = computed(() => {
  if (!config.value.enableReplace || !config.value.useRegex || !config.value.findText) return true
  try {
    new RegExp(config.value.findText)
    return true
  } catch {
    return false
  }
})

function replaceAll(text, find, replacement) {
  if (config.value.useRegex) {
    try {
      return text.replace(new RegExp(find, 'g'), replacement)
    } catch {
      return text
    }
  }
  return text.split(find).join(replacement)
}

function clampDigits(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 2
  return Math.min(4, Math.max(1, n))
}

/* ---------- 规则引擎（按顺序应用） ---------- */

const rows = computed(() => {
  const lines = inputText.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  let list = lines.map(name => ({ original: name, result: name, changed: false, conflict: false, resolved: false }))

  // 规则 1：查找替换
  if (config.value.enableReplace && config.value.findText && regexValid.value) {
    list = list.map(item => {
      if (config.value.nameOnly) {
        const { base, ext } = splitNameExt(item.result)
        return { ...item, result: replaceAll(base, config.value.findText, config.value.replaceText) + ext }
      }
      return { ...item, result: replaceAll(item.result, config.value.findText, config.value.replaceText) }
    })
  }

  // 规则 2：前缀 / 后缀
  if (config.value.enableAffix && (config.value.prefix || config.value.suffix)) {
    list = list.map(item => {
      const { base, ext } = splitNameExt(item.result)
      let nb = config.value.prefix + base
      let ne = ext
      if (config.value.suffix) {
        if (config.value.suffixBeforeExt) nb += config.value.suffix
        else ne = ext + config.value.suffix
      }
      return { ...item, result: nb + ne }
    })
  }

  // 规则 3：序号填充（追加到名尾、扩展名之前）
  if (config.value.enableNumbering) {
    const start = Math.max(0, Math.round(Number(config.value.startNumber) || 0))
    const digits = clampDigits(config.value.digits)
    const sep = String(config.value.numSeparator || '')
    list = list.map((item, i) => {
      const { base, ext } = splitNameExt(item.result)
      return { ...item, result: base + sep + padZero(start + i, digits) + ext }
    })
  }

  // 规则 4：大小写转换
  if (config.value.caseMode === 'lower') {
    list = list.map(item => ({ ...item, result: item.result.toLowerCase() }))
  } else if (config.value.caseMode === 'upper') {
    list = list.map(item => ({ ...item, result: item.result.toUpperCase() }))
  } else if (config.value.caseMode === 'extLower') {
    list = list.map(item => {
      const { base, ext } = splitNameExt(item.result)
      return { ...item, result: base + ext.toLowerCase() }
    })
  }

  // 规则 5：清理空格与特殊字符
  if (config.value.enableCleanup) {
    list = list.map(item => {
      const { base, ext } = splitNameExt(item.result)
      let nb = base
      let ne = ext
      if (config.value.spaceToUnderscore) {
        nb = nb.replace(/\s+/g, '_')
        ne = ne.replace(/\s+/g, '_')
      }
      if (config.value.removeSpecial) {
        nb = nb.replace(/[\\/:*?"<>|]/g, '')
        ne = ne.replace(/[\\/:*?"<>|]/g, '')
      }
      return { ...item, result: nb + ne }
    })
  }

  // 标记变化
  list = list.map(item => ({ ...item, changed: item.result !== item.original }))

  // 冲突检测
  const counts = new Map()
  for (const it of list) counts.set(it.result, (counts.get(it.result) || 0) + 1)
  list = list.map(it => ({ ...it, conflict: counts.get(it.result) > 1 }))

  // 冲突自动解决：重复名追加序号后缀
  if (config.value.autoResolveConflicts) {
    const used = new Set()
    const nextSuffix = new Map()
    list = list.map(it => {
      if (!used.has(it.result)) {
        used.add(it.result)
        return { ...it, conflict: false }
      }
      const { base, ext } = splitNameExt(it.result)
      let k = (nextSuffix.get(it.result) || 0) + 1
      let candidate = base + '_' + k + ext
      while (used.has(candidate)) {
        k++
        candidate = base + '_' + k + ext
      }
      nextSuffix.set(it.result, k)
      used.add(candidate)
      return {
        ...it,
        result: candidate,
        changed: candidate !== it.original,
        conflict: false,
        resolved: true,
      }
    })
  }

  return list
})

const changedCount = computed(() => rows.value.filter(r => r.changed).length)
const resolvedCount = computed(() => rows.value.filter(r => r.resolved).length)
const hasConflict = computed(() => rows.value.some(r => r.conflict))

/* ---------- 输出 ---------- */

const mapText = computed(() => rows.value.map(r => r.original + '\t' + r.result).join('\n'))

function downloadMap() {
  try {
    if (!mapText.value) return
    downloadText(mapText.value, 'batch-rename-map.txt', 'text/plain;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function loadSample() {
  inputText.value = SAMPLE_FILES
}

function clearInput() {
  inputText.value = ''
}
</script>

<template>
  <ToolPage tool-id="batchRename">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="section-title flex-1 mb-0">{{ t('tools.batchRename.inputSection') }}</span>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <textarea
        v-model="inputText"
        class="input-base font-mono h-40 resize-y"
        :placeholder="t('tools.batchRename.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
    </section>

    <!-- 规则区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <span class="section-title">{{ t('tools.batchRename.rulesSection') }}</span>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
        <!-- 规则 1：查找替换 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <input v-model="config.enableReplace" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.batchRename.replaceRule') }}
          </label>
          <div v-if="config.enableReplace" class="mt-3 space-y-2.5">
            <div>
              <label class="label-base">{{ t('tools.batchRename.find') }}</label>
              <input v-model="config.findText" type="text" class="input-base font-mono" />
            </div>
            <div>
              <label class="label-base">{{ t('tools.batchRename.replace') }}</label>
              <input v-model="config.replaceText" type="text" class="input-base font-mono" />
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input v-model="config.useRegex" type="checkbox" class="w-4 h-4 accent-blue-600" />
              {{ t('tools.batchRename.regexOpt') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input v-model="config.nameOnly" type="checkbox" class="w-4 h-4 accent-blue-600" />
              {{ t('tools.batchRename.nameOnlyOpt') }}
            </label>
            <p v-if="!regexValid" class="text-xs text-red-600">{{ t('tools.batchRename.regexInvalid') }}</p>
          </div>
        </div>

        <!-- 规则 2：前缀与后缀 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <input v-model="config.enableAffix" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.batchRename.affixRule') }}
          </label>
          <div v-if="config.enableAffix" class="mt-3 space-y-2.5">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label-base">{{ t('tools.batchRename.prefix') }}</label>
                <input v-model="config.prefix" type="text" class="input-base font-mono" />
              </div>
              <div>
                <label class="label-base">{{ t('tools.batchRename.suffix') }}</label>
                <input v-model="config.suffix" type="text" class="input-base font-mono" />
              </div>
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input v-model="config.suffixBeforeExt" type="checkbox" class="w-4 h-4 accent-blue-600" />
              {{ t('tools.batchRename.suffixBeforeExtOpt') }}
            </label>
          </div>
        </div>

        <!-- 规则 3：序号填充 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <input v-model="config.enableNumbering" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.batchRename.numberingRule') }}
          </label>
          <div v-if="config.enableNumbering" class="mt-3 space-y-2.5">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="label-base">{{ t('tools.batchRename.startNumber') }}</label>
                <input v-model.number="config.startNumber" type="number" min="0" step="1" class="input-base" />
              </div>
              <div>
                <label class="label-base">{{ t('tools.batchRename.digits') }}</label>
                <select v-model.number="config.digits" class="input-base">
                  <option :value="1">1</option>
                  <option :value="2">2</option>
                  <option :value="3">3</option>
                  <option :value="4">4</option>
                </select>
              </div>
              <div>
                <label class="label-base">{{ t('tools.batchRename.numSeparator') }}</label>
                <input v-model="config.numSeparator" type="text" maxlength="4" class="input-base font-mono" />
              </div>
            </div>
            <p class="text-xs text-slate-400">{{ t('tools.batchRename.numberingHint') }}</p>
          </div>
        </div>

        <!-- 规则 4：大小写 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <span class="block text-sm font-medium text-slate-700">{{ t('tools.batchRename.caseRule') }}</span>
          <div class="flex flex-wrap gap-2 mt-3">
            <button
              v-for="m in CASE_MODES"
              :key="m.key"
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm border transition select-none"
              :class="
                config.caseMode === m.key
                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white/70 border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
              "
              @click="config.caseMode = m.key"
            >
              {{ t(`tools.batchRename.case_${m.key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}`) }}
            </button>
          </div>
        </div>

        <!-- 规则 5：清理 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <input v-model="config.enableCleanup" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.batchRename.cleanupRule') }}
          </label>
          <div v-if="config.enableCleanup" class="mt-3 space-y-2.5">
            <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input v-model="config.spaceToUnderscore" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
              {{ t('tools.batchRename.spaceToUnderscoreOpt') }}
            </label>
            <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input v-model="config.removeSpecial" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
              {{ t('tools.batchRename.removeSpecialOpt') }}
            </label>
          </div>
        </div>

        <!-- 冲突自动解决 -->
        <div class="rounded-xl border border-slate-200 p-3.5">
          <label class="inline-flex items-start gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input v-model="config.autoResolveConflicts" type="checkbox" class="w-4 h-4 mt-0.5 accent-blue-600" />
            {{ t('tools.batchRename.autoResolveOpt') }}
          </label>
        </div>
      </div>
    </section>

    <!-- 预览区 -->
    <section class="glass-card p-4 sm:p-6">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('tools.batchRename.previewSection') }}</span>
        <span class="chip font-mono">
          {{ t('toolsCommon.total') }} {{ rows.length }} {{ t('toolsCommon.items') }}
        </span>
        <span class="chip font-mono">
          {{ t('tools.batchRename.changedTag') }} {{ changedCount }}
        </span>
        <span v-if="resolvedCount > 0" class="chip font-mono">
          {{ t('tools.batchRename.resolvedTag') }} {{ resolvedCount }}
        </span>
        <CopyButton :text="mapText" :label="t('tools.batchRename.copyMap')" :disabled="rows.length === 0" />
        <button type="button" class="btn-ghost" :disabled="rows.length === 0" @click="downloadMap">
          {{ t('tools.batchRename.downloadMap') }}
        </button>
      </div>

      <p v-if="hasConflict" class="text-sm text-red-600 mb-3">{{ t('tools.batchRename.conflictWarning') }}</p>

      <p v-if="rows.length === 0" class="text-sm text-slate-400 py-8 text-center">
        {{ t('tools.batchRename.noFiles') }}
      </p>
      <div v-else class="overflow-x-auto max-h-[480px] overflow-y-auto rounded-xl border border-slate-200">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 sticky top-0">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-slate-500 w-12">{{ t('tools.batchRename.colIndex') }}</th>
              <th class="px-3 py-2 text-left font-medium text-slate-500">{{ t('tools.batchRename.colOriginal') }}</th>
              <th class="px-3 py-2 text-left font-medium text-slate-500">{{ t('tools.batchRename.colNew') }}</th>
              <th class="px-3 py-2 text-left font-medium text-slate-500 w-28"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in rows"
              :key="i"
              class="border-t border-slate-100"
              :class="{ 'bg-red-50': r.conflict }"
            >
              <td class="px-3 py-1.5 text-xs text-slate-400 font-mono align-top">{{ i + 1 }}</td>
              <td class="px-3 py-1.5 font-mono text-slate-500 break-all align-top">{{ r.original }}</td>
              <td
                class="px-3 py-1.5 font-mono break-all align-top"
                :class="r.changed ? 'text-blue-600 font-medium' : 'text-slate-600'"
              >
                {{ r.result }}
              </td>
              <td class="px-3 py-1.5 align-top">
                <span v-if="r.conflict" class="chip bg-red-50 text-red-600 border-red-100">
                  {{ t('tools.batchRename.conflictTag') }}
                </span>
                <span v-else-if="r.resolved" class="chip bg-emerald-50 text-emerald-600 border-emerald-100">
                  {{ t('tools.batchRename.resolvedTag') }}
                </span>
                <span v-else-if="r.changed" class="chip">
                  {{ t('tools.batchRename.changedTag') }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </ToolPage>
</template>

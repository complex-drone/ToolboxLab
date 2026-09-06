<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * 文本差异对比
 * - 使用 diff@5 的 diffLines 计算行级差异
 * - 支持并排 / 行内两种查看模式
 * - 输入防抖 300ms 后重算
 */
const { t } = useI18n()
const toast = useToast()

/** 超长文本时限制渲染行数，避免页面卡死 */
const MAX_RENDER_ROWS = 5000

const config = useStorage('tool-text-diff-config', {
  viewMode: 'side', // 'side' | 'inline'
  ignoreWhitespace: false,
})

const oldText = ref('')
const newText = ref('')

let diffLinesFn = null
const diffError = ref('')
const rows = ref([])
const addedCount = ref(0)
const removedCount = ref(0)
const truncated = ref(false)

const bothEmpty = computed(() => oldText.value === '' && newText.value === '')
const hasDiff = computed(() => addedCount.value > 0 || removedCount.value > 0)
const identical = computed(() => !diffError.value && !bothEmpty.value && !hasDiff.value)

/** 渲染用行数据（带行号与展示文本） */
function buildRows(parts) {
  const result = []
  let lNo = 0
  let rNo = 0
  let pendingDel = []
  let pendingAdd = []

  const toLines = value => {
    const lines = value.split('\n')
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }
  const disp = text => (text === '' ? '\u00A0' : text)

  // 将积压的删除/新增行两两配对输出
  const flush = () => {
    const max = Math.max(pendingDel.length, pendingAdd.length)
    for (let i = 0; i < max; i++) {
      const l = pendingDel[i]
      const r = pendingAdd[i]
      if (l && r) {
        result.push({ type: 'pair', lNo: l.no, rNo: r.no, lDisp: disp(l.text), rDisp: disp(r.text) })
      } else if (l) {
        result.push({ type: 'del', lNo: l.no, rNo: 0, lDisp: disp(l.text), rDisp: '\u00A0' })
      } else if (r) {
        result.push({ type: 'add', lNo: 0, rNo: r.no, lDisp: '\u00A0', rDisp: disp(r.text) })
      }
    }
    pendingDel = []
    pendingAdd = []
  }

  for (const part of parts) {
    if (part.added) {
      toLines(part.value).forEach(text => {
        rNo += 1
        pendingAdd.push({ no: rNo, text })
      })
    } else if (part.removed) {
      toLines(part.value).forEach(text => {
        lNo += 1
        pendingDel.push({ no: lNo, text })
      })
    } else {
      flush()
      toLines(part.value).forEach(text => {
        lNo += 1
        rNo += 1
        result.push({ type: 'equal', lNo, rNo, lDisp: disp(text), rDisp: disp(text) })
      })
    }
  }
  flush()
  return result
}

function runDiff() {
  if (!diffLinesFn) return
  diffError.value = ''
  try {
    const parts = config.value.ignoreWhitespace
      ? diffLinesFn(oldText.value, newText.value, { ignoreWhitespace: true })
      : diffLinesFn(oldText.value, newText.value)
    const allRows = buildRows(parts)
    addedCount.value = allRows.filter(r => r.type === 'add' || r.type === 'pair').length
    removedCount.value = allRows.filter(r => r.type === 'del' || r.type === 'pair').length
    truncated.value = allRows.length > MAX_RENDER_ROWS
    rows.value = truncated.value ? allRows.slice(0, MAX_RENDER_ROWS) : allRows
  } catch (e) {
    rows.value = []
    addedCount.value = 0
    removedCount.value = 0
    diffError.value = e && e.message ? e.message : t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}

const runDiffDebounced = useDebounceFn(runDiff, 300)

watch([oldText, newText], () => runDiffDebounced())
watch(() => config.value.ignoreWhitespace, () => runDiff())

function swapTexts() {
  const tmp = oldText.value
  oldText.value = newText.value
  newText.value = tmp
}

function clearAll() {
  oldText.value = ''
  newText.value = ''
}

/** 并排模式左右单元格样式 */
function leftClass(row) {
  if (row.type === 'del' || row.type === 'pair') return 'del'
  if (row.type === 'add') return 'empty'
  return ''
}
function rightClass(row) {
  if (row.type === 'add' || row.type === 'pair') return 'add'
  if (row.type === 'del') return 'empty'
  return ''
}

/** 行内模式：把配对行拆成一条删除 + 一条新增 */
const inlineRows = computed(() => {
  const out = []
  for (const row of rows.value) {
    if (row.type === 'equal') {
      out.push({ type: 'equal', no: row.rNo, text: row.lDisp })
    } else if (row.type === 'del') {
      out.push({ type: 'del', no: row.lNo, text: row.lDisp })
    } else if (row.type === 'add') {
      out.push({ type: 'add', no: row.rNo, text: row.rDisp })
    } else {
      out.push({ type: 'del', no: row.lNo, text: row.lDisp })
      out.push({ type: 'add', no: row.rNo, text: row.rDisp })
    }
  }
  return out
})

onMounted(async () => {
  try {
    const mod = await import('diff')
    diffLinesFn = mod.diffLines
    runDiff()
  } catch {
    diffError.value = t('tools.textDiff.loadFailed')
    toast.error(t('tools.textDiff.loadFailed'))
  }
})
</script>

<template>
  <ToolPage tool-id="textDiff">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title mb-0 mr-auto">{{ t('toolsCommon.input') }}</h2>
        <button type="button" class="btn-ghost" @click="swapTexts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {{ t('toolsCommon.swap') }}
        </button>
        <button type="button" class="btn-danger" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="diff-old" class="label-base">{{ t('tools.textDiff.oldText') }}</label>
          <textarea
            id="diff-old"
            v-model="oldText"
            class="input-base w-full font-mono h-44 resize-y"
            :placeholder="t('tools.textDiff.oldPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <label for="diff-new" class="label-base">{{ t('tools.textDiff.newText') }}</label>
          <textarea
            id="diff-new"
            v-model="newText"
            class="input-base w-full font-mono h-44 resize-y"
            :placeholder="t('tools.textDiff.newPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <!-- 选项 -->
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 mt-4">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-slate-600">{{ t('tools.textDiff.viewMode') }}</span>
          <div
            class="inline-flex rounded-xl border border-slate-200 bg-white/70 p-0.5"
            role="group"
            :aria-label="t('tools.textDiff.viewMode')"
          >
            <button
              type="button"
              class="px-3 py-1 rounded-lg text-sm font-medium transition"
              :class="config.viewMode === 'side' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-blue-600'"
              @click="config.viewMode = 'side'"
            >
              {{ t('tools.textDiff.sideBySide') }}
            </button>
            <button
              type="button"
              class="px-3 py-1 rounded-lg text-sm font-medium transition"
              :class="config.viewMode === 'inline' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-blue-600'"
              @click="config.viewMode = 'inline'"
            >
              {{ t('tools.textDiff.inline') }}
            </button>
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.ignoreWhitespace" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.textDiff.ignoreWhitespace') }}
        </label>
      </div>
    </section>

    <!-- 结果区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title mb-0 mr-auto">{{ t('tools.textDiff.diffResult') }}</h2>
        <span v-if="addedCount > 0" class="chip !bg-emerald-50 !text-emerald-600 !border-emerald-200">
          {{ t('tools.textDiff.addedLines', { n: addedCount }) }}
        </span>
        <span v-if="removedCount > 0" class="chip !bg-red-50 !text-red-600 !border-red-200">
          {{ t('tools.textDiff.removedLines', { n: removedCount }) }}
        </span>
      </div>

      <!-- 加载失败 -->
      <p v-if="diffError" class="text-red-600 text-sm">{{ diffError }}</p>

      <!-- 两段文本相同时的 info 提示 -->
      <div
        v-else-if="identical"
        class="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-600 flex items-center gap-2"
        role="status"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 flex-shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {{ t('tools.textDiff.sameText') }}
      </div>

      <!-- 两段都为空 -->
      <p v-else-if="bothEmpty" class="text-slate-400 text-sm">{{ t('toolsCommon.none') }}</p>

      <template v-else>
        <p v-if="truncated" class="text-amber-600 text-sm mb-2">
          {{ t('tools.textDiff.truncated', { n: MAX_RENDER_ROWS }) }}
        </p>

        <!-- 并排模式 -->
        <div v-if="config.viewMode === 'side'" class="overflow-x-auto rounded-xl border border-slate-200">
          <div class="min-w-[540px]">
            <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_minmax(0,1fr)]">
              <div class="col-span-2 diff-head">{{ t('tools.textDiff.leftHeader') }}</div>
              <div class="col-span-2 diff-head">{{ t('tools.textDiff.rightHeader') }}</div>
              <template v-for="(row, i) in rows" :key="i">
                <div class="diff-no">{{ row.lNo || '' }}</div>
                <div class="diff-cell" :class="leftClass(row)">{{ row.lDisp }}</div>
                <div class="diff-no">{{ row.rNo || '' }}</div>
                <div class="diff-cell" :class="rightClass(row)">{{ row.rDisp }}</div>
              </template>
            </div>
          </div>
        </div>

        <!-- 行内模式 -->
        <div v-else class="overflow-x-auto rounded-xl border border-slate-200">
          <div class="min-w-[320px]">
            <div class="grid grid-cols-[2.5rem_1.25rem_minmax(0,1fr)]">
              <div class="diff-head">{{ t('tools.textDiff.lineHeader') }}</div>
              <div class="diff-head"></div>
              <div class="diff-head">{{ t('tools.textDiff.contentHeader') }}</div>
              <template v-for="(row, i) in inlineRows" :key="i">
                <div class="diff-no">{{ row.no || '' }}</div>
                <div
                  class="diff-sign"
                  :class="row.type === 'del' ? 'del' : row.type === 'add' ? 'add' : ''"
                >{{ row.type === 'del' ? '-' : row.type === 'add' ? '+' : '\u00A0' }}</div>
                <div
                  class="diff-cell !border-l-0"
                  :class="row.type === 'del' ? 'del' : row.type === 'add' ? 'add' : ''"
                >{{ row.text }}</div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </section>
  </ToolPage>
</template>

<style scoped>
.diff-head {
  @apply px-2 py-1.5 text-xs font-semibold font-sans text-slate-500 bg-slate-100/80 border-b border-slate-200;
}

.diff-no {
  @apply select-none text-right px-1.5 text-xs font-mono leading-6 text-slate-400 bg-slate-50 border-b border-slate-100;
}

.diff-sign {
  @apply select-none text-center text-xs font-mono leading-6 bg-slate-50 border-b border-l border-slate-100;
}

.diff-sign.del {
  @apply text-red-500 bg-red-50;
}

.diff-sign.add {
  @apply text-emerald-600 bg-emerald-50;
}

.diff-cell {
  @apply px-2 text-xs font-mono leading-6 whitespace-pre-wrap break-all border-b border-slate-100 text-slate-700;
}

.diff-cell.del {
  @apply bg-red-50 text-red-700;
}

.diff-cell.add {
  @apply bg-emerald-50 text-emerald-700;
}

.diff-cell.empty {
  @apply bg-slate-50/70;
}
</style>

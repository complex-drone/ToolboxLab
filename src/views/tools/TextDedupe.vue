<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import { secureShuffle } from '@/utils/random'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 文本去重 / 排序
 * - 去重策略：保留首次出现 / 保留末次出现
 * - 排序：升序 / 降序 / 随机打乱（secureShuffle，加密安全）
 * - 可选：中文按拼音排序（localeCompare zh-Hans-CN）、忽略大小写
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-text-dedupe-config', {
  strategy: 'first', // 'first' | 'last'
  sort: 'none', // 'none' | 'asc' | 'desc' | 'shuffle'
  pinyin: false,
  ignoreCase: false,
})

const input = ref('')
const result = ref('')
const summaryText = ref('')
const error = ref('')
const lastRemoved = ref(0)
const resultLineCount = ref(0)

const inputLineCount = computed(() => {
  const lines = input.value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
})

const canProcess = computed(() => input.value.length > 0)
/** 拼音排序仅在升序/降序时生效 */
const pinyinEnabled = computed(() => config.value.sort === 'asc' || config.value.sort === 'desc')

/** 拆分为行数组，去掉末尾因换行符产生的空元素 */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function process() {
  error.value = ''
  try {
    if (!canProcess.value) {
      result.value = ''
      summaryText.value = ''
      toast.error(t('tools.textDedupe.emptyHint'))
      return
    }

    const lines = splitLines(input.value)
    const keyOf = line => (config.value.ignoreCase ? line.toLowerCase() : line)

    // 去重
    const seen = new Set()
    let deduped = []
    if (config.value.strategy === 'last') {
      // 保留末次出现：逆序遍历收集后反转，保持原有相对顺序
      for (let i = lines.length - 1; i >= 0; i--) {
        const key = keyOf(lines[i])
        if (!seen.has(key)) {
          seen.add(key)
          deduped.push(lines[i])
        }
      }
      deduped.reverse()
    } else {
      for (const line of lines) {
        const key = keyOf(line)
        if (!seen.has(key)) {
          seen.add(key)
          deduped.push(line)
        }
      }
    }

    // 排序
    if (config.value.sort === 'asc' || config.value.sort === 'desc') {
      const cmp = config.value.pinyin
        ? (a, b) => a.localeCompare(b, 'zh-Hans-CN')
        : (a, b) => (a < b ? -1 : a > b ? 1 : 0)
      deduped.sort(cmp)
      if (config.value.sort === 'desc') deduped.reverse()
    } else if (config.value.sort === 'shuffle') {
      deduped = secureShuffle(deduped)
    }

    result.value = deduped.join('\n')

    const removed = lines.length - deduped.length
    lastRemoved.value = removed
    resultLineCount.value = deduped.length
    summaryText.value = t('tools.textDedupe.summary', {
      a: lines.length,
      b: deduped.length,
      c: removed,
    })
    toast.success(t('tools.textDedupe.processed'))
  } catch (e) {
    error.value = e && e.message ? e.message : t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}

function clearInput() {
  input.value = ''
  result.value = ''
  summaryText.value = ''
  error.value = ''
  lastRemoved.value = 0
  resultLineCount.value = 0
}
</script>

<template>
  <ToolPage tool-id="textDedupe">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title mb-0 mr-auto">{{ t('toolsCommon.input') }}</h2>
        <span class="text-xs text-slate-400">
          {{ inputLineCount }} {{ t('toolsCommon.lines') }}
        </span>
        <button type="button" class="btn-danger" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <textarea
        v-model="input"
        class="input-base w-full font-mono h-52 resize-y"
        :placeholder="t('tools.textDedupe.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
    </section>

    <!-- 选项区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.options') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="dedupe-strategy" class="label-base">{{ t('tools.textDedupe.strategy') }}</label>
          <select id="dedupe-strategy" v-model="config.strategy" class="input-base">
            <option value="first">{{ t('tools.textDedupe.keepFirst') }}</option>
            <option value="last">{{ t('tools.textDedupe.keepLast') }}</option>
          </select>
        </div>
        <div>
          <label for="dedupe-sort" class="label-base">{{ t('tools.textDedupe.sort') }}</label>
          <select id="dedupe-sort" v-model="config.sort" class="input-base">
            <option value="none">{{ t('tools.textDedupe.sortNone') }}</option>
            <option value="asc">{{ t('tools.textDedupe.sortAsc') }}</option>
            <option value="desc">{{ t('tools.textDedupe.sortDesc') }}</option>
            <option value="shuffle">{{ t('tools.textDedupe.sortShuffle') }}</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 mt-4">
        <label
          class="inline-flex items-center gap-2 text-sm text-slate-600 select-none"
          :class="pinyinEnabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
        >
          <input v-model="config.pinyin" type="checkbox" class="w-4 h-4 accent-blue-600" :disabled="!pinyinEnabled" />
          {{ t('tools.textDedupe.pinyin') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.ignoreCase" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.textDedupe.ignoreCase') }}
        </label>
        <button type="button" class="btn-primary ml-auto" @click="process">
          {{ t('tools.textDedupe.process') }}
        </button>
      </div>
    </section>

    <!-- 结果区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title mb-0 mr-auto">{{ t('toolsCommon.result') }}</h2>
        <span v-if="summaryText" class="chip">{{ summaryText }}</span>
        <CopyButton :text="result" :label="t('toolsCommon.copy')" :disabled="!result" />
      </div>

      <p v-if="error" class="text-red-600 text-sm mb-2">{{ error }}</p>

      <textarea
        v-if="result"
        :value="result"
        readonly
        class="input-base w-full font-mono h-52 resize-y bg-slate-50/80"
        :aria-label="t('toolsCommon.result')"
      ></textarea>
      <p v-else class="text-slate-400 text-sm">{{ t('tools.textDedupe.emptyHint') }}</p>

      <p v-if="result" class="mt-2 text-xs text-slate-400">
        {{ t('tools.textDedupe.resultLines', { n: resultLineCount }) }}
        <template v-if="lastRemoved === 0">
          · {{ t('tools.textDedupe.noDuplicates') }}
        </template>
      </p>
    </section>
  </ToolPage>
</template>

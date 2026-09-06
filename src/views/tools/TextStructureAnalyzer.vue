<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn, useResizeObserver } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { clampInt } from '@/utils/number'

const { t } = useI18n()

// ---------------------------------------------------------------------------
// 停用词表与调色板（组件常量，正则/列表不放语言包）
// ---------------------------------------------------------------------------
const ZH_STOP_CHARS = new Set([
  '的', '了', '是', '在', '和', '有', '就', '都', '不', '人', '我', '一', '你', '他', '她', '它',
  '们', '这', '那', '与', '之', '及', '为', '等', '地', '得', '着', '去', '过', '也', '很', '多',
  '要', '说', '会', '上', '下', '中', '大', '小', '里', '好', '没', '把', '被', '向', '从', '其',
  '并', '或', '呢', '吧', '啊', '吗', '呀', '哦', '嗯', '啦',
])
const ZH_STOP_GRAMS = new Set([
  '我们', '你们', '他们', '她们', '它们', '自己', '这个', '那个', '一个', '什么',
  '因为', '所以', '但是', '如果', '就是', '还是', '没有', '可以', '已经', '现在',
  '知道', '时候', '这样', '那样', '这些', '那些', '一样', '起来', '出来', '怎么',
])
const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'is', 'are', 'was', 'were', 'it', 'this', 'that',
  'for', 'on', 'with', 'as', 'be', 'by', 'from', 'or', 'at', 'have', 'has', 'had', 'not', 'but',
  'they', 'we', 'you', 'he', 'she', 'his', 'her', 'its', 'their', 'our', 'your', 'my', 'me',
  'him', 'them', 'us', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may',
  'might', 'must', 'about', 'into', 'over', 'after', 'before', 'between', 'under', 'there',
  'here', 'when', 'where', 'which', 'who', 'whom', 'whose', 'what', 'why', 'how', 'all', 'any',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'also', 'then', 'if', 'because', 'while', 'without', 'both',
])

/** 蓝紫渐变色板（按词频排名取色，不使用随机数） */
const CLOUD_PALETTE = ['#1d4ed8', '#2563eb', '#4f46e5', '#6366f1', '#7c3aed', '#8b5cf6', '#a855f7']

const TOP_N_OPTIONS = [10, 20, 30, 50]
const CLOUD_TOP_N = 30
const MAX_SENTENCE_DISPLAY = 120

const EN_WORD_RE = /\b\w+\b/g
const CJK_RUN_RE = /[\u4e00-\u9fff]+/g
const CJK_CHAR_RE = /[\u4e00-\u9fff]/
const CJK_COUNT_RE = /[\u4e00-\u9fff]/g
const LATIN_COUNT_RE = /[A-Za-z]/g
const DIGIT_COUNT_RE = /[0-9]/g
const SENTENCE_SPLIT_RE = /[。！？.!?]+/
const PARAGRAPH_SPLIT_RE = /\n+/

// ---------------------------------------------------------------------------
// 选项持久化：Top N 数量与停用词开关
// ---------------------------------------------------------------------------
const config = useStorage('tool-text-structure-analyzer-config', {
  topN: 20,
  enableStopwords: true,
})

const topN = computed({
  get() {
    const n = Number(config.value.topN)
    return TOP_N_OPTIONS.includes(n) ? n : 20
  },
  set(v) {
    config.value.topN = clampInt(v, 10, 50, 20)
  },
})

const stopwordEnabled = computed({
  get: () => config.value.enableStopwords !== false,
  set: v => {
    config.value.enableStopwords = v !== false
  },
})

// ---------------------------------------------------------------------------
// 输入：大文本统计防抖 400ms，文本本身不写入 localStorage
// ---------------------------------------------------------------------------
const text = ref('')
const debouncedText = ref('')
const scheduleAnalyze = useDebounceFn(() => {
  debouncedText.value = text.value
}, 400)
watch(text, () => scheduleAnalyze())

const hasInput = computed(() => debouncedText.value.length > 0)

// ---------------------------------------------------------------------------
// 高频词统计：英文 \b\w+\b 小写化，中文按 2-gram 切分，排除停用词
// ---------------------------------------------------------------------------
function isStopword(token) {
  if (EN_STOPWORDS.has(token)) return true
  if (token.length === 2 && CJK_CHAR_RE.test(token)) {
    if (ZH_STOP_GRAMS.has(token)) return true
    if (ZH_STOP_CHARS.has(token[0]) || ZH_STOP_CHARS.has(token[1])) return true
  }
  return false
}

const wordStats = computed(() => {
  const input = debouncedText.value
  if (!input) return { total: 0, sorted: [] }
  const counts = new Map()
  const bump = token => {
    if (stopwordEnabled.value && isStopword(token)) return
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  const lower = input.toLowerCase()
  let m
  EN_WORD_RE.lastIndex = 0
  while ((m = EN_WORD_RE.exec(lower)) !== null) bump(m[0])
  CJK_RUN_RE.lastIndex = 0
  while ((m = CJK_RUN_RE.exec(input)) !== null) {
    const run = m[0]
    for (let i = 0; i + 1 < run.length; i++) bump(run.slice(i, i + 2))
  }
  let total = 0
  counts.forEach(c => {
    total += c
  })
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return { total, sorted }
})

const topRows = computed(() => {
  const { total, sorted } = wordStats.value
  return sorted.slice(0, topN.value).map(([word, count]) => ({
    word,
    count,
    percent: total ? ((count / total) * 100).toFixed(1) + '%' : '0%',
  }))
})

const cloudWords = computed(() =>
  wordStats.value.sorted.slice(0, CLOUD_TOP_N).map(([word, count]) => ({ word, count }))
)

const tsvText = computed(() =>
  topRows.value.map(r => [r.word, r.count, r.percent].join('\t')).join('\n')
)

// ---------------------------------------------------------------------------
// 结构统计
// ---------------------------------------------------------------------------
function splitSentences(input) {
  return String(input || '')
    .split(SENTENCE_SPLIT_RE)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function countCharMatches(input, re) {
  const m = input.match(re)
  return m ? m.length : 0
}

const stats = computed(() => {
  const input = debouncedText.value
  const sentences = splitSentences(input)
  const sentenceCount = sentences.length
  const totalSentenceChars = sentences.reduce((s, x) => s + x.length, 0)
  const avgSentenceLength = sentenceCount
    ? Math.round((totalSentenceChars / sentenceCount) * 10) / 10
    : 0
  const paragraphs = input
    ? input.split(PARAGRAPH_SPLIT_RE).map(s => s.trim()).filter(Boolean).length
    : 0
  const cjk = input ? countCharMatches(input, CJK_COUNT_RE) : 0
  const latin = input ? countCharMatches(input, LATIN_COUNT_RE) : 0
  const digit = input ? countCharMatches(input, DIGIT_COUNT_RE) : 0
  const mixTotal = cjk + latin + digit
  return { sentences, sentenceCount, avgSentenceLength, paragraphs, cjk, latin, digit, mixTotal }
})

const mixRows = computed(() => {
  const total = stats.value.mixTotal || 0
  const pct = v => (total ? Math.round((v / total) * 1000) / 10 : 0)
  return [
    { key: 'cjk', label: t('tools.textStructureAnalyzer.cjkChars'), value: stats.value.cjk, pct: pct(stats.value.cjk), bar: 'bg-blue-500' },
    { key: 'latin', label: t('tools.textStructureAnalyzer.latinChars'), value: stats.value.latin, pct: pct(stats.value.latin), bar: 'bg-indigo-500' },
    { key: 'digit', label: t('tools.textStructureAnalyzer.digitChars'), value: stats.value.digit, pct: pct(stats.value.digit), bar: 'bg-violet-500' },
  ]
})

const longestSentence = computed(() => {
  const list = stats.value.sentences
  if (!list.length) return ''
  return list.reduce((a, b) => (b.length > a.length ? b : a), list[0])
})

const shortestSentence = computed(() => {
  const list = stats.value.sentences
  if (!list.length) return ''
  return list.reduce((a, b) => (b.length < a.length ? b : a), list[0])
})

function truncateSentence(s) {
  return s.length > MAX_SENTENCE_DISPLAY ? s.slice(0, MAX_SENTENCE_DISPLAY) + '…' : s
}

// ---------------------------------------------------------------------------
// 词云：Canvas 网格摆放避免重叠，字号按频次 14-48px 映射
// ---------------------------------------------------------------------------
const cloudCanvas = ref(null)
const cloudWrap = ref(null)

function drawCloud() {
  const canvas = cloudCanvas.value
  const wrap = cloudWrap.value
  if (!canvas || !wrap) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  try {
    const words = cloudWords.value
    const cssWidth = Math.max(260, wrap.clientWidth || 320)
    const GAP_X = 16
    const GAP_Y = 12
    const MIN_FONT = 14
    const MAX_FONT = 48
    const FONT_FAMILY = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

    let minCount = Infinity
    let maxCount = -Infinity
    for (const w of words) {
      if (w.count < minCount) minCount = w.count
      if (w.count > maxCount) maxCount = w.count
    }
    const span = maxCount - minCount || 1
    const denom = Math.max(1, words.length - 1)
    const items = words.map((w, i) => ({
      word: w.word,
      size: Math.round(MIN_FONT + ((w.count - minCount) / span) * (MAX_FONT - MIN_FONT)),
      color: CLOUD_PALETTE[Math.min(CLOUD_PALETTE.length - 1, Math.floor((i / denom) * (CLOUD_PALETTE.length - 1)))],
      width: 0,
    }))
    ctx.textBaseline = 'middle'
    for (const it of items) {
      ctx.font = 'bold ' + it.size + 'px ' + FONT_FAMILY
      it.width = ctx.measureText(it.word).width
    }

    // 简单网格摆放：逐行放置，避免词与词重叠
    const rows = []
    let row = { items: [], width: 0, height: 0 }
    for (const it of items) {
      const w = it.width + GAP_X
      if (row.items.length && row.width + w > cssWidth - 16) {
        rows.push(row)
        row = { items: [], width: 0, height: 0 }
      }
      row.items.push(it)
      row.width += w
      if (it.size > row.height) row.height = it.size
    }
    if (row.items.length) rows.push(row)

    const cssHeight = Math.max(150, rows.reduce((s, r) => s + r.height + GAP_Y, 0) + 16)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.width = cssWidth + 'px'
    canvas.style.height = cssHeight + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)
    ctx.textBaseline = 'middle'
    let y = 8
    for (const r of rows) {
      let x = 8
      for (const it of r.items) {
        ctx.font = 'bold ' + it.size + 'px ' + FONT_FAMILY
        ctx.fillStyle = it.color
        ctx.fillText(it.word, x, y + r.height / 2)
        x += it.width + GAP_X
      }
      y += r.height + GAP_Y
    }
  } catch {
    // 绘制失败时保持画布空白，不影响统计数字
  }
}

watch(cloudWords, drawCloud, { flush: 'post' })
useResizeObserver(cloudWrap, () => drawCloud())
</script>

<template>
  <ToolPage tool-id="textStructureAnalyzer">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('tools.textStructureAnalyzer.inputTitle') }}</div>
      <textarea
        v-model="text"
        rows="8"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.textStructureAnalyzer.textPlaceholder')"
        :aria-label="t('tools.textStructureAnalyzer.inputTitle')"
      ></textarea>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.textStructureAnalyzer.emptyInputHint') }}</p>
    </section>

    <!-- 结构统计 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('tools.textStructureAnalyzer.statsTitle') }}</div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.sentenceCount }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ t('tools.textStructureAnalyzer.sentenceCount') }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.avgSentenceLength }}</div>
          <div class="mt-0.5 text-xs text-slate-500">
            {{ t('tools.textStructureAnalyzer.avgSentenceLength') }}
            <span class="text-slate-400">（{{ t('tools.textStructureAnalyzer.sentenceUnit') }}）</span>
          </div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.paragraphs }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ t('tools.textStructureAnalyzer.paragraphCount') }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.cjk }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ t('tools.textStructureAnalyzer.cjkChars') }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.latin }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ t('tools.textStructureAnalyzer.latinChars') }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-3">
          <div class="text-xl font-bold text-slate-800">{{ stats.digit }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ t('tools.textStructureAnalyzer.digitChars') }}</div>
        </div>
      </div>

      <!-- 三类字符占比进度条 -->
      <div class="section-title mt-5">{{ t('tools.textStructureAnalyzer.charMixTitle') }}</div>
      <div class="space-y-2.5">
        <div v-for="row in mixRows" :key="row.key">
          <div class="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{{ row.label }}</span>
            <span class="font-mono">{{ row.value }} · {{ row.pct }}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full transition-all duration-300" :class="row.bar" :style="{ width: row.pct + '%' }"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 高频词 Top N -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">
          {{ t('tools.textStructureAnalyzer.topWordsTitle') }}
          <span v-if="hasInput" class="chip ml-2 font-mono">
            {{ t('tools.textStructureAnalyzer.distinctWords') }} {{ wordStats.sorted.length }}
          </span>
        </h2>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-1.5 text-sm text-slate-500">
            {{ t('tools.textStructureAnalyzer.topNLabel') }}
            <select v-model.number="topN" class="input-base w-20 py-1" :aria-label="t('tools.textStructureAnalyzer.topNLabel')">
              <option v-for="n in TOP_N_OPTIONS" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label class="chip cursor-pointer select-none" :class="{ 'opacity-50': !stopwordEnabled }">
            <input v-model="stopwordEnabled" type="checkbox" class="mr-1 accent-blue-600" />
            {{ t('tools.textStructureAnalyzer.stopwordsLabel') }}
          </label>
          <CopyButton
            :text="tsvText"
            :label="t('tools.textStructureAnalyzer.copyTableTsv')"
            :disabled="!topRows.length"
          />
        </div>
      </div>

      <div v-if="topRows.length" class="overflow-x-auto">
        <table class="w-full min-w-72 text-sm">
          <thead>
            <tr class="border-b border-slate-100 text-left text-xs text-slate-400">
              <th class="py-2 pr-3 font-medium"># / {{ t('tools.textStructureAnalyzer.colWord') }}</th>
              <th class="py-2 pr-3 text-right font-medium">{{ t('tools.textStructureAnalyzer.colCount') }}</th>
              <th class="py-2 text-right font-medium">{{ t('tools.textStructureAnalyzer.colPercent') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in topRows"
              :key="r.word"
              class="border-b border-slate-50 last:border-0"
            >
              <td class="py-1.5 pr-3">
                <span class="chip mr-2 inline-block font-mono">{{ i + 1 }}</span>
                <span class="break-all font-mono text-slate-700">{{ r.word }}</span>
              </td>
              <td class="py-1.5 pr-3 text-right font-mono text-slate-700">{{ r.count }}</td>
              <td class="py-1.5 text-right font-mono text-slate-500">{{ r.percent }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="py-6 text-center text-sm text-slate-400">
        {{ t('tools.textStructureAnalyzer.noWordsHint') }}
      </p>
    </section>

    <!-- 词云 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('tools.textStructureAnalyzer.cloudTitle') }}</div>
      <div ref="cloudWrap" class="w-full">
        <canvas v-if="cloudWords.length" ref="cloudCanvas" class="max-w-full" role="img" :aria-label="t('tools.textStructureAnalyzer.cloudTitle')"></canvas>
        <p v-else class="py-8 text-center text-sm text-slate-400">
          {{ t('tools.textStructureAnalyzer.noWordsHint') }}
        </p>
      </div>
    </section>

    <!-- 最长句 / 最短句 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('tools.textStructureAnalyzer.longestSentence') }}</div>
      <p v-if="longestSentence" class="break-all rounded-xl border border-slate-100 bg-white/70 p-3 text-sm text-slate-700">
        {{ truncateSentence(longestSentence) }}
      </p>
      <p v-else class="text-sm text-slate-400">{{ t('tools.textStructureAnalyzer.noSentenceHint') }}</p>

      <div class="section-title mt-5">{{ t('tools.textStructureAnalyzer.shortestSentence') }}</div>
      <p v-if="shortestSentence" class="break-all rounded-xl border border-slate-100 bg-white/70 p-3 text-sm text-slate-700">
        {{ truncateSentence(shortestSentence) }}
      </p>
      <p v-else class="text-sm text-slate-400">{{ t('tools.textStructureAnalyzer.noSentenceHint') }}</p>
    </section>
  </ToolPage>
</template>

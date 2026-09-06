<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'

/**
 * MBTI 人格测试（精简版 32 题）
 * E/I、S/N、T/F、J/P 各 8 题；单题作答、可回退修改；答案与完成状态持久化
 */

const TOTAL = 32
// 每题所属维度：a 选项对应的字母 / b 选项对应的字母（故意交错，避免选项方向固定）
const QUESTIONS = [
  { n: 1, dim: 'EI', a: 'E', b: 'I' },
  { n: 2, dim: 'EI', a: 'I', b: 'E' },
  { n: 3, dim: 'EI', a: 'E', b: 'I' },
  { n: 4, dim: 'EI', a: 'I', b: 'E' },
  { n: 5, dim: 'EI', a: 'E', b: 'I' },
  { n: 6, dim: 'EI', a: 'I', b: 'E' },
  { n: 7, dim: 'EI', a: 'E', b: 'I' },
  { n: 8, dim: 'EI', a: 'I', b: 'E' },
  { n: 9, dim: 'SN', a: 'S', b: 'N' },
  { n: 10, dim: 'SN', a: 'N', b: 'S' },
  { n: 11, dim: 'SN', a: 'S', b: 'N' },
  { n: 12, dim: 'SN', a: 'N', b: 'S' },
  { n: 13, dim: 'SN', a: 'S', b: 'N' },
  { n: 14, dim: 'SN', a: 'N', b: 'S' },
  { n: 15, dim: 'SN', a: 'S', b: 'N' },
  { n: 16, dim: 'SN', a: 'N', b: 'S' },
  { n: 17, dim: 'TF', a: 'T', b: 'F' },
  { n: 18, dim: 'TF', a: 'F', b: 'T' },
  { n: 19, dim: 'TF', a: 'T', b: 'F' },
  { n: 20, dim: 'TF', a: 'F', b: 'T' },
  { n: 21, dim: 'TF', a: 'T', b: 'F' },
  { n: 22, dim: 'TF', a: 'F', b: 'T' },
  { n: 23, dim: 'TF', a: 'T', b: 'F' },
  { n: 24, dim: 'TF', a: 'F', b: 'T' },
  { n: 25, dim: 'JP', a: 'J', b: 'P' },
  { n: 26, dim: 'JP', a: 'P', b: 'J' },
  { n: 27, dim: 'JP', a: 'J', b: 'P' },
  { n: 28, dim: 'JP', a: 'P', b: 'J' },
  { n: 29, dim: 'JP', a: 'J', b: 'P' },
  { n: 30, dim: 'JP', a: 'P', b: 'J' },
  { n: 31, dim: 'JP', a: 'J', b: 'P' },
  { n: 32, dim: 'JP', a: 'P', b: 'J' },
]
const DIM_KEYS = ['EI', 'SN', 'TF', 'JP']

const { t } = useI18n()

/** 持久化：答案（中断后继续）与完成状态、作答位置 */
const answers = useStorage('tool-mbti-answers', {})
const state = useStorage('tool-mbti-state', { index: 0, finished: false })

// 恢复时兜底：位置越界或脏数据时纠正
if (!Number.isFinite(Number(state.value.index))) state.value.index = 0
state.value.index = Math.min(Math.max(0, Number(state.value.index) || 0), TOTAL - 1)

const q = computed(() => QUESTIONS[state.value.index] || QUESTIONS[0])
const answeredCount = computed(
  () => QUESTIONS.reduce((sum, item) => (answers.value[item.n] ? sum + 1 : sum), 0)
)
const allAnswered = computed(() => answeredCount.value >= TOTAL)
const progressPct = computed(() => (answeredCount.value / TOTAL) * 100)

/** 计分：统计各维度两个字母的票数，输出类型与百分比 */
const result = computed(() => {
  if (!allAnswered.value) return null
  const counts = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 }
  for (const item of QUESTIONS) {
    const pick = answers.value[item.n]
    if (pick === 'a') counts[item.a] += 1
    else if (pick === 'b') counts[item.b] += 1
  }
  const dims = DIM_KEYS.map(key => {
    const left = key.charAt(0)
    const right = key.charAt(1)
    const leftPct = Math.round((counts[left] / 8) * 100)
    return { key, left, right, leftPct, rightPct: 100 - leftPct }
  })
  const type = dims.map(d => (d.leftPct >= d.rightPct ? d.left : d.right)).join('')
  return { type, dims }
})

const showResult = computed(() => Boolean(state.value.finished) && Boolean(result.value))

function choose(pick) {
  answers.value[q.value.n] = pick
  // 已答自动记录并前进；最后一题停留，等待「查看结果」
  if (state.value.index < TOTAL - 1) state.value.index += 1
}
function prevStep() {
  if (state.value.index > 0) state.value.index -= 1
}
function nextStep() {
  if (state.value.index < TOTAL - 1) state.value.index += 1
}
function finish() {
  if (allAnswered.value) state.value.finished = true
}
function backToEdit() {
  state.value.finished = false
}
function retest() {
  answers.value = {}
  state.value.index = 0
  state.value.finished = false
}
</script>

<template>
  <ToolPage tool-id="mbtiTest">
    <!-- 作答界面：单题模式 -->
    <section v-if="!showResult" class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span class="chip">{{ t('tools.mbtiTest.questionOf', { n: state.index + 1, total: TOTAL }) }}</span>
        <span class="text-xs text-slate-400 tabular-nums">
          {{ t('tools.mbtiTest.answeredOf', { n: answeredCount, total: TOTAL }) }}
        </span>
      </div>

      <div class="mb-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          class="h-full rounded-full bg-blue-500 transition-all duration-300"
          :style="{ width: progressPct + '%' }"
        ></div>
      </div>

      <h2 class="mb-4 min-h-[3rem] text-base font-semibold leading-relaxed text-slate-800 sm:text-lg">
        {{ t(`tools.mbtiTest.questions.q${q.n}`) }}
      </h2>

      <div class="grid gap-3">
        <button
          type="button"
          class="answer-btn"
          :class="{ selected: answers[q.n] === 'a' }"
          @click="choose('a')"
        >
          <span class="answer-key" aria-hidden="true">A</span>
          <span class="min-w-0">{{ t(`tools.mbtiTest.questions.q${q.n}a`) }}</span>
        </button>
        <button
          type="button"
          class="answer-btn"
          :class="{ selected: answers[q.n] === 'b' }"
          @click="choose('b')"
        >
          <span class="answer-key" aria-hidden="true">B</span>
          <span class="min-w-0">{{ t(`tools.mbtiTest.questions.q${q.n}b`) }}</span>
        </button>
      </div>

      <div class="mt-5 flex items-center justify-between gap-2">
        <button type="button" class="btn-ghost" :disabled="state.index === 0" @click="prevStep">
          {{ t('tools.mbtiTest.prevQuestion') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="state.index >= TOTAL - 1" @click="nextStep">
          {{ t('tools.mbtiTest.nextQuestion') }}
        </button>
      </div>

      <div v-if="allAnswered" class="mt-5 text-center">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="finish">
          {{ t('tools.mbtiTest.viewResult') }}
        </button>
      </div>
    </section>

    <!-- 结果页 -->
    <template v-else>
      <!-- 类型大字 -->
      <section class="glass-card p-4 text-center sm:p-6 mb-4">
        <p class="text-sm text-slate-500">{{ t('tools.mbtiTest.resultTitle') }}</p>
        <p class="mt-2 text-5xl font-extrabold tracking-[0.15em] text-blue-600 sm:text-6xl">
          {{ result.type }}
        </p>
        <p class="mt-3 text-xs leading-relaxed text-slate-400">
          {{ t('tools.mbtiTest.resultNote') }}
        </p>
      </section>

      <!-- 维度百分比条形图 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div v-for="d in result.dims" :key="d.key" class="mb-4 last:mb-0">
          <div class="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 tabular-nums">
            <span>{{ d.left }} {{ d.leftPct }}%</span>
            <span class="truncate text-[11px] font-normal text-slate-400">
              {{ t(`tools.mbtiTest.dims.${d.key}`) }}
            </span>
            <span>{{ d.rightPct }}% {{ d.right }}</span>
          </div>
          <div class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              class="h-full bg-blue-500 transition-all duration-500"
              :style="{ width: d.leftPct + '%' }"
            ></div>
            <div
              class="h-full bg-amber-400 transition-all duration-500"
              :style="{ width: d.rightPct + '%' }"
            ></div>
          </div>
        </div>
      </section>

      <!-- 类型详细描述 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="space-y-3">
          <div class="rounded-xl border border-slate-100 bg-white/70 px-4 py-3">
            <p class="mb-1 text-xs font-semibold text-blue-600">
              {{ t('tools.mbtiTest.descSummary') }}
            </p>
            <p class="text-sm leading-relaxed text-slate-600">
              {{ t(`tools.mbtiTest.types.${result.type}.summary`) }}
            </p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-4 py-3">
            <p class="mb-1 text-xs font-semibold text-blue-600">
              {{ t('tools.mbtiTest.descStrengths') }}
            </p>
            <p class="text-sm leading-relaxed text-slate-600">
              {{ t(`tools.mbtiTest.types.${result.type}.strengths`) }}
            </p>
          </div>
          <div class="rounded-xl border border-slate-100 bg-white/70 px-4 py-3">
            <p class="mb-1 text-xs font-semibold text-blue-600">
              {{ t('tools.mbtiTest.descCareer') }}
            </p>
            <p class="text-sm leading-relaxed text-slate-600">
              {{ t(`tools.mbtiTest.types.${result.type}.career`) }}
            </p>
          </div>
        </div>
      </section>

      <!-- 操作 -->
      <section class="glass-card flex flex-wrap justify-center gap-2 p-4 sm:p-6 mb-4">
        <button type="button" class="btn-ghost" @click="backToEdit">
          {{ t('tools.mbtiTest.backToEdit') }}
        </button>
        <button type="button" class="btn-danger" @click="retest">
          {{ t('tools.mbtiTest.retest') }}
        </button>
      </section>
    </template>
  </ToolPage>
</template>

<style scoped>
/* 选项大按钮 */
.answer-btn {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 13px 16px;
  border-radius: 14px;
  border: 1.5px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  line-height: 1.55;
  color: #334155;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.answer-btn:hover {
  border-color: rgba(59, 130, 246, 0.6);
}
.answer-btn:active {
  transform: scale(0.99);
}
.answer-btn.selected {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.answer-key {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}
.answer-btn.selected .answer-key {
  background: #3b82f6;
  color: #fff;
}
</style>

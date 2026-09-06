<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import 'katex/dist/katex.min.css'

/**
 * 数学公式编辑：KaTeX 实时渲染（懒加载）
 * - 输入防抖 300ms；throwOnError: false 渲染（错误位置标红）
 * - 再以 throwOnError: true 复检，捕获具体解析错误行内提示
 * - 工具栏模板插入 textarea 光标处（selectionStart/End）
 * - display 模式持久化
 */

/* ---------- LaTeX 模板 / 示例常量（语言包中不能出现花括号等字符，故放此处） ---------- */
// '|' 为光标占位符：插入后定位光标；若存在第二个 '|'，则选中两者之间的内容
const INSERT_TEMPLATES = {
  frac: '\\frac{|}{|}',
  sup: '^{|}',
  sub: '_{|}',
  sqrt: '\\sqrt{|}',
  sum: '\\sum_{i=1}^{n}|',
  int: '\\int_{a}^{b}|',
  lim: '\\lim_{x \\to \\infty}|',
  matrix: '\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}|',
  alpha: '\\alpha ',
  beta: '\\beta ',
  gamma: '\\gamma ',
  delta: '\\delta ',
  pi: '\\pi ',
  theta: '\\theta ',
  lambda: '\\lambda ',
  mu: '\\mu ',
  leq: '\\leq ',
  geq: '\\geq ',
  neq: '\\neq ',
  approx: '\\approx ',
  infty: '\\infty ',
  pm: '\\pm ',
  times: '\\times ',
  div: '\\div ',
  to: '\\rightarrow ',
}

const STRUCT_KEYS = ['frac', 'sup', 'sub', 'sqrt', 'sum', 'int', 'lim', 'matrix']
const GREEK_KEYS = ['alpha', 'beta', 'gamma', 'delta', 'pi', 'theta', 'lambda', 'mu']
const REL_KEYS = ['leq', 'geq', 'neq', 'approx', 'infty', 'pm', 'times', 'div', 'to']

const EXAMPLES = [
  { key: 'exMass', tex: 'E = mc^2' },
  { key: 'exQuadratic', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { key: 'exEuler', tex: 'e^{i\\pi} + 1 = 0' },
]

const DEFAULT_TEX = EXAMPLES[1].tex

/* ---------- 状态 ---------- */
const { t } = useI18n()

const config = useStorage('tool-math-editor-config', {
  displayMode: true,
})

const latex = ref(DEFAULT_TEX)
const editorRef = ref(null)
const previewRef = ref(null)
const errorMsg = ref('')

/* ---------- KaTeX 懒加载与渲染 ---------- */
let katexRef = null
let katexPromise = null

function ensureKatex() {
  if (!katexPromise) {
    katexPromise = import('katex')
      .then((mod) => {
        katexRef = mod.default || mod
        return katexRef
      })
      .catch((e) => {
        katexPromise = null
        throw e
      })
  }
  return katexPromise
}

async function renderNow() {
  const el = previewRef.value
  if (!el) return
  const src = latex.value
  if (!src.trim()) {
    el.innerHTML = ''
    errorMsg.value = ''
    return
  }
  let katex
  try {
    katex = await ensureKatex()
  } catch (e) {
    errorMsg.value = t('toolsCommon.networkError')
    return
  }
  errorMsg.value = ''
  // throwOnError: false：错误位置标红渲染，不中断页面
  try {
    katex.render(src, el, {
      throwOnError: false,
      displayMode: !!config.value.displayMode,
      strict: false,
    })
  } catch (e) {
    el.textContent = src
  }
  // throwOnError: true 复检，捕获具体错误消息用于行内提示
  try {
    katex.renderToString(src, {
      throwOnError: true,
      displayMode: !!config.value.displayMode,
      strict: false,
    })
  } catch (e) {
    errorMsg.value = e && e.message ? e.message : t('tools.mathEditor.renderError')
  }
}

const renderDebounced = useDebounceFn(renderNow, 300)

watch(latex, () => renderDebounced())
watch(() => config.value.displayMode, () => renderDebounced())

onMounted(() => {
  renderNow()
})

/* ---------- 光标处插入模板 ---------- */
function insertTemplate(tpl) {
  const el = editorRef.value
  const text = latex.value
  const marker = '|'
  const first = tpl.indexOf(marker)
  const second = first >= 0 ? tpl.indexOf(marker, first + 1) : -1
  const clean = tpl.split(marker).join('')
  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : text.length
  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : start
  latex.value = text.slice(0, start) + clean + text.slice(end)
  nextTick(() => {
    if (!el) return
    el.focus()
    if (first >= 0 && second >= 0) {
      el.setSelectionRange(start + first, start + second)
    } else if (first >= 0) {
      el.setSelectionRange(start + first, start + first)
    } else {
      el.setSelectionRange(start + clean.length, start + clean.length)
    }
  })
  renderDebounced()
}

/* ---------- 示例 / 清空 ---------- */
function applyExample(tex) {
  latex.value = tex
  renderDebounced()
}

function clearInput() {
  latex.value = ''
  renderDebounced()
}
</script>

<template>
  <ToolPage tool-id="mathEditor">
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 渲染模式 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="label-base mb-0 mr-1">{{ t('tools.mathEditor.modeInline') }} / {{ t('tools.mathEditor.modeDisplay') }}</span>
        <div class="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white/70">
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium transition"
            :class="!config.displayMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-blue-600'"
            @click="config.displayMode = false"
          >
            {{ t('tools.mathEditor.modeInline') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium transition"
            :class="config.displayMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-blue-600'"
            @click="config.displayMode = true"
          >
            {{ t('tools.mathEditor.modeDisplay') }}
          </button>
        </div>
      </div>

      <!-- 符号/结构工具栏 -->
      <div class="mt-4 space-y-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="chip">{{ t('tools.mathEditor.groupStruct') }}</span>
          <button
            v-for="key in STRUCT_KEYS"
            :key="key"
            type="button"
            class="btn-ghost !px-2.5 !py-1 font-mono text-xs"
            :title="t(`tools.mathEditor.items.${key}`)"
            @click="insertTemplate(INSERT_TEMPLATES[key])"
          >
            {{ t(`tools.mathEditor.items.${key}`) }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="chip">{{ t('tools.mathEditor.groupGreek') }}</span>
          <button
            v-for="key in GREEK_KEYS"
            :key="key"
            type="button"
            class="btn-ghost !px-2.5 !py-1 font-mono text-xs"
            :title="t(`tools.mathEditor.items.${key}`)"
            @click="insertTemplate(INSERT_TEMPLATES[key])"
          >
            {{ t(`tools.mathEditor.items.${key}`) }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="chip">{{ t('tools.mathEditor.groupRel') }}</span>
          <button
            v-for="key in REL_KEYS"
            :key="key"
            type="button"
            class="btn-ghost !px-2.5 !py-1 font-mono text-xs"
            :title="t(`tools.mathEditor.items.${key}`)"
            @click="insertTemplate(INSERT_TEMPLATES[key])"
          >
            {{ t(`tools.mathEditor.items.${key}`) }}
          </button>
        </div>
      </div>

      <!-- 编辑 + 预览 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5 flex-wrap">
            <span class="label-base flex-1 mb-0">{{ t('tools.mathEditor.inputLabel') }}</span>
            <CopyButton :text="latex" :label="t('tools.mathEditor.copySource')" :disabled="!latex" />
            <button type="button" class="btn-danger" @click="clearInput">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
          <textarea
            ref="editorRef"
            v-model="latex"
            class="input-base w-full font-mono h-[280px] lg:h-[360px] resize-none"
            :placeholder="t('tools.mathEditor.placeholder')"
            spellcheck="false"
          ></textarea>
        </div>

        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('toolsCommon.preview') }}</span>
            <span v-for="ex in EXAMPLES" :key="ex.key">
              <button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" @click="applyExample(ex.tex)">
                {{ t(`tools.mathEditor.examples.${ex.key}`) }}
              </button>
            </span>
          </div>
          <div
            class="h-[280px] lg:h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white/90 px-4 py-6 flex items-start justify-center"
          >
            <span v-if="!latex.trim()" class="text-sm text-slate-400 self-center">{{ t('toolsCommon.none') }}</span>
            <div
              v-show="latex.trim()"
              ref="previewRef"
              class="math-preview w-full overflow-x-auto"
              :class="config.displayMode ? 'text-center' : ''"
              role="region"
              :aria-label="t('toolsCommon.preview')"
            ></div>
          </div>
        </div>
      </div>

      <!-- 行内错误提示 -->
      <p v-if="errorMsg" class="mt-3 text-sm text-red-600 break-all">
        {{ t('tools.mathEditor.renderError') }}：{{ errorMsg }}
        <span class="text-red-400">{{ t('tools.mathEditor.errorHint') }}</span>
      </p>
    </section>
  </ToolPage>
</template>

<style scoped>
.math-preview {
  font-size: 1.15rem;
  color: #1e293b;
}

/* KaTeX 渲染的错误片段标红（throwOnError: false 模式） */
.math-preview :deep(.katex-error) {
  color: #dc2626;
}

.math-preview :deep(.katex-display) {
  margin: 0;
}
</style>

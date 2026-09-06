<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

const { t, locale } = useI18n()
const toast = useToast()

/**
 * 示例正则含 | @ {} 等字面量，必须放在 JS 常量中，禁止写入语言包
 */
const PRESETS = [
  { key: 'Email', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
  { key: 'Url', pattern: 'https?://[^\\s/]+(?:/[^\\s]*)?' },
  { key: 'Date', pattern: '\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])' },
]

const FLAG_LIST = [
  { value: 'g', labelKey: 'flagG' },
  { value: 'i', labelKey: 'flagI' },
  { value: 'm', labelKey: 'flagM' },
  { value: 's', labelKey: 'flagS' },
  { value: 'u', labelKey: 'flagU' },
  { value: 'y', labelKey: 'flagY' },
]

const DEFAULT_PATTERN = PRESETS[0].pattern
/** 节点数上限：防止灾难性大图卡死页面 */
const MAX_NODES = 500

/** 持久化最后输入与修饰符偏好 */
const config = useStorage('tool-regex-railroad-config', {
  pattern: DEFAULT_PATTERN,
  flags: ['g'],
})

/** v-model 安全层：存储值被破坏时回退默认值，绝不让页面崩溃 */
const pattern = ref(
  typeof config.value.pattern === 'string' && config.value.pattern ? config.value.pattern : DEFAULT_PATTERN
)
const flags = computed({
  get: () => (Array.isArray(config.value.flags) ? config.value.flags : []),
  set: value => {
    config.value.flags = Array.isArray(value) ? value : []
  },
})

watch(pattern, value => {
  config.value.pattern = value
})

/** 实时渲染：输入防抖 400ms */
const debouncedPattern = ref(pattern.value)
const scheduleRender = useDebounceFn(() => {
  debouncedPattern.value = pattern.value
}, 400)
watch(pattern, () => scheduleRender())

// ---------------------------------------------------------------------------
// 依赖库懒加载（均为 CJS，取 default 互操作对象）
// ---------------------------------------------------------------------------
let libCache = null
async function loadLibs() {
  if (libCache) return libCache
  const [rtMod, rrdMod] = await Promise.all([import('regexp-tree'), import('railroad-diagrams')])
  libCache = { rt: rtMod.default || rtMod, rrd: rrdMod.default || rrdMod }
  return libCache
}

// ---------------------------------------------------------------------------
// 输入规整：支持裸正则与 /…/flags 包裹形式，只有 source 参与解析
// ---------------------------------------------------------------------------
function extractSource(raw) {
  const text = String(raw || '').trim()
  if (text.length > 1 && text.startsWith('/')) {
    const lastSlash = text.lastIndexOf('/')
    if (lastSlash > 0) {
      const maybeFlags = text.slice(lastSlash + 1)
      if (/^[a-z]*$/.test(maybeFlags)) {
        return text.slice(1, lastSlash)
      }
    }
  }
  return text
}

/** 给裸正则中未转义的斜杠补上转义，便于包成 /…/ 交给解析器 */
function escapeBareSlashes(source) {
  return source.replace(/\\.|[/]/g, m => (m === '/' ? '\\/' : m))
}

function flagString() {
  return FLAG_LIST.filter(f => flags.value.includes(f.value)).map(f => f.value).join('')
}

/** 多候选解析：带修饰符 -> 不带修饰符 -> 转义裸斜杠，任一成功即可 */
function tryParse(rt, source) {
  const flagStr = flagString()
  const attempts = [
    '/' + source + '/' + flagStr,
    '/' + source + '/',
    '/' + escapeBareSlashes(source) + '/' + flagStr,
  ]
  let lastErr = null
  for (const candidate of attempts) {
    try {
      return rt.parse(candidate)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('parse failed')
}

// ---------------------------------------------------------------------------
// AST -> railroad-diagrams 节点映射
// ---------------------------------------------------------------------------
function charText(node) {
  if (!node) return ''
  if (node.kind === 'simple') {
    return node.escaped ? '\\' + String(node.value) : String(node.value)
  }
  return String(node.value || node.symbol || '')
}

function classText(node) {
  let inner = ''
  const exprs = Array.isArray(node.expressions) ? node.expressions : []
  for (const item of exprs) {
    if (item && item.type === 'ClassRange' && item.from && item.to) {
      inner += charText(item.from) + '-' + charText(item.to)
    } else if (item && item.type === 'CharacterClass') {
      inner += classText(item)
    } else if (item) {
      inner += charText(item)
    }
  }
  return '[' + (node.negative ? '^' : '') + inner + ']'
}

function buildMapper(rrd, unsupportedLabel) {
  let nodeCount = 0

  function flattenDisjunction(node, out) {
    if (!node || node.type !== 'Disjunction') {
      out.push(node ? mapNode(node) : new rrd.Skip())
      return
    }
    if (node.left === null || node.left === undefined) out.push(new rrd.Skip())
    else flattenDisjunction(node.left, out)
    if (node.right === null || node.right === undefined) out.push(new rrd.Skip())
    else flattenDisjunction(node.right, out)
  }

  function mapAssertion(node) {
    if (node.kind === 'Lookahead' || node.kind === 'Lookbehind') {
      const op =
        node.kind === 'Lookahead'
          ? node.negative
            ? '(?!)'
            : '(?=)'
          : node.negative
            ? '(?<!)'
            : '(?<=)'
      const inner = node.assertion ? mapNode(node.assertion) : new rrd.Skip()
      return new rrd.Sequence([new rrd.Terminal(op), inner])
    }
    // '^' '$' '\b' '\B'
    return new rrd.Terminal(String(node.kind))
  }

  function mapRepetition(node) {
    const child = mapNode(node.expression)
    const q = node.quantifier || {}
    const lazy = q.greedy === false
    switch (q.kind) {
      case '+':
        return lazy
          ? new rrd.Sequence([new rrd.OneOrMore(child), new rrd.Terminal('+?')])
          : new rrd.OneOrMore(child)
      case '*':
        return lazy
          ? new rrd.Sequence([new rrd.ZeroOrMore(child), new rrd.Terminal('*?')])
          : new rrd.ZeroOrMore(child)
      case '?':
        return lazy
          ? new rrd.Sequence([new rrd.Optional(child), new rrd.Terminal('??')])
          : new rrd.Optional(child)
      case 'Range': {
        const from = Number(q.from) || 0
        const to = q.to === undefined || q.to === null ? undefined : Number(q.to)
        if (!lazy && from === 0 && to === undefined) return new rrd.ZeroOrMore(child)
        if (!lazy && from === 1 && to === undefined) return new rrd.OneOrMore(child)
        if (!lazy && from === 0 && to === 1) return new rrd.Optional(child)
        let text
        if (to === undefined) text = '{' + from + ',}'
        else if (to === from) text = '{' + from + '}'
        else text = '{' + from + ',' + to + '}'
        if (lazy) text += '?'
        return new rrd.Sequence([child, new rrd.Terminal(text)])
      }
      default:
        return child
    }
  }

  function mapNode(node) {
    if (node === null || node === undefined) return new rrd.Skip()
    if (++nodeCount > MAX_NODES) {
      throw new Error('TOO_COMPLEX')
    }
    switch (node.type) {
      case 'RegExp':
        return node.body ? mapNode(node.body) : new rrd.Skip()
      case 'Disjunction': {
        const choices = []
        flattenDisjunction(node, choices)
        return new rrd.Choice(0, choices)
      }
      case 'Alternative': {
        const seq = (node.expressions || []).map(mapNode)
        return seq.length === 1 ? seq[0] : new rrd.Sequence(seq)
      }
      case 'Char':
        return new rrd.Terminal(charText(node))
      case 'CharacterClass':
        return new rrd.Terminal(classText(node))
      case 'Group': {
        const inner = node.expression ? mapNode(node.expression) : new rrd.Skip()
        if (!node.capturing) return inner
        const label = node.name ? String(node.name) : '#' + (node.number || '')
        return new rrd.Sequence([new rrd.NonTerminal(label), inner])
      }
      case 'Backreference': {
        const text =
          node.kind === 'name' ? '\\k<' + String(node.reference) + '>' : '\\' + String(node.reference)
        return new rrd.Terminal(text)
      }
      case 'Assertion':
        return mapAssertion(node)
      case 'Repetition':
        return mapRepetition(node)
      case 'Empty':
        return new rrd.Skip()
      default:
        // 友好占位节点：未知语法不崩溃
        return new rrd.NonTerminal(unsupportedLabel + ': ' + String(node.type))
    }
  }

  return mapNode
}

// ---------------------------------------------------------------------------
// 渲染流程
// ---------------------------------------------------------------------------
const svgMarkup = ref('')
const renderError = ref('') // '' | 'invalid' | 'complex' | 'render'
const errorDetail = ref('')
const isBusy = ref(false)

let renderSeq = 0

async function render() {
  const seq = ++renderSeq
  const source = extractSource(debouncedPattern.value)
  if (!source) {
    svgMarkup.value = ''
    renderError.value = ''
    errorDetail.value = ''
    isBusy.value = false
    return
  }
  isBusy.value = true
  try {
    const { rt, rrd } = await loadLibs()
    if (seq !== renderSeq) return
    const ast = tryParse(rt, source)
    if (seq !== renderSeq) return
    const mapNode = buildMapper(rrd, t('tools.regexRailroad.unsupportedNode'))
    const bodyItem = ast && ast.body ? mapNode(ast.body) : new rrd.Skip()
    const diagram = new rrd.Diagram([bodyItem])
    const markup = diagram.toString()
    if (seq !== renderSeq) return
    svgMarkup.value = markup
    renderError.value = ''
    errorDetail.value = ''
  } catch (err) {
    if (seq !== renderSeq) return
    svgMarkup.value = ''
    if (err && err.message === 'TOO_COMPLEX') {
      renderError.value = 'complex'
      errorDetail.value = ''
    } else if (err instanceof SyntaxError || /regular expression|escape|quantifier|group/i.test(String(err && err.message))) {
      renderError.value = 'invalid'
      errorDetail.value = err && err.message ? String(err.message) : ''
    } else {
      renderError.value = 'render'
      errorDetail.value = err && err.message ? String(err.message) : ''
    }
  } finally {
    if (seq === renderSeq) isBusy.value = false
  }
}

watch(debouncedPattern, () => render(), { immediate: true })

/** 语言切换后用新文案立即重绘（「暂不支持」等标签画在 SVG 里） */
watch(locale, () => render())

// 错误出现时给一次 Toast（行内提示常驻）
watch(renderError, (val, old) => {
  if (val && !old) {
    toast.error(
      val === 'complex'
        ? t('tools.regexRailroad.tooComplex')
        : t('toolsCommon.invalidInput')
    )
  }
})

const hasInput = computed(() => extractSource(pattern.value).length > 0)
const canExport = computed(() => svgMarkup.value.length > 0)

function applyPreset(preset) {
  pattern.value = preset.pattern
  debouncedPattern.value = preset.pattern
}

function exportSvg() {
  if (!svgMarkup.value) return
  try {
    downloadText(svgMarkup.value, 'regex-railroad.svg', 'image/svg+xml;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="regexRailroad">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="railroad-pattern">{{ t('tools.regexRailroad.pattern') }}</label>
      <input
        id="railroad-pattern"
        v-model="pattern"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="input-base font-mono"
        :class="renderError === 'invalid' ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
        :placeholder="t('tools.regexRailroad.patternPlaceholder')"
        :aria-invalid="renderError === 'invalid' ? 'true' : 'false'"
        :aria-label="t('tools.regexRailroad.pattern')"
      />

      <!-- 修饰符：不影响图形结构 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.regexRailroad.flags') }}</span>
        <label
          v-for="f in FLAG_LIST"
          :key="f.value"
          class="chip cursor-pointer select-none"
          :class="{ 'opacity-50': !flags.includes(f.value) }"
        >
          <input v-model="flags" type="checkbox" :value="f.value" class="mr-1 accent-blue-600" />
          <span class="font-mono font-semibold">{{ f.value }}</span>
          <span class="ml-1">{{ t(`tools.regexRailroad.${f.labelKey}`) }}</span>
        </label>
      </div>

      <!-- 内置示例 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-slate-500">{{ t('tools.regexRailroad.presets') }}</span>
        <button
          v-for="p in PRESETS"
          :key="p.key"
          type="button"
          class="btn-ghost"
          @click="applyPreset(p)"
        >
          {{ t(`tools.regexRailroad.preset${p.key}`) }}
        </button>
      </div>

      <!-- 行内错误提示 -->
      <p v-if="renderError === 'invalid'" class="mt-3 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.regexRailroad.invalidRegex') }}
        <span v-if="errorDetail" class="text-red-400">（{{ errorDetail }}）</span>
      </p>
      <p v-else-if="renderError === 'complex'" class="mt-3 text-amber-600 text-sm" role="alert">
        {{ t('tools.regexRailroad.tooComplex') }}
      </p>
      <p v-else-if="renderError === 'render'" class="mt-3 text-red-600 text-sm" role="alert">
        {{ t('tools.regexRailroad.renderFailed') }}
      </p>
    </section>

    <!-- 图形预览区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.regexRailroad.diagram') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="isBusy" class="chip">{{ t('toolsCommon.processing') }}</span>
          <CopyButton
            :text="svgMarkup"
            :label="t('tools.regexRailroad.copySvgCode')"
            :disabled="!canExport"
          />
          <button type="button" class="btn-primary" :disabled="!canExport" @click="exportSvg">
            {{ t('tools.regexRailroad.exportSvg') }}
          </button>
        </div>
      </div>

      <p v-if="!hasInput" class="py-8 text-center text-sm text-slate-400">
        {{ t('tools.regexRailroad.emptyPatternHint') }}
      </p>
      <template v-else>
        <!-- 图形宽度可能超出容器：允许横向滚动 -->
        <div class="diagram-scroll rounded-xl border border-slate-100 bg-white/70 p-3">
          <!-- v-html 内容为库生成的 SVG 标记，文本已经由库转义 -->
          <div v-html="svgMarkup"></div>
        </div>
        <p v-if="renderError === 'complex'" class="mt-3 text-amber-600 text-sm" role="alert">
          {{ t('tools.regexRailroad.tooComplex') }}
        </p>
        <p class="mt-2 text-xs text-slate-400">{{ t('tools.regexRailroad.unsupportedHint') }}</p>
      </template>
    </section>
  </ToolPage>
</template>

<style scoped>
.diagram-scroll {
  overflow-x: auto;
  min-height: 96px;
}

/* railroad-diagrams 生成的 SVG 自带类名，这里补充与站点一致的 minimal 样式 */
.diagram-scroll :deep(svg.railroad-diagram) {
  background: transparent;
  height: auto;
  min-width: 100%;
}

.diagram-scroll :deep(svg.railroad-diagram path) {
  stroke: #64748b;
  stroke-width: 2;
  fill: none;
}

.diagram-scroll :deep(svg.railroad-diagram rect) {
  stroke: #60a5fa;
  stroke-width: 1.5;
  fill: #eff6ff;
}

.diagram-scroll :deep(svg.railroad-diagram text) {
  font: bold 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  fill: #334155;
  text-anchor: middle;
}

.diagram-scroll :deep(svg.railroad-diagram text.label) {
  text-anchor: start;
}

.diagram-scroll :deep(svg.railroad-diagram text.comment) {
  font: italic 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  fill: #94a3b8;
}
</style>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { escapeHtml } from '@/utils/html'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { downloadCanvasAsPng } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * 代码截图生成
 * - highlight.js 对代码着色得到 token HTML，注入离屏隐藏 DOM
 * - 逐行逐 token 用 canvas fillText 绘制（monospace 等宽、行高 fontSize * 1.6）
 * - 窗口装饰（渐变背景、圆角窗口、三色圆点、标题）一并绘制进 canvas
 * - 2 倍设备像素比导出高清 PNG；预览 canvas 防抖 300ms 实时刷新
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-code-screenshot-config', {
  language: 'javascript',
  theme: 'dark',
  gradient: 0,
  windowStyle: 'mac',
  title: 'main.js',
  padding: 32,
})

const codeText = ref(`// ToolboxLab\nconst greeting = 'Hello, World!'\n\nfunction greet(name) {\n  return \`\${greeting} I am \${name}.\`\n}\n\nconsole.log(greet('ZCode'))\n`)

const canvasRef = ref(null)
const hiddenRef = ref(null)
const renderError = ref('')

/* ---------------- 常量数据 ---------------- */

const LANGUAGES = [
  { id: 'javascript', labelKey: 'tools.codeScreenshot.langJavaScript' },
  { id: 'typescript', labelKey: 'tools.codeScreenshot.langTypescript' },
  { id: 'html', labelKey: 'tools.codeScreenshot.langHtml' },
  { id: 'css', labelKey: 'tools.codeScreenshot.langCss' },
  { id: 'json', labelKey: 'tools.codeScreenshot.langJson' },
  { id: 'python', labelKey: 'tools.codeScreenshot.langPython' },
  { id: 'java', labelKey: 'tools.codeScreenshot.langJava' },
  { id: 'go', labelKey: 'tools.codeScreenshot.langGo' },
  { id: 'sql', labelKey: 'tools.codeScreenshot.langSql' },
  { id: 'bash', labelKey: 'tools.codeScreenshot.langBash' },
]

/** 主题：窗口底色 + 文字默认色 + token 分组配色 */
const THEMES = {
  dark: {
    windowBg: '#0f172a',
    fallbackColor: '#e2e8f0',
    titleColor: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.25)',
    separator: 'rgba(148, 163, 184, 0.18)',
    tokens: {
      keyword: '#93c5fd',
      string: '#86efac',
      number: '#d8b4fe',
      comment: '#64748b',
      title: '#7dd3fc',
      attr: '#fbbf24',
      builtIn: '#67e8f9',
      literal: '#f0abfc',
      variable: '#fda4af',
      meta: '#94a3b8',
      type: '#5eead4',
    },
  },
  light: {
    windowBg: '#ffffff',
    fallbackColor: '#1e293b',
    titleColor: '#64748b',
    border: 'rgba(15, 23, 42, 0.10)',
    separator: 'rgba(15, 23, 42, 0.08)',
    tokens: {
      keyword: '#2563eb',
      string: '#16a34a',
      number: '#9333ea',
      comment: '#94a3b8',
      title: '#0369a1',
      attr: '#d97706',
      builtIn: '#0891b2',
      literal: '#7c3aed',
      variable: '#be123c',
      meta: '#64748b',
      type: '#0f766e',
    },
  },
  mint: {
    windowBg: '#ecfdf5',
    fallbackColor: '#065f46',
    titleColor: '#047857',
    border: 'rgba(6, 95, 70, 0.15)',
    separator: 'rgba(6, 95, 70, 0.12)',
    tokens: {
      keyword: '#047857',
      string: '#0d9488',
      number: '#7c3aed',
      comment: '#94a3b8',
      title: '#0e7490',
      attr: '#b45309',
      builtIn: '#0891b2',
      literal: '#6d28d9',
      variable: '#be185d',
      meta: '#64748b',
      type: '#0f766e',
    },
  },
}

const THEME_OPTIONS = [
  { id: 'dark', labelKey: 'tools.codeScreenshot.themeDark' },
  { id: 'light', labelKey: 'tools.codeScreenshot.themeLight' },
  { id: 'mint', labelKey: 'tools.codeScreenshot.themeMint' },
]

/** 渐变背景预设 6 个 */
const GRADIENTS = [
  { id: 'sunrise', from: '#fde68a', to: '#f59e0b', labelKey: 'tools.codeScreenshot.gradientSunrise' },
  { id: 'ocean', from: '#7dd3fc', to: '#4f46e5', labelKey: 'tools.codeScreenshot.gradientOcean' },
  { id: 'violet', from: '#d8b4fe', to: '#7c3aed', labelKey: 'tools.codeScreenshot.gradientViolet' },
  { id: 'emerald', from: '#6ee7b7', to: '#0f766e', labelKey: 'tools.codeScreenshot.gradientEmerald' },
  { id: 'rose', from: '#fda4af', to: '#e11d48', labelKey: 'tools.codeScreenshot.gradientRose' },
  { id: 'graphite', from: '#cbd5e1', to: '#334155', labelKey: 'tools.codeScreenshot.gradientGraphite' },
]

const WINDOW_STYLES = [
  { id: 'mac', labelKey: 'tools.codeScreenshot.styleMac' },
  { id: 'plain', labelKey: 'tools.codeScreenshot.stylePlain' },
]

const DOT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

/** hljs class 前缀 → 主题 token 分组（顺序敏感，先具体后一般） */
const CLASS_TOKEN_MAP = [
  ['hljs-comment', 'comment'],
  ['hljs-quote', 'comment'],
  ['hljs-doctag', 'comment'],
  ['hljs-keyword', 'keyword'],
  ['hljs-selector-tag', 'keyword'],
  ['hljs-selector-pseudo', 'keyword'],
  ['hljs-selector-id', 'attr'],
  ['hljs-selector-class', 'attr'],
  ['hljs-selector-attr', 'attr'],
  ['hljs-string', 'string'],
  ['hljs-regexp', 'string'],
  ['hljs-addition', 'string'],
  ['hljs-number', 'number'],
  ['hljs-symbol', 'number'],
  ['hljs-bullet', 'number'],
  ['hljs-link', 'keyword'],
  ['hljs-built_in', 'builtIn'],
  ['hljs-attr', 'attr'],
  ['hljs-attribute', 'attr'],
  ['hljs-title', 'title'],
  ['hljs-section', 'title'],
  ['hljs-name', 'title'],
  ['hljs-literal', 'literal'],
  ['hljs-type', 'type'],
  ['hljs-template-variable', 'variable'],
  ['hljs-variable', 'variable'],
  ['hljs-params', 'variable'],
  ['hljs-meta', 'meta'],
  ['hljs-deletion', 'meta'],
]

function tokenColor(classAttr, theme) {
  for (const [cls, group] of CLASS_TOKEN_MAP) {
    if (classAttr.includes(cls)) {
      return theme.tokens[group] || theme.fallbackColor
    }
  }
  return theme.fallbackColor
}

/* ---------------- highlight.js 懒加载 ---------------- */

let hljsRef = null
let readyPromise = null

const LANG_MODULES = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  json: () => import('highlight.js/lib/languages/json'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  go: () => import('highlight.js/lib/languages/go'),
  sql: () => import('highlight.js/lib/languages/sql'),
  bash: () => import('highlight.js/lib/languages/bash'),
}


function ensureHighlighter() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const core = await import('highlight.js/lib/core')
      hljsRef = core.default
      for (const [name, loader] of Object.entries(LANG_MODULES)) {
        const mod = await loader()
        hljsRef.registerLanguage(name, mod.default)
      }
      // html 复用 xml 语法规则（registerLanguage 需要定义函数而非 getLanguage 的描述对象）
      const xmlMod = await LANG_MODULES.xml()
      hljsRef.registerLanguage('html', xmlMod.default)
    })()
  }
  return readyPromise
}

/* ---------------- 离屏 DOM → 逐行 token ---------------- */

/**
 * 把高亮 HTML 注入隐藏 DOM，按换行切分为 token 行
 * @returns {Array<Array<{ text: string, cls: string }>>}
 */
function extractLines(host, html) {
  host.innerHTML = html
  const lines = [[]]
  const walk = (node, cls) => {
    if (node.nodeType === 3) {
      const parts = node.textContent.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) lines.push([])
        if (part) lines[lines.length - 1].push({ text: part, cls })
      })
    } else if (node.nodeType === 1) {
      const c = node.getAttribute('class') || cls
      node.childNodes.forEach((child) => walk(child, c))
    }
  }
  Array.from(host.childNodes).forEach((n) => walk(n, ''))
  host.innerHTML = ''
  return lines
}

/* ---------------- canvas 绘制 ---------------- */

function traceRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawScreenshot(canvas, lines) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  const theme = THEMES[config.value.theme] || THEMES.dark
  const grad = GRADIENTS[config.value.gradient] || GRADIENTS[0]
  const hasHeader = config.value.windowStyle !== 'plain'
  const title = String(config.value.title || '').trim().slice(0, 60)
  const outerPad = Math.min(120, Math.max(16, Number(config.value.padding) || 32))

  const fontSize = 15
  const lineHeight = Math.round(fontSize * 1.6)
  const padX = 24
  const padY = 20
  const headerH = hasHeader ? 44 : 0
  const radius = 14
  const dpr = 2

  ctx.font = `${fontSize}px Menlo, Consolas, "Courier New", monospace`
  // monospace 等宽字符宽度，用于估算整块代码宽度
  const charW = ctx.measureText('M').width

  const safeLines = lines.slice(0, 500)
  const lineWidths = safeLines.map((tokens) =>
    tokens.reduce((sum, tk) => sum + ctx.measureText(tk.text).width, 0),
  )
  const contentW = Math.min(Math.max(charW * 16, ...lineWidths, 1), 2400)

  const windowW = Math.ceil(contentW + padX * 2)
  const windowH = Math.ceil(headerH + padY * 2 + safeLines.length * lineHeight)
  const imgW = windowW + outerPad * 2
  const imgH = windowH + outerPad * 2

  canvas.width = Math.ceil(imgW * dpr)
  canvas.height = Math.ceil(imgH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 渐变背景
  const bg = ctx.createLinearGradient(0, 0, imgW, imgH)
  bg.addColorStop(0, grad.from)
  bg.addColorStop(1, grad.to)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, imgW, imgH)

  // 窗口（投影 + 圆角底色 + 描边）
  ctx.save()
  ctx.shadowColor = 'rgba(2, 6, 23, 0.35)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 12
  ctx.fillStyle = theme.windowBg
  traceRoundRect(ctx, outerPad, outerPad, windowW, windowH, radius)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = theme.border
  ctx.lineWidth = 1
  traceRoundRect(ctx, outerPad + 0.5, outerPad + 0.5, windowW - 1, windowH - 1, radius)
  ctx.stroke()

  // macOS 头部：三色圆点 + 标题 + 分隔线
  if (hasHeader) {
    const cy = outerPad + headerH / 2
    DOT_COLORS.forEach((color, i) => {
      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(outerPad + 20 + i * 18, cy, 6, 0, Math.PI * 2)
      ctx.fill()
    })
    if (title) {
      ctx.font = `500 13px system-ui, -apple-system, "Segoe UI", sans-serif`
      ctx.fillStyle = theme.titleColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(title, outerPad + windowW / 2, cy + 1)
      ctx.textAlign = 'left'
    }
    ctx.strokeStyle = theme.separator
    ctx.beginPath()
    ctx.moveTo(outerPad + 1, outerPad + headerH + 0.5)
    ctx.lineTo(outerPad + windowW - 1, outerPad + headerH + 0.5)
    ctx.stroke()
  }

  // 逐行逐 token 绘制代码
  ctx.font = `${fontSize}px Menlo, Consolas, "Courier New", monospace`
  ctx.textBaseline = 'top'
  const codeTop = outerPad + headerH + padY
  const codeLeft = outerPad + padX
  safeLines.forEach((tokens, li) => {
    const y = codeTop + li * lineHeight + (lineHeight - fontSize) / 2
    let x = codeLeft
    for (const tk of tokens) {
      ctx.fillStyle = tk.cls ? tokenColor(tk.cls, theme) : theme.fallbackColor
      ctx.fillText(tk.text, x, y)
      x += ctx.measureText(tk.text).width
    }
  })
}

/* ---------------- 渲染入口（防抖 300ms） ---------------- */

async function renderScreenshot() {
  const canvas = canvasRef.value
  const host = hiddenRef.value
  if (!canvas || !host) return
  try {
    renderError.value = ''
    await ensureHighlighter()
    const code = codeText.value
    let highlighted = ''
    if (code) {
      const lang = config.value.language
      const registered = hljsRef.getLanguage(lang)
      if (registered) {
        try {
          highlighted = hljsRef.highlight(code, { language: lang, ignoreIllegals: true }).value
        } catch {
          highlighted = escapeHtml(code)
        }
      } else {
        highlighted = escapeHtml(code)
      }
    }
    const lines = extractLines(host, highlighted)
    drawScreenshot(canvas, lines)
  } catch {
    renderError.value = t('tools.codeScreenshot.renderError')
  }
}

const renderDebounced = useDebounceFn(renderScreenshot, 300)

watch([codeText, config], () => renderDebounced(), { deep: true })

onMounted(() => {
  renderScreenshot()
})

/* ---------------- 操作 ---------------- */

async function loadSample() {
  codeText.value = `// ToolboxLab\nconst greeting = 'Hello, World!'\n\nfunction greet(name) {\n  return \`\${greeting} I am \${name}.\`\n}\n\nconsole.log(greet('ZCode'))\n`
}

function clearCode() {
  codeText.value = ''
}

async function downloadPng() {
  try {
    await renderScreenshot()
    const canvas = canvasRef.value
    if (!canvas || !codeText.value.trim()) return
    downloadCanvasAsPng(canvas, 'code-screenshot.png')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('tools.codeScreenshot.downloadFailed'))
  }
}
</script>

<template>
  <ToolPage tool-id="codeScreenshot">
    <!-- 代码输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="label-base flex-1 mb-0">{{ t('tools.codeScreenshot.editorLabel') }}</span>
        <button type="button" class="btn-ghost" @click="loadSample">
          {{ t('tools.codeScreenshot.sample') }}
        </button>
        <button type="button" class="btn-danger" @click="clearCode">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <textarea
        v-model="codeText"
        class="input-base w-full font-mono text-xs sm:text-sm h-52 resize-y"
        :placeholder="t('tools.codeScreenshot.editorPlaceholder')"
        :aria-label="t('tools.codeScreenshot.editorLabel')"
        spellcheck="false"
      ></textarea>
      <p v-if="renderError" class="text-red-600 text-sm mt-2">{{ renderError }}</p>
    </section>

    <!-- 样式选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        <!-- 语言 -->
        <div>
          <label class="label-base" for="cs-language">{{ t('tools.codeScreenshot.languageLabel') }}</label>
          <select
            id="cs-language"
            v-model="config.language"
            class="input-base"
            :aria-label="t('tools.codeScreenshot.languageLabel')"
          >
            <option v-for="lang in LANGUAGES" :key="lang.id" :value="lang.id">
              {{ t(lang.labelKey) }}
            </option>
          </select>
        </div>

        <!-- 主题 -->
        <div>
          <span class="label-base">{{ t('tools.codeScreenshot.themeLabel') }}</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="th in THEME_OPTIONS"
              :key="th.id"
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium transition select-none inline-flex items-center gap-1.5 border"
              :class="
                config.theme === th.id
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
              "
              :aria-pressed="config.theme === th.id"
              @click="config.theme = th.id"
            >
              <span
                class="w-3 h-3 rounded-full border border-slate-300 inline-block"
                :style="{ background: THEMES[th.id].windowBg }"
                aria-hidden="true"
              ></span>
              {{ t(th.labelKey) }}
            </button>
          </div>
        </div>

        <!-- 渐变背景 -->
        <div>
          <span class="label-base">{{ t('tools.codeScreenshot.gradientLabel') }}</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(g, gi) in GRADIENTS"
              :key="g.id"
              type="button"
              class="w-9 h-9 rounded-lg border transition select-none"
              :class="config.gradient === gi ? 'ring-2 ring-blue-500 ring-offset-2 border-transparent' : 'border-white/60 hover:scale-105'"
              :style="{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }"
              :aria-label="t(g.labelKey)"
              :title="t(g.labelKey)"
              :aria-pressed="config.gradient === gi"
              @click="config.gradient = gi"
            ></button>
          </div>
        </div>

        <!-- 窗口样式 -->
        <div>
          <span class="label-base">{{ t('tools.codeScreenshot.windowStyleLabel') }}</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="ws in WINDOW_STYLES"
              :key="ws.id"
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium transition select-none border"
              :class="
                config.windowStyle === ws.id
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
              "
              :aria-pressed="config.windowStyle === ws.id"
              @click="config.windowStyle = ws.id"
            >
              {{ t(ws.labelKey) }}
            </button>
          </div>
        </div>

        <!-- 标题 -->
        <div>
          <label class="label-base" for="cs-title">{{ t('tools.codeScreenshot.titleLabel') }}</label>
          <input
            id="cs-title"
            v-model="config.title"
            type="text"
            class="input-base font-mono"
            :placeholder="t('tools.codeScreenshot.titlePlaceholder')"
            :aria-label="t('tools.codeScreenshot.titleLabel')"
            maxlength="60"
          />
        </div>

        <!-- 内边距滑块 -->
        <div>
          <label class="label-base" for="cs-padding">
            {{ t('tools.codeScreenshot.paddingLabel') }}
            <span class="text-xs text-slate-400 font-normal ml-1">{{ config.padding }}px</span>
          </label>
          <input
            id="cs-padding"
            v-model.number="config.padding"
            type="range"
            class="w-full accent-blue-600"
            min="16"
            max="96"
            step="4"
            :aria-label="t('tools.codeScreenshot.paddingLabel')"
          />
        </div>
      </div>
    </section>

    <!-- 实时预览 + 下载 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title flex-1 mb-0">{{ t('tools.codeScreenshot.previewTitle') }}</span>
        <button
          type="button"
          class="btn-primary"
          :disabled="!codeText.trim()"
          @click="downloadPng"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('tools.codeScreenshot.downloadPng') }}
        </button>
      </div>
      <div class="rounded-xl overflow-hidden border border-slate-200 bg-slate-100/60 p-3 flex justify-center">
        <canvas
          ref="canvasRef"
          class="block max-w-full h-auto rounded-md"
          :aria-label="t('tools.codeScreenshot.previewTitle')"
          role="img"
        ></canvas>
      </div>
      <p v-if="renderError" class="text-red-600 text-sm mt-2">{{ renderError }}</p>
    </section>

    <!-- 离屏渲染宿主（不可见，仅用于解析高亮 token） -->
    <div ref="hiddenRef" class="cs-offscreen" aria-hidden="true"></div>
  </ToolPage>
</template>

<style scoped>
.cs-offscreen {
  position: absolute;
  left: -99999px;
  top: 0;
  visibility: hidden;
  white-space: pre;
  font-family: Menlo, Consolas, 'Courier New', monospace;
  font-size: 15px;
  pointer-events: none;
}
</style>

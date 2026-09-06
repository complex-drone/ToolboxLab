<script setup>
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText, downloadCanvasAsPng } from '@/utils/download'

/**
 * Mermaid 图表编辑器
 * - mermaid 按需懒加载（函数内 await import），initialize 只在主题变化时调用
 * - 输入防抖 600ms 渲染；渲染串行令牌防止乱序覆盖；失败保留上次成功结果
 * - 导出：SVG 补 xmlns 直接下载；PNG 经 svg → Image → 离屏 canvas 2x → toDataURL
 */

const { t } = useI18n()
const toast = useToast()

const THEMES = ['default', 'neutral', 'dark', 'forest']

/* ---------- 内置模板（代码为 JS 常量，名称走 i18n） ---------- */

const TEMPLATES = [
  {
    key: 'flowLogin',
    code: [
      'flowchart TD',
      '    A([打开登录页]) --> B[输入账号和密码]',
      '    B --> C[点击登录]',
      '    C --> D{校验通过?}',
      '    D -- 是 --> E[跳转首页]',
      '    D -- 否 --> F[提示错误信息]',
      '    F --> B',
    ].join('\n'),
  },
  {
    key: 'seqRegister',
    code: [
      'sequenceDiagram',
      '    actor U as 用户',
      '    participant F as 前端页面',
      '    participant S as 服务端',
      '    U->>F: 填写注册信息',
      '    F->>S: 提交注册请求',
      '    S->>S: 校验邮箱与密码',
      '    alt 校验通过',
      '        S-->>F: 返回注册成功',
      '        F-->>U: 跳转到登录页',
      '    else 校验失败',
      '        S-->>F: 返回错误原因',
      '        F-->>U: 显示错误提示',
      '    end',
    ].join('\n'),
  },
  {
    key: 'stateOrder',
    code: [
      'stateDiagram-v2',
      '    [*] --> 待支付',
      '    待支付 --> 已支付: 支付成功',
      '    待支付 --> 已取消: 用户取消',
      '    已支付 --> 已发货: 商家发货',
      '    已发货 --> 已完成: 确认收货',
      '    已完成 --> [*]',
      '    已取消 --> [*]',
    ].join('\n'),
  },
  {
    key: 'erShop',
    code: [
      'erDiagram',
      '    USER ||--o{ ORDER : 下单',
      '    ORDER ||--|{ ORDER_ITEM : 包含',
      '    PRODUCT ||--o{ ORDER_ITEM : 被购买',
      '    USER {',
      '        string id 主键',
      '        string name 用户名',
      '    }',
      '    ORDER {',
      '        string id 主键',
      '        datetime created_at 下单时间',
      '    }',
    ].join('\n'),
  },
  {
    key: 'ganttPlan',
    code: [
      'gantt',
      '    title 网站改版排期',
      '    dateFormat YYYY-MM-DD',
      '    section 设计',
      '    需求调研 :a1, 2026-09-01, 5d',
      '    原型设计 :a2, after a1, 4d',
      '    section 开发',
      '    前端开发 :a3, after a2, 8d',
      '    联调测试 :a4, after a3, 5d',
    ].join('\n'),
  },
  {
    key: 'pieShare',
    code: [
      'pie showData title 本月访问来源占比',
      '    "搜索引擎" : 45',
      '    "直接访问" : 25',
      '    "社交媒体" : 18',
      '    "其他渠道" : 12',
    ].join('\n'),
  },
  {
    key: 'classAnimal',
    code: [
      'classDiagram',
      '    class Animal {',
      '        +String name',
      '        +eat()',
      '    }',
      '    class Dog {',
      '        +bark()',
      '    }',
      '    class Cat {',
      '        +meow()',
      '    }',
      '    Animal <|-- Dog',
      '    Animal <|-- Cat',
    ].join('\n'),
  },
]

/* ---------- 状态（主题 + 代码均持久化） ---------- */

const config = useStorage('tool-mermaid-editor-config', {
  theme: 'default',
  code: TEMPLATES[0].code,
})
if (!THEMES.includes(config.value.theme)) config.value.theme = 'default'
if (typeof config.value.code !== 'string' || !config.value.code) {
  config.value.code = TEMPLATES[0].code
}

const svg = ref('')
const renderError = ref('')
const stats = ref({ nodes: 0, lines: 0 })
const exporting = ref(false)

/* ---------- mermaid 懒加载与渲染 ---------- */

let mermaidRef = null
let appliedTheme = ''
let renderSeq = 0

async function ensureMermaid() {
  if (!mermaidRef) {
    mermaidRef = (await import('mermaid')).default
  }
  const theme = THEMES.includes(config.value.theme) ? config.value.theme : 'default'
  if (appliedTheme !== theme) {
    mermaidRef.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      suppressErrorRendering: true,
    })
    appliedTheme = theme
  }
  return mermaidRef
}

/** 从报错信息中剥离 HTML，提取前几行可读文本 */
function extractError(err) {
  let msg = err && err.message ? String(err.message) : typeof err === 'string' ? err : ''
  if (!msg) return t('tools.mermaidEditor.renderError')
  msg = msg
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  const lines = msg
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
  const text = lines.join('\n')
  return text ? text.slice(0, 300) : t('tools.mermaidEditor.renderError')
}

/** 统计：有效行数 + 从渲染结果中取主要图形元素数量作为节点数 */
function computeStats(svgStr, code) {
  const lines = code
    .split('\n')
    .filter((l) => {
      const s = l.trim()
      return s && !s.startsWith('%%')
    }).length
  let nodes = 0
  try {
    const box = document.createElement('div')
    box.innerHTML = svgStr
    const selectors = [
      '.node',
      '.actor',
      '.statediagram-state',
      '.er.entityBox',
      '.classGroup',
      '.task',
      '.pieCircle',
    ]
    for (const sel of selectors) {
      nodes = Math.max(nodes, box.querySelectorAll(sel).length)
    }
  } catch {
    nodes = 0
  }
  return { nodes, lines }
}

async function render() {
  const seq = ++renderSeq
  const code = typeof config.value.code === 'string' ? config.value.code : ''
  try {
    if (!code.trim()) {
      renderError.value = ''
      svg.value = ''
      stats.value = { nodes: 0, lines: 0 }
      return
    }
    const mermaid = await ensureMermaid()
    const result = await mermaid.render('m' + Date.now(), code)
    if (seq !== renderSeq) return // 已有更新的渲染，丢弃本次结果
    renderError.value = ''
    svg.value = result.svg
    stats.value = computeStats(result.svg, code)
  } catch (err) {
    if (seq !== renderSeq) return
    // 渲染失败：显示行内错误，保留上一次成功的 svg
    renderError.value = extractError(err)
  }
}

const renderDebounced = useDebounceFn(render, 600)

watch(
  () => config.value.code,
  () => renderDebounced(),
)
watch(
  () => config.value.theme,
  () => render(),
)

onMounted(() => {
  render()
})

/* ---------- 模板 / 清空 ---------- */

function applyTemplate(tpl) {
  config.value.code = tpl.code
}

function clearEditor() {
  config.value.code = ''
}

/* ---------- 导出 ---------- */

function ensureXmlns(svgStr) {
  if (/<svg[^>]*xmlns=/i.test(svgStr)) return svgStr
  return svgStr.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}

const exportableSvg = () => ensureXmlns(svg.value)

function readSvgSize(el) {
  const vb = (el.getAttribute('viewBox') || '').match(/-?[\d.]+/g)
  let width = vb && vb.length === 4 ? parseFloat(vb[2]) : 0
  let height = vb && vb.length === 4 ? parseFloat(vb[3]) : 0
  if (!width || !height) {
    // 宽高属性可能为 '100%'，仅接受纯数字
    const numAttr = (value) => (value && /^\d+(\.\d+)?$/.test(value) ? parseFloat(value) : 0)
    width = width || numAttr(el.getAttribute('width')) || 800
    height = height || numAttr(el.getAttribute('height')) || 600
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

function exportSvg() {
  if (!svg.value || exporting.value) return
  try {
    exporting.value = true
    downloadText(ensureXmlns(svg.value), 'mermaid-diagram.svg', 'image/svg+xml;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('tools.mermaidEditor.exportFailed'))
  } finally {
    exporting.value = false
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = src
  })
}

async function exportPng() {
  if (!svg.value || exporting.value) return
  exporting.value = true
  try {
    const box = document.createElement('div')
    box.innerHTML = ensureXmlns(svg.value)
    const el = box.querySelector('svg')
    if (!el) throw new Error('invalid svg')
    const size = readSvgSize(el)
    // 先设置明确的宽高属性，避免依赖外部样式
    el.setAttribute('width', String(size.width))
    el.setAttribute('height', String(size.height))
    const xml = new XMLSerializer().serializeToString(el)
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml))
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = size.width * scale
    canvas.height = size.height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    // 暗色主题配深色底，其他主题配白色底，保证导出图片可读
    ctx.fillStyle = config.value.theme === 'dark' ? '#1f2430' : '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    downloadCanvasAsPng(canvas, 'mermaid-diagram.png')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('tools.mermaidEditor.exportFailed'))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <ToolPage tool-id="mermaidEditor">
    <!-- 编辑 + 预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <!-- 内置模板 + 主题 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="section-title mb-0 mr-1">{{ t('tools.mermaidEditor.templates') }}</span>
        <button
          v-for="tpl in TEMPLATES"
          :key="tpl.key"
          type="button"
          class="btn-ghost"
          @click="applyTemplate(tpl)"
        >
          {{ t(`tools.mermaidEditor.templates_${tpl.key}`) }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600">
          <span>{{ t('tools.mermaidEditor.theme') }}</span>
          <select v-model="config.theme" class="input-base w-auto py-1.5 text-sm">
            <option v-for="th in THEMES" :key="th" :value="th">
              {{ t(`tools.mermaidEditor.theme_${th}`) }}
            </option>
          </select>
        </label>
        <template v-if="svg && !renderError">
          <span class="chip">{{ stats.nodes }} {{ t('tools.mermaidEditor.nodes') }}</span>
          <span class="chip">{{ stats.lines }} {{ t('toolsCommon.lines') }}</span>
        </template>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <!-- 左侧编辑器 -->
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.mermaidEditor.editor') }}</span>
            <button type="button" class="btn-danger" @click="clearEditor">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
          <textarea
            v-model="config.code"
            class="input-base w-full font-mono text-[13px] leading-relaxed h-[320px] lg:h-[520px] resize-none"
            :placeholder="t('tools.mermaidEditor.editorPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>

        <!-- 右侧预览 -->
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.mermaidEditor.preview') }}</span>
            <CopyButton
              :text="exportableSvg()"
              :label="t('tools.mermaidEditor.copySvg')"
              :disabled="!svg"
            />
            <button
              type="button"
              class="btn-ghost"
              :disabled="!svg || exporting"
              @click="exportSvg"
            >
              {{ t('tools.mermaidEditor.exportSvg') }}
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!svg || exporting"
              @click="exportPng"
            >
              {{ t('tools.mermaidEditor.exportPng') }}
            </button>
          </div>
          <p
            v-if="renderError"
            class="text-red-600 text-sm whitespace-pre-wrap break-all mb-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2"
          >
            {{ renderError }}
          </p>
          <div
            v-if="svg || !renderError"
            class="h-[320px] lg:h-[520px] overflow-auto rounded-xl border border-slate-200 px-3 py-3 mermaid-preview"
            :class="config.theme === 'dark' ? 'bg-slate-800' : 'bg-white/80'"
            role="region"
            :aria-label="t('tools.mermaidEditor.preview')"
          >
            <!-- 渲染失败时保留并展示上一次成功的结果 -->
            <div v-if="svg" v-html="svg"></div>
            <p v-else class="text-sm text-slate-400 text-center mt-24 px-4">
              {{ t('tools.mermaidEditor.emptyInput') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 说明 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.mermaidEditor.tipsTitle') }}</h2>
      <ul class="text-sm text-slate-500 leading-relaxed list-disc pl-5 space-y-1">
        <li>{{ t('tools.mermaidEditor.tip1') }}</li>
        <li>{{ t('tools.mermaidEditor.tip2') }}</li>
        <li>{{ t('tools.mermaidEditor.tip3') }}</li>
      </ul>
    </section>
  </ToolPage>
</template>

<style scoped>
/* v-html 注入的 svg 不带 scoped 属性，通过父级容器 + :deep() 命中 */
.mermaid-preview :deep(svg) {
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  display: block;
}
</style>

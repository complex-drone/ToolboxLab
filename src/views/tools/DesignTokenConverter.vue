<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'

/**
 * 设计令牌转换器（纯模板引擎）
 * - 输入 W3C 设计令牌 JSON（value/type 与 $value/$type 均兼容），支持任意嵌套分组
 * - 解析为扁平令牌列表（路径 → value/type），缺 value 的令牌行内报错
 * - 四种输出：CSS Variables / SCSS / Android XML / iOS plist；格式选择与输入持久化
 * - 令牌表格预览 + 令牌数统计 + 复制 + 按扩展名下载
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-design-token-converter-config', {
  format: 'css', // 'css' | 'scss' | 'android' | 'ios'
})

const input = ref('')

const FORMATS = ['css', 'scss', 'android', 'ios']
const FORMAT_KEYS = { css: 'formatCss', scss: 'formatScss', android: 'formatAndroid', ios: 'formatIos' }
const DOWNLOAD_META = {
  css: { name: 'design-tokens.css', mime: 'text/css;charset=utf-8' },
  scss: { name: 'design-tokens.scss', mime: 'text/plain;charset=utf-8' },
  android: { name: 'design-tokens.xml', mime: 'application/xml;charset=utf-8' },
  ios: { name: 'design-tokens.plist', mime: 'application/xml;charset=utf-8' },
}

/** 示例：覆盖 color / dimension / string / number / boolean 与嵌套分组 */
const EXAMPLE = JSON.stringify(
  {
    color: {
      primary: { value: '#0055ff', type: 'color' },
      danger: { value: '#e02020', type: 'color' },
    },
    space: {
      medium: { value: '16px', type: 'dimension' },
      large: { value: '24px', type: 'dimension' },
    },
    font: {
      family: { value: 'Inter, sans-serif', type: 'string' },
      sizeBase: { value: 14, type: 'number' },
    },
    dark: { value: false, type: 'boolean' },
  },
  null,
  2
)

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 按值推断类型 */
function inferType(value) {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') {
    return /^#([0-9a-f]{3,8})$/i.test(value) || /^(rgb|hsl)a?\(/i.test(value) ? 'color' : 'string'
  }
  return 'other'
}

/** 递归展平：令牌（含 value）入 tokens，缺 value 的入 errors */
function walk(node, path, tokens, errors) {
  if (node === null || typeof node !== 'object') {
    tokens.push({ path: path.join('.'), value: node, type: inferType(node) })
    return
  }
  if (Array.isArray(node)) {
    tokens.push({ path: path.join('.'), value: node, type: 'other' })
    return
  }
  const hasPlain = Object.prototype.hasOwnProperty.call(node, 'value')
  const hasDollar = Object.prototype.hasOwnProperty.call(node, '$value')
  if (hasPlain || hasDollar) {
    const value = hasPlain ? node.value : node.$value
    const type = String(node.$type || node.type || inferType(value))
    if (value === undefined || value === null) {
      errors.push({ path: path.join('.'), type })
    } else {
      tokens.push({ path: path.join('.'), value, type })
    }
    return
  }
  for (const [key, child] of Object.entries(node)) {
    walk(child, [...path, key], tokens, errors)
  }
}

/** 解析输入：返回令牌、错误行与解析错误 */
const parsed = computed(() => {
  const src = input.value.trim()
  if (!src) return { tokens: [], errors: [], parseError: '' }
  let data
  try {
    data = JSON.parse(src)
  } catch (e) {
    const detail = e && e.message ? e.message : ''
    return { tokens: [], errors: [], parseError: `${t('tools.designTokenConverter.parseError')}：${detail}` }
  }
  const tokens = []
  const errors = []
  try {
    walk(data, [], tokens, errors)
  } catch {
    return { tokens: [], errors: [], parseError: t('tools.designTokenConverter.parseError') }
  }
  return { tokens, errors, parseError: '' }
})

/** 令牌值文本：字符串原样，其余紧凑 JSON */
function valueText(value) {
  return typeof value === 'string' ? value : safeStringify(value)
}

function kebab(segment) {
  return String(segment)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function snake(segment) {
  return kebab(segment).replace(/-/g, '_')
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** CSS Variables：非 color 类型按 type 加注释 */
function toCss(tokens) {
  if (tokens.length === 0) return ''
  const lines = [':root {']
  for (const tok of tokens) {
    const name = `--${tok.path.split('.').map(kebab).join('-')}`
    if (tok.type !== 'color') lines.push(`  /* ${tok.type} */`)
    lines.push(`  ${name}: ${valueText(tok.value)};`)
  }
  lines.push('}')
  return lines.join('\n')
}

/** SCSS 变量 */
function toScss(tokens) {
  return tokens
    .map(tok => `$${tok.path.split('.').map(kebab).join('-')}: ${valueText(tok.value)};`)
    .join('\n')
}

/** Android XML 资源：color 与 string 用专用标签，其余类型注释说明后按 string 资源输出 */
function toAndroid(tokens) {
  if (tokens.length === 0) return ''
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>']
  for (const tok of tokens) {
    const name = tok.path.split('.').map(snake).join('_')
    const value = escapeXml(valueText(tok.value))
    if (tok.type === 'color') {
      lines.push(`  <color name="${name}">${value}</color>`)
    } else if (tok.type === 'string') {
      lines.push(`  <string name="${name}">${value}</string>`)
    } else {
      lines.push(`  <!-- ${escapeXml(tok.type)} -->`)
      lines.push(`  <item name="${name}" type="string">${value}</item>`)
    }
  }
  lines.push('</resources>')
  return lines.join('\n')
}

/** iOS plist 片段：键为空格连接的路径，值按类型选用标签 */
function toIos(tokens) {
  const lines = []
  for (const tok of tokens) {
    const key = escapeXml(tok.path.split('.').join(' '))
    const value = tok.value
    lines.push(`<key>${key}</key>`)
    if (typeof value === 'string') {
      lines.push(`<string>${escapeXml(value)}</string>`)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      lines.push(Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`)
    } else if (typeof value === 'boolean') {
      lines.push(value ? '<true/>' : '<false/>')
    } else {
      lines.push(`<string>${escapeXml(safeStringify(value))}</string>`)
    }
  }
  return lines.join('\n')
}

const output = computed(() => {
  if (parsed.value.parseError) return ''
  const tokens = parsed.value.tokens
  switch (config.value.format) {
    case 'scss':
      return toScss(tokens)
    case 'android':
      return toAndroid(tokens)
    case 'ios':
      return toIos(tokens)
    default:
      return toCss(tokens)
  }
})

function loadExample() {
  input.value = EXAMPLE
}

function clearAll() {
  input.value = ''
}

function downloadOutput() {
  try {
    const meta = DOWNLOAD_META[config.value.format] || DOWNLOAD_META.css
    downloadText(output.value, meta.name, meta.mime)
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="designTokenConverter">
    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="dt-input" class="label-base">{{ t('tools.designTokenConverter.inputLabel') }}</label>
      <textarea
        id="dt-input"
        v-model="input"
        class="input-base w-full font-mono h-56 resize-y"
        :placeholder="t('tools.designTokenConverter.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="parsed.parseError" class="text-red-600 text-sm mt-3 break-all">{{ parsed.parseError }}</p>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 令牌预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="section-title mb-0 flex-1">{{ t('toolsCommon.preview') }}</h2>
        <span class="chip">
          {{ t('tools.designTokenConverter.tokensLabel') }} {{ parsed.tokens.length }}
        </span>
        <span v-if="parsed.errors.length > 0" class="chip bg-red-50 text-red-600 border-red-100">
          {{ t('tools.designTokenConverter.errorLabel') }} {{ parsed.errors.length }}
        </span>
      </div>

      <p v-if="parsed.tokens.length === 0 && parsed.errors.length === 0" class="text-sm text-slate-400">
        {{ t('toolsCommon.none') }}
      </p>

      <!-- 桌面表格 -->
      <div v-else class="hidden md:block overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="text-left text-xs text-slate-400 border-b border-slate-200">
              <th class="py-2 pr-3 font-medium">{{ t('tools.designTokenConverter.colPath') }}</th>
              <th class="py-2 pr-3 font-medium">{{ t('tools.designTokenConverter.colType') }}</th>
              <th class="py-2 font-medium">{{ t('tools.designTokenConverter.colValue') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tok in parsed.tokens" :key="tok.path" class="border-b border-slate-100">
              <td class="py-2 pr-3 font-mono text-xs text-blue-600 break-all">{{ tok.path }}</td>
              <td class="py-2 pr-3"><span class="chip">{{ tok.type }}</span></td>
              <td class="py-2 font-mono text-xs text-slate-600 break-all">{{ valueText(tok.value) }}</td>
            </tr>
            <tr v-for="err in parsed.errors" :key="`err-${err.path}`" class="border-b border-slate-100 bg-red-50/60">
              <td class="py-2 pr-3 font-mono text-xs text-red-600 break-all">{{ err.path }}</td>
              <td class="py-2 pr-3"><span class="chip bg-red-50 text-red-600 border-red-100">{{ err.type }}</span></td>
              <td class="py-2 text-xs text-red-600">{{ t('tools.designTokenConverter.missingValue') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动端卡片 -->
      <div v-if="parsed.tokens.length > 0 || parsed.errors.length > 0" class="md:hidden space-y-2">
        <div v-for="tok in parsed.tokens" :key="tok.path" class="rounded-xl border border-slate-200 bg-white/70 p-3">
          <p class="font-mono text-xs text-blue-600 break-all">{{ tok.path }}</p>
          <p class="mt-1"><span class="chip">{{ tok.type }}</span></p>
          <p class="font-mono text-xs text-slate-600 break-all mt-1">{{ valueText(tok.value) }}</p>
        </div>
        <div v-for="err in parsed.errors" :key="`m-err-${err.path}`" class="rounded-xl border border-red-200 bg-red-50 p-3">
          <p class="font-mono text-xs text-red-600 break-all">{{ err.path }}</p>
          <p class="mt-1"><span class="chip bg-red-50 text-red-600 border-red-100">{{ err.type }}</span></p>
          <p class="text-xs text-red-600 mt-1">{{ t('tools.designTokenConverter.missingValue') }}</p>
        </div>
      </div>
    </section>

    <!-- 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.output') }}</h2>
      <div class="flex flex-wrap gap-2 mb-3">
        <button
          v-for="f in FORMATS"
          :key="f"
          type="button"
          :class="config.format === f ? 'btn-primary' : 'btn-ghost'"
          @click="config.format = f"
        >
          {{ t(`tools.designTokenConverter.${FORMAT_KEYS[f]}`) }}
        </button>
      </div>
      <textarea
        id="dt-output"
        :value="output"
        readonly
        class="input-base w-full font-mono h-72 resize-y bg-slate-50/80"
        :aria-label="t('toolsCommon.output')"
        :placeholder="t('tools.designTokenConverter.outputPlaceholder')"
      ></textarea>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
        <button type="button" class="btn-ghost" :disabled="!output" @click="downloadOutput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('toolsCommon.download') }}
        </button>
      </div>
      <p class="mt-3 text-xs text-slate-400">{{ t('tools.designTokenConverter.hint') }}</p>
    </section>
  </ToolPage>
</template>

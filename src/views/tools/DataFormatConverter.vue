<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * JSON / YAML / XML 互转
 * - JSON: JSON.parse / JSON.stringify
 * - YAML: js-yaml load / dump
 * - XML: 浏览器原生 DOMParser 解析 + 自实现序列化（替代 xml-js，消除其 Node stream 依赖）
 * - 相同格式 = 格式化；转换失败在行内展示原始错误信息
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-data-format-converter-config', {
  from: 'json', // 'json' | 'yaml' | 'xml'
  to: 'yaml',
})

const input = ref('')
const output = ref('')
const errorMsg = ref('')
const converting = ref(false)

const isSameFormat = computed(() => config.value.from === config.value.to)

/** 各输入格式的示例数据 */
const EXAMPLES = {
  json: JSON.stringify(
    {
      name: 'ToolboxLab',
      version: 1,
      tags: ['fast', 'offline'],
      owner: { name: 'Alice', admin: true },
      scores: [98, 76.5],
    },
    null,
    2
  ),
  yaml:
    'name: ToolboxLab\nversion: 1\ntags:\n  - fast\n  - offline\nowner:\n  name: Alice\n  admin: true\nscores:\n  - 98\n  - 76.5\n',
  xml:
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<site>\n  <name>ToolboxLab</name>\n  <version>1</version>\n' +
    '  <tags>\n    <tag>fast</tag>\n    <tag>offline</tag>\n  </tags>\n' +
    '  <owner>\n    <name>Alice</name>\n    <admin>true</admin>\n  </owner>\n' +
    '</site>\n',
}

/** XML 转义：文本（属性额外转义引号） */
function escapeXmlText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlAttr(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** DOM 元素节点 → 中间元素树（type/name/attributes/elements，供 elementToValue 消费） */
function domToXmlNode(el) {
  const node = { type: 'element', name: el.nodeName, elements: [] }
  if (el.attributes && el.attributes.length > 0) {
    const attributes = {}
    for (const attr of Array.from(el.attributes)) attributes[attr.name] = attr.value
    node.attributes = attributes
  }
  // 单次遍历保持混合内容顺序；纯空白的缩进文本跳过（避免产生 _text: '' 噪声）
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      node.elements.push(domToXmlNode(child))
      continue
    }
    // 文本(3)与 CDATA(4) 视为文本
    const isText = child.nodeType === 3 || child.nodeType === 4
    if (!isText) continue
    const text = child.nodeValue == null ? '' : child.nodeValue.trim()
    if (text) node.elements.push({ type: 'text', text })
  }
  return node
}

/** 浏览器原生 XML 解析：返回根元素的中间节点树 */
function parseXmlRoot(src) {
  const doc = new DOMParser().parseFromString(src, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(t('toolsCommon.invalidInput'))
  }
  const root = doc.documentElement
  if (!root || root.nodeName === 'parsererror') throw new Error(t('tools.dataFormatConverter.noRoot'))
  return domToXmlNode(root)
}

/** 把中间元素树整理为贴近 JSON 的普通对象/原始值 */
function elementToValue(node) {
  const out = {}
  if (node.attributes && Object.keys(node.attributes).length > 0) {
    out._attributes = { ...node.attributes }
  }
  const children = Array.isArray(node.elements)
    ? node.elements
    : node.elements
      ? [node.elements]
      : []
  const textParts = children.filter(c => c.type === 'text').map(c => String(c.text == null ? '' : c.text))
  const elemChildren = children.filter(c => c.type === 'element')

  if (elemChildren.length === 0) {
    if (textParts.length > 0) {
      const text = textParts.join('')
      return Object.keys(out).length > 0 ? { ...out, _text: text } : text
    }
    return Object.keys(out).length > 0 ? out : null
  }
  if (textParts.length > 0) out._text = textParts.join('')
  for (const child of elemChildren) {
    const value = elementToValue(child)
    if (Object.prototype.hasOwnProperty.call(out, child.name)) {
      if (!Array.isArray(out[child.name])) out[child.name] = [out[child.name]]
      out[child.name].push(value)
    } else {
      out[child.name] = value
    }
  }
  return out
}

async function parseInput(src, format) {
  if (format === 'json') {
    return JSON.parse(src)
  }
  if (format === 'yaml') {
    const yaml = await import('js-yaml')
    const data = yaml.load(src)
    if (data === undefined) throw new Error(t('toolsCommon.invalidInput'))
    return data
  }
  // xml
  const root = parseXmlRoot(src)
  return { [root.name]: elementToValue(root) }
}

/** 把普通对象/数组/原始值转换为中间 XML 元素节点（type/name/attributes/elements） */
function toXmlElement(name, value) {
  if (value === null || value === undefined) {
    return { type: 'element', name, elements: [] }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const attributes = {}
    const childEls = []
    let textValue = null
    for (const [key, val] of Object.entries(value)) {
      if (key === '_attributes' && val && typeof val === 'object' && !Array.isArray(val)) {
        Object.assign(attributes, val)
      } else if (key === '_text') {
        textValue = val
      } else if (Array.isArray(val)) {
        for (const item of val) childEls.push(toXmlElement(key, item))
      } else {
        childEls.push(toXmlElement(key, val))
      }
    }
    const el = { type: 'element', name }
    if (Object.keys(attributes).length > 0) el.attributes = attributes
    const elements = []
    if (textValue !== null && textValue !== undefined) {
      elements.push({ type: 'text', text: String(textValue) })
    }
    elements.push(...childEls)
    el.elements = elements
    return el
  }
  return { type: 'element', name, elements: [{ type: 'text', text: String(value) }] }
}

/** 选择 XML 根元素：对象仅含一个业务键时以该键为根，否则包一层 root */
function buildXmlRoot(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const elemKeys = Object.keys(data).filter(k => k !== '_attributes' && k !== '_text')
    if (elemKeys.length === 1) {
      const el = toXmlElement(elemKeys[0], data[elemKeys[0]])
      if (data._attributes && typeof data._attributes === 'object') {
        el.attributes = { ...data._attributes, ...(el.attributes || {}) }
      }
      return el
    }
  }
  if (Array.isArray(data)) {
    return { type: 'element', name: 'root', elements: data.map(item => toXmlElement('item', item)) }
  }
  return toXmlElement('root', data)
}

/** 中间元素树 → 缩进 XML 字符串（对齐 js2xml spaces 风格：纯文本内联、子元素换行缩进） */
function renderXmlNode(node, depth, spaces) {
  const pad = ' '.repeat(spaces * depth)
  const attrs = node.attributes
    ? Object.entries(node.attributes).map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`).join('')
    : ''
  const children = Array.isArray(node.elements) ? node.elements : []
  if (children.length === 0) return `${pad}<${node.name}${attrs}/>`
  if (children.every(c => c.type === 'text')) {
    return `${pad}<${node.name}${attrs}>${children.map(c => escapeXmlText(c.text)).join('')}</${node.name}>`
  }
  const inner = children
    .map(c => (c.type === 'text' ? escapeXmlText(c.text) : '\n' + renderXmlNode(c, depth + 1, spaces)))
    .join('')
  return `${pad}<${node.name}${attrs}>${inner}\n${pad}</${node.name}>`
}

async function serialize(data, format) {
  if (format === 'json') {
    return JSON.stringify(data, null, 2)
  }
  if (format === 'yaml') {
    const yaml = await import('js-yaml')
    return yaml.dump(data, { indent: 2, skipInvalid: true, lineWidth: -1 })
  }
  return renderXmlNode(buildXmlRoot(data), 0, 2)
}

async function convert() {
  errorMsg.value = ''
  if (!input.value.trim()) {
    errorMsg.value = t('tools.dataFormatConverter.emptyInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  converting.value = true
  try {
    const data = await parseInput(input.value, config.value.from)
    output.value = await serialize(data, config.value.to)
    toast.success(t('tools.dataFormatConverter.converted'))
  } catch (e) {
    output.value = ''
    errorMsg.value = e && e.message ? e.message : t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    converting.value = false
  }
}

function swapFormats() {
  const tmpFrom = config.value.from
  config.value.from = config.value.to
  config.value.to = tmpFrom
  const tmpInput = input.value
  input.value = output.value
  output.value = tmpInput
  errorMsg.value = ''
}

function clearInput() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
}

function loadExample() {
  input.value = EXAMPLES[config.value.from] || ''
  errorMsg.value = ''
}
</script>

<template>
  <ToolPage tool-id="dataFormatConverter">
    <!-- 格式选择与转换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="converter-from" class="label-base">{{ t('tools.dataFormatConverter.inputFormat') }}</label>
          <select id="converter-from" v-model="config.from" class="input-base">
            <option value="json">{{ t('tools.dataFormatConverter.json') }}</option>
            <option value="yaml">{{ t('tools.dataFormatConverter.yaml') }}</option>
            <option value="xml">{{ t('tools.dataFormatConverter.xml') }}</option>
          </select>
        </div>
        <div>
          <label for="converter-to" class="label-base">{{ t('tools.dataFormatConverter.outputFormat') }}</label>
          <select id="converter-to" v-model="config.to" class="input-base">
            <option value="json">{{ t('tools.dataFormatConverter.json') }}</option>
            <option value="yaml">{{ t('tools.dataFormatConverter.yaml') }}</option>
            <option value="xml">{{ t('tools.dataFormatConverter.xml') }}</option>
          </select>
        </div>
      </div>

      <p v-if="isSameFormat" class="mt-3 text-xs text-slate-400">
        {{ t('tools.dataFormatConverter.sameFormatHint') }}
      </p>

      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" class="btn-primary" :disabled="converting" @click="convert">
          {{ converting ? t('toolsCommon.processing') : t('toolsCommon.convert') }}
        </button>
        <button type="button" class="btn-ghost" @click="swapFormats">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {{ t('toolsCommon.swap') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 输入 / 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="converter-input" class="label-base">
            {{ t('toolsCommon.input') }}（{{ t(`tools.dataFormatConverter.${config.from}`) }}）
          </label>
          <textarea
            id="converter-input"
            v-model="input"
            class="input-base w-full font-mono h-64 resize-y"
            :placeholder="t('tools.dataFormatConverter.inputPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <label for="converter-output" class="label-base flex-1 mb-1.5">
              {{ t('toolsCommon.output') }}（{{ t(`tools.dataFormatConverter.${config.to}`) }}）
            </label>
            <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
          </div>
          <textarea
            id="converter-output"
            :value="output"
            readonly
            class="input-base w-full font-mono h-64 resize-y bg-slate-50/80"
            :aria-label="t('toolsCommon.output')"
            :placeholder="t('tools.dataFormatConverter.outputPlaceholder')"
          ></textarea>
        </div>
      </div>

      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
      <p class="mt-3 text-xs text-slate-400">{{ t('tools.dataFormatConverter.xmlConvention') }}</p>
    </section>
  </ToolPage>
</template>

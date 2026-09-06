<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * JSON 转 Go Struct
 * - 300ms 防抖实时转换；字段名 snake/kebab/camel 统一转大驼峰，json tag 保留原始键名
 * - 类型推断：string/int64(超安全范围转 float64 并提示)/float64/bool/嵌套 struct/[]T/null => interface{}
 * - 嵌套对象：独立命名 struct（同名同形状复用合并）或内联匿名 struct（开关二选一）
 * - omitempty 可选；一键复制 + 下载 .go 文件
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-json-to-go-config', {
  nestedStyle: 'named', // 'named' | 'inline'
  omitempty: false,
})

const input = ref('')
const output = ref('')
const errorMsg = ref('')
const bigIntPaths = ref([])

const EXAMPLE_JSON = [
  '{',
  '  "id": 1001,',
  '  "user_name": "Alice",',
  '  "is-admin": true,',
  '  "avatarUrl": null,',
  '  "balance": 123.45,',
  '  "big_number": 12345678901234567890,',
  '  "profile": {',
  '    "real_name": "Alice Zhang",',
  '    "age": 25,',
  '    "tags": ["vip", "active"],',
  '    "address": { "city": "Hangzhou", "zip": "310000" }',
  '  },',
  '  "orders": [',
  '    { "order_id": 9001, "amount": 99.9, "paid": true },',
  '    { "order_id": 9002, "amount": 59.5, "paid": false }',
  '  ],',
  '  "empty_list": []',
  '}',
].join('\n')

/** 键名转大驼峰：user_name / user-name / userName => UserName */
function toPascal(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9]+/g, ' ').trim()
  if (!cleaned) return ''
  const words = cleaned.split(/\s+/)
  const parts = []
  for (const w of words) {
    const subs = w
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/)
    for (const s of subs) {
      if (s) parts.push(s.charAt(0).toUpperCase() + s.slice(1))
    }
  }
  return parts.join('')
}

/** 结构体字段名（大驼峰，结构体内去重，非法名回退 Field） */
function toGoFieldName(key, used) {
  let name = toPascal(key)
  if (!name || /^[0-9]/.test(name)) name = 'Field' + (name ? '_' + name.replace(/^[0-9]+/, '') : '')
  let final = name
  let n = 2
  while (used.has(final)) {
    final = name + String(n)
    n++
  }
  used.add(final)
  return final
}

/** 数组元素结构体建议名：Items => Item，无法复数还原则加 Item 后缀 */
function singularize(pascal) {
  if (/ies$/.test(pascal)) return pascal.slice(0, -3) + 'y'
  if (/(ch|sh|s|x|z)es$/.test(pascal)) return pascal.slice(0, -2)
  if (/s$/.test(pascal) && !/ss$/.test(pascal)) return pascal.slice(0, -1)
  return pascal + 'Item'
}

/** json tag：保留原始键名，可选 omitempty */
function buildTag(key, omitempty) {
  const escaped = String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return '`json:"' + escaped + (omitempty ? ',omitempty' : '') + '"`'
}

/** 形状签名：相同结构的对象合并复用同一个 struct 名 */
function shapeSignature(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const sigs = []
    for (const v of value) {
      const s = shapeSignature(v)
      if (!sigs.includes(s)) sigs.push(s)
    }
    return '[' + (sigs.length === 1 ? sigs[0] : 'any') + ']'
  }
  if (typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .map(k => k + ':' + shapeSignature(value[k]))
        .join(',') +
      '}'
    )
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? (Number.isSafeInteger(value) ? 'int' : 'float') : 'float'
  }
  return typeof value
}

/** 一次转换的上下文：struct 注册表、名称池、大整数警告 */
function createContext(omitempty, nestedStyle) {
  return {
    omitempty,
    nestedStyle,
    structs: [], // { name, fields: [{ goName, typeText, tag }] }
    sigToName: new Map(),
    usedNames: new Set(),
    bigInts: [],
  }
}

/** 独立命名模式：为对象注册（或复用）一个命名 struct，返回类型名 */
function registerStruct(ctx, obj, suggestedName) {
  const sig = shapeSignature(obj)
  if (ctx.sigToName.has(sig)) return ctx.sigToName.get(sig)
  let name = suggestedName && !/^[0-9]/.test(suggestedName) ? suggestedName : 'Struct'
  if (!name || ctx.usedNames.has(name)) {
    let n = 2
    while (ctx.usedNames.has(name + String(n))) n++
    name = name + String(n)
  }
  ctx.usedNames.add(name)
  ctx.sigToName.set(sig, name)

  const fields = []
  const used = new Set()
  for (const key of Object.keys(obj)) {
    const goName = toGoFieldName(key, used)
    const typeText = goTypeNamed(ctx, obj[key], toPascal(key) || name, '.' + key)
    fields.push({ goName, typeText, tag: buildTag(key, ctx.omitempty) })
  }
  ctx.structs.push({ name, fields })
  return name
}

/** 独立命名模式类型推断 */
function goTypeNamed(ctx, value, suggestedName, path) {
  if (value === null) return 'interface{}'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]interface{}'
    const elemTypes = []
    // 元素为对象时做单数化命名（Orders 元素 => Order）；元素仍为数组则沿用原名，避免 ItemItem
    const elemSuggested = Array.isArray(value[0]) ? suggestedName : singularize(suggestedName)
    for (let i = 0; i < value.length; i++) {
      const et = goTypeNamed(ctx, value[i], elemSuggested, path + '[' + i + ']')
      if (!elemTypes.includes(et)) elemTypes.push(et)
    }
    return elemTypes.length === 1 ? '[]' + elemTypes[0] : '[]interface{}'
  }
  if (typeof value === 'object') {
    return registerStruct(ctx, value, toPascal(suggestedName) || 'Struct')
  }
  return primitiveGoType(ctx, value, path)
}

/** 内联匿名 struct 模式：返回类型文本（可能多行） */
function inlineStructText(ctx, obj, level, path) {
  const used = new Set()
  const rows = []
  for (const key of Object.keys(obj)) {
    const goName = toGoFieldName(key, used)
    const typeText = goTypeInline(ctx, obj[key], toPascal(key) || 'Field', level + 1, path + '.' + key)
    rows.push('\t'.repeat(level + 1) + goName + ' ' + typeText + ' ' + buildTag(key, ctx.omitempty))
  }
  if (rows.length === 0) return 'struct{}'
  return 'struct {\n' + rows.join('\n') + '\n' + '\t'.repeat(level) + '}'
}

function goTypeInline(ctx, value, suggestedName, level, path) {
  if (value === null) return 'interface{}'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]interface{}'
    const elemTexts = []
    for (let i = 0; i < value.length; i++) {
      elemTexts.push(goTypeInline(ctx, value[i], singularize(suggestedName), level, path + '[' + i + ']'))
    }
    const uniq = [...new Set(elemTexts)]
    return uniq.length === 1 ? '[]' + uniq[0] : '[]interface{}'
  }
  if (typeof value === 'object') {
    return inlineStructText(ctx, value, level, path)
  }
  return primitiveGoType(ctx, value, path)
}

/** 基础标量类型推断（含大整数警告） */
function primitiveGoType(ctx, value, path) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'float64'
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        ctx.bigInts.push(path)
        return 'float64'
      }
      return 'int64'
    }
    return 'float64'
  }
  if (typeof value === 'boolean') return 'bool'
  return 'string'
}

/** 命名 struct 声明代码（字段与 tag 对齐） */
function structDecl(decl) {
  if (decl.fields.length === 0) {
    return 'type ' + decl.name + ' struct{}'
  }
  const maxName = Math.max(...decl.fields.map(f => f.goName.length))
  const maxType = Math.max(...decl.fields.map(f => f.typeText.length))
  const lines = ['type ' + decl.name + ' struct {']
  for (const f of decl.fields) {
    lines.push(
      '\t' +
        f.goName +
        ' '.repeat(maxName - f.goName.length + 1) +
        f.typeText +
        ' '.repeat(maxType - f.typeText.length + 1) +
        f.tag
    )
  }
  lines.push('}')
  return lines.join('\n')
}

/** 执行转换（输入已 parse 失败则行内报错，含位置） */
function convert() {
  errorMsg.value = ''
  output.value = ''
  bigIntPaths.value = []
  const text = input.value
  if (!text.trim()) return
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    errorMsg.value = t('tools.jsonToGo.parseFailed') + describeJsonPos(e, text)
    return
  }
  try {
    const ctx = createContext(config.value.omitempty, config.value.nestedStyle)
    let code
    if (ctx.nestedStyle === 'inline') {
      code = buildInlineRoot(ctx, data)
    } else {
      code = buildNamedRoot(ctx, data)
    }
    if (ctx.bigInts.length) {
      bigIntPaths.value = [...new Set(ctx.bigInts)]
    }
    output.value = code
  } catch (e) {
    errorMsg.value = e && e.message ? e.message : t('toolsCommon.error')
  }
}

/** 命名模式根部：对象/数组/标量分别处理 */
function buildNamedRoot(ctx, data) {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const rootName = registerStruct(ctx, data, 'Root')
    const decls = []
    const root = ctx.structs.find(s => s.name === rootName)
    if (root) {
      decls.push(structDecl(root))
    }
    for (const s of ctx.structs) {
      if (s !== root) decls.push(structDecl(s))
    }
    return decls.join('\n\n')
  }
  // 数组或标量根：type Root = 元素类型
  const rootType = goTypeNamed(ctx, data, 'Root', '')
  return 'type Root ' + rootType + (ctx.structs.length ? '\n\n' + ctx.structs.map(structDecl).join('\n\n') : '')
}

/** 内联模式根部 */
function buildInlineRoot(ctx, data) {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return 'type Root ' + inlineStructText(ctx, data, 0, '')
  }
  if (Array.isArray(data)) {
    return 'type Root ' + goTypeInline(ctx, data, 'Root', 0, '')
  }
  return 'type Root ' + goTypeInline(ctx, data, 'Root', 0, '')
}

/** 从 JSON.parse 错误信息中提取位置（第 X 行 第 Y 列） */
function describeJsonPos(e, text) {
  const raw = e && e.message ? '：' + e.message : ''
  try {
    const msg = e && e.message ? e.message : ''
    const m = /position\s+(\d+)/i.exec(msg)
    if (m) {
      const pos = Number(m[1])
      const before = text.slice(0, Math.min(pos, text.length))
      const line = before.split('\n').length
      const col = pos - (before.lastIndexOf('\n') + 1) + 1
      return (
        raw +
        '（' +
        t('tools.jsonToGo.positionHint').replace('%1', String(line)).replace('%2', String(col)) +
        '）'
      )
    }
    // Firefox 风格：line X column Y
    const m2 = /\bline\s+(\d+)\D+column\s+(\d+)/i.exec(msg)
    if (m2) {
      return (
        raw +
        '（' +
        t('tools.jsonToGo.positionHint').replace('%1', m2[1]).replace('%2', m2[2]) +
        '）'
      )
    }
    return raw
  } catch {
    return raw
  }
}

// 输入与选项变化时 300ms 防抖实时转换
watchDebounced([input, config], convert, { debounce: 300 })

function loadExample() {
  input.value = EXAMPLE_JSON
  errorMsg.value = ''
}

function clearInput() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
  bigIntPaths.value = []
}

function downloadGo() {
  try {
    const m = /^type\s+([A-Za-z0-9_]+)/.exec(output.value)
    const filename = (m ? m[1] : 'root').toLowerCase() + '.go'
    downloadText(output.value, filename, 'text/plain;charset=utf-8')
    toast.success(t('toolsCommon.download') + ' - ' + filename)
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

const hasOutput = computed(() => output.value.length > 0)
</script>

<template>
  <ToolPage tool-id="jsonToGo">
    <!-- 选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="jsontogo-style" class="label-base">{{ t('tools.jsonToGo.nestedStyle') }}</label>
          <select id="jsontogo-style" v-model="config.nestedStyle" class="input-base">
            <option value="named">{{ t('tools.jsonToGo.styleNamed') }}</option>
            <option value="inline">{{ t('tools.jsonToGo.styleInline') }}</option>
          </select>
        </div>
        <div class="flex items-end">
          <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none pb-2">
            <input v-model="config.omitempty" type="checkbox" class="w-4 h-4 accent-blue-600" />
            {{ t('tools.jsonToGo.omitempty') }}
          </label>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-4">
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
          <label for="jsontogo-input" class="label-base">{{ t('toolsCommon.input') }} (JSON)</label>
          <textarea
            id="jsontogo-input"
            v-model="input"
            class="input-base w-full font-mono h-80 resize-y"
            :placeholder="t('tools.jsonToGo.inputPlaceholder')"
            spellcheck="false"
          ></textarea>
          <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('toolsCommon.output') }} (Go)</span>
            <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!hasOutput" />
            <button type="button" class="btn-ghost" :disabled="!hasOutput" @click="downloadGo">
              {{ t('toolsCommon.download') }} .go
            </button>
          </div>
          <pre
            class="font-mono text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-auto h-80 text-slate-700"
          >{{ output || t('toolsCommon.none') }}</pre>
          <p v-if="bigIntPaths.length" class="text-amber-600 text-xs mt-3 break-all">
            {{ t('tools.jsonToGo.bigIntHint') }}
            {{ bigIntPaths.join(', ') }}
          </p>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

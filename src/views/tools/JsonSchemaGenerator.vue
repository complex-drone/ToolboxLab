<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'

/**
 * JSON Schema 生成器
 * - 输入防抖 400ms 自动解析 JSON 实例
 * - 递归推断类型生成 Draft-07 Schema（object/array/string/number/integer/boolean/null）
 * - array：各元素分别推断后去重合并，仅一种取单 schema，多种用 anyOf
 * - 选项：全属性必填、additionalProperties:false、标题前缀（均持久化）
 * - 顶层描述 + 属性描述（点号路径）合并进 Schema
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-json-schema-generator-config', {
  allRequired: true,
  forbidAdditional: false,
  titlePrefix: '',
  rootDescription: '',
  propDescText: '',
})

const input = ref('')
const output = ref('')
const errorMsg = ref('')

/** 示例数据：覆盖各类型与嵌套结构 */
const EXAMPLE = JSON.stringify(
  {
    id: 42,
    name: 'ToolboxLab',
    price: 9.9,
    active: true,
    tags: ['fast', 'offline'],
    owner: { name: 'Alice', admin: true, score: 98 },
    meta: null,
    members: [
      { id: 1, nickname: 'A' },
      { id: 2, nickname: 'B' },
    ],
  },
  null,
  2
)

/** 递归推断单个值的 Schema */
function inferSchema(value) {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) {
    const schema = { type: 'array' }
    if (value.length === 0) {
      schema.items = {}
      return schema
    }
    schema.items = mergeItemSchemas(value.slice(0, 50).map(v => inferSchema(v)))
    return schema
  }
  if (typeof value === 'object') {
    const properties = {}
    for (const [key, val] of Object.entries(value)) {
      properties[key] = inferSchema(val)
    }
    const schema = { type: 'object', properties }
    if (config.value.allRequired) {
      const required = Object.keys(value)
      if (required.length > 0) schema.required = required
    }
    if (config.value.forbidAdditional) schema.additionalProperties = false
    return schema
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
  }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

/** 合并数组元素推断结果：唯一则取单个，否则 anyOf */
function mergeItemSchemas(schemas) {
  const seen = new Map()
  for (const s of schemas) {
    const key = JSON.stringify(s)
    if (!seen.has(key)) seen.set(key, s)
  }
  const unique = Array.from(seen.values())
  if (unique.length === 1) return unique[0]
  return { anyOf: unique }
}

/** 按点号路径定位 Schema 节点，[] 表示进入数组 items */
function resolveSchemaNode(schema, path) {
  let node = schema
  for (const seg of path.split('.').map(s => s.trim()).filter(Boolean)) {
    if (!node || typeof node !== 'object') return null
    if (seg === '[]') {
      node = node.items
      continue
    }
    if (node.properties && Object.prototype.hasOwnProperty.call(node.properties, seg)) {
      node = node.properties[seg]
    } else {
      return null
    }
  }
  return node
}

/** 把「顶层描述」与「属性描述」合并进 Schema */
function applyDescriptions(schema) {
  const prefix = config.value.titlePrefix.trim()
  if (prefix) schema.title = prefix
  const desc = config.value.rootDescription.trim()
  if (desc) schema.description = desc
  for (const rawLine of config.value.propDescText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const sepIndex = line.search(/[=:：]/)
    if (sepIndex < 0) continue
    const path = line.slice(0, sepIndex).trim()
    const text = line.slice(sepIndex + 1).trim()
    if (!path || !text) continue
    const node = resolveSchemaNode(schema, path)
    if (node && typeof node === 'object') node.description = text
  }
  return schema
}

function buildSchema() {
  const data = JSON.parse(input.value)
  return applyDescriptions(inferSchema(data))
}

/** 生成 Schema；manual 为 true 时给出 Toast 反馈 */
function generate(manual) {
  errorMsg.value = ''
  if (!input.value.trim()) {
    output.value = ''
    return
  }
  try {
    output.value = JSON.stringify(buildSchema(), null, 2)
    if (manual) toast.success(t('tools.jsonSchemaGenerator.generated'))
  } catch (e) {
    output.value = ''
    const detail = e && e.message ? `（${e.message}）` : ''
    errorMsg.value = t('tools.jsonSchemaGenerator.parseError') + detail
    if (manual) toast.error(t('toolsCommon.invalidInput'))
  }
}

// 输入防抖 400ms 自动生成；选项变化也触发重新生成
watchDebounced(input, () => generate(false), { debounce: 400 })
watchDebounced(config, () => generate(false), { debounce: 200, deep: true })

function loadExample() {
  input.value = EXAMPLE
  errorMsg.value = ''
}

function clearAll() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
}

function downloadSchema() {
  try {
    downloadText(output.value, 'schema.schema.json', 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="jsonSchemaGenerator">
    <!-- 选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.options') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input v-model="config.allRequired" type="checkbox" class="w-4 h-4 accent-blue-600" />
          <span>{{ t('tools.jsonSchemaGenerator.optionAllRequired') }}</span>
        </label>
        <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input v-model="config.forbidAdditional" type="checkbox" class="w-4 h-4 accent-blue-600" />
          <span>{{ t('tools.jsonSchemaGenerator.optionAdditional') }}</span>
        </label>
      </div>
      <div class="mt-3">
        <label for="jschema-prefix" class="label-base">{{ t('tools.jsonSchemaGenerator.optionTitlePrefix') }}</label>
        <input
          id="jschema-prefix"
          v-model="config.titlePrefix"
          type="text"
          class="input-base"
          :placeholder="t('tools.jsonSchemaGenerator.titlePrefixPlaceholder')"
        />
      </div>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="jschema-input" class="label-base">{{ t('tools.jsonSchemaGenerator.inputLabel') }}</label>
      <textarea
        id="jschema-input"
        v-model="input"
        class="input-base w-full font-mono h-56 resize-y"
        :placeholder="t('tools.jsonSchemaGenerator.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" class="btn-primary" @click="generate(true)">
          {{ t('toolsCommon.convert') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
      <p v-else-if="!input.trim()" class="mt-3 text-xs text-slate-400">
        {{ t('tools.jsonSchemaGenerator.emptyInputHint') }}
      </p>
    </section>

    <!-- 描述编辑 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.jsonSchemaGenerator.topDescription') }} / {{ t('tools.jsonSchemaGenerator.propDescriptions') }}</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="jschema-root-desc" class="label-base">{{ t('tools.jsonSchemaGenerator.topDescription') }}</label>
          <textarea
            id="jschema-root-desc"
            v-model="config.rootDescription"
            class="input-base w-full h-28 resize-y"
            :placeholder="t('tools.jsonSchemaGenerator.topDescriptionPlaceholder')"
          ></textarea>
        </div>
        <div>
          <label for="jschema-prop-desc" class="label-base">{{ t('tools.jsonSchemaGenerator.propDescriptions') }}</label>
          <textarea
            id="jschema-prop-desc"
            v-model="config.propDescText"
            class="input-base w-full font-mono h-28 resize-y"
            :placeholder="t('tools.jsonSchemaGenerator.propDescPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">{{ t('tools.jsonSchemaGenerator.propDescHint') }}</p>
    </section>

    <!-- 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-1.5">
        <label for="jschema-output" class="label-base flex-1 mb-0">{{ t('tools.jsonSchemaGenerator.outputLabel') }}</label>
        <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
        <button type="button" class="btn-ghost" :disabled="!output" @click="downloadSchema">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('toolsCommon.download') }}
        </button>
      </div>
      <textarea
        id="jschema-output"
        :value="output"
        readonly
        class="input-base w-full font-mono h-72 resize-y bg-slate-50/80"
        :aria-label="t('tools.jsonSchemaGenerator.outputLabel')"
        :placeholder="t('tools.jsonSchemaGenerator.outputPlaceholder')"
      ></textarea>
      <p class="mt-3 text-xs text-slate-400">{{ t('tools.jsonSchemaGenerator.inferHint') }}</p>
    </section>
  </ToolPage>
</template>

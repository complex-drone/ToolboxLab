<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * JSON Schema 验证器
 * - Schema 侧严格 JSON.parse；数据侧先 JSON 后 js-yaml 自动嗅探
 * - ajv（allErrors + strict:false）编译失败时展示 Schema 自身错误与路径
 * - 错误表：实例路径（$.user.age 风格）+ 期望（常见关键字中文化）+ 错误值 + 原文消息 + schemaPath
 * - 输入持久化；输入防抖 600ms 自动静默验证，按钮手动验证带 Toast
 */
const { t } = useI18n()
const toast = useToast()

const schemaText = useStorage('tool-json-schema-validator-schema', '')
const dataText = useStorage('tool-json-schema-validator-data', '')

const dataFormat = ref('')
const result = ref({ status: 'idle', errors: [], schemaErrors: [], detail: '' })

const EXAMPLE_SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2 },
          age: { type: 'integer', minimum: 0, maximum: 150 },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
        required: ['name', 'age', 'email'],
      },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['user'],
  },
  null,
  2
)

const EXAMPLE_DATA = JSON.stringify(
  {
    user: {
      name: 'A',
      age: -5,
      email: 'not-an-email',
      role: 'guest',
      extra: true,
    },
    tags: ['ok', 42],
  },
  null,
  2
)

/** ajv 的 instancePath（/user/0/name）转 $.user[0].name 风格 */
function toJsPath(instancePath) {
  if (!instancePath) return '$'
  let out = '$'
  for (const seg of instancePath.split('/').filter(Boolean)) {
    if (/^\d+$/.test(seg)) {
      out += `[${seg}]`
    } else if (/^[A-Za-z_$][\w$]*$/.test(seg)) {
      out += `.${seg}`
    } else {
      out += `[${JSON.stringify(seg)}]`
    }
  }
  return out
}

/** 按实例路径从数据中取值 */
function resolveValue(data, instancePath) {
  let cur = data
  for (const seg of instancePath.split('/').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return { found: false, value: undefined }
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false, value: undefined }
    cur = cur[seg]
  }
  return { found: true, value: cur }
}

/** 序列化展示值，超长截断 */
function truncateJson(value) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text === undefined) text = String(value)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/** 常见关键字本地化：中文模板（或英文短语）+ 参数拼接 */
function localizeExpect(err) {
  const p = err.params || {}
  const tl = key => t(`tools.jsonSchemaValidator.${key}`)
  switch (err.keyword) {
    case 'type':
      return `${tl('kwType')} ${p.type}`.trim()
    case 'required':
      return `${tl('kwRequired')} ${p.missingProperty}`.trim()
    case 'enum':
      return `${tl('kwEnum')} ${truncateJson(p.allowedValues)}`.trim()
    case 'const':
      return `${tl('kwConst')} ${truncateJson(p.allowedValue)}`.trim()
    case 'format':
      return `${tl('kwFormat')} ${p.format}`.trim()
    case 'pattern':
      return `${tl('kwPattern')} ${p.pattern}`.trim()
    case 'minimum':
      return `${tl('kwMinimum')} ${p.limit}`.trim()
    case 'maximum':
      return `${tl('kwMaximum')} ${p.limit}`.trim()
    case 'exclusiveMinimum':
      return `${tl('kwExclusiveMinimum')} ${p.limit}`.trim()
    case 'exclusiveMaximum':
      return `${tl('kwExclusiveMaximum')} ${p.limit}`.trim()
    case 'minLength':
      return `${tl('kwMinLength')} ${p.limit} ${tl('kwChars')}`.trim()
    case 'maxLength':
      return `${tl('kwMaxLength')} ${p.limit} ${tl('kwChars')}`.trim()
    case 'minItems':
      return `${tl('kwMinItems')} ${p.limit} ${tl('kwUnit')}`.trim()
    case 'maxItems':
      return `${tl('kwMaxItems')} ${p.limit} ${tl('kwUnit')}`.trim()
    case 'additionalProperties':
      return `${tl('kwAdditionalProperties')} ${p.additionalProperty}`.trim()
    default:
      return err.message || ''
  }
}

/** 数据解析：先 JSON，失败后用 js-yaml 兜底嗅探 */
async function parseData(src) {
  const trimmed = src.trim()
  try {
    return { value: JSON.parse(trimmed), format: 'json' }
  } catch {
    // 继续尝试 YAML
  }
  const yaml = await import('js-yaml')
  const value = yaml.load(trimmed)
  if (value === undefined) throw new Error(t('tools.jsonSchemaValidator.invalidData'))
  return { value, format: 'yaml' }
}

/**
 * 执行验证；manual 为 true 时给出 Toast 反馈
 * 结果状态：idle / valid / invalid / schemaParseError / dataParseError / schemaError
 */
async function runValidate(manual) {
  result.value = { status: 'idle', errors: [], schemaErrors: [], detail: '' }
  dataFormat.value = ''
  if (!schemaText.value.trim() || !dataText.value.trim()) return

  let schema
  try {
    schema = JSON.parse(schemaText.value)
  } catch (e) {
    result.value = { status: 'schemaParseError', errors: [], schemaErrors: [], detail: e && e.message ? e.message : '' }
    if (manual) toast.error(t('toolsCommon.invalidInput'))
    return
  }

  let data
  try {
    const parsed = await parseData(dataText.value)
    data = parsed.value
    dataFormat.value = parsed.format
  } catch (e) {
    result.value = { status: 'dataParseError', errors: [], schemaErrors: [], detail: e && e.message ? e.message : '' }
    if (manual) toast.error(t('toolsCommon.invalidInput'))
    return
  }

  let validate
  try {
    const Ajv = (await import('ajv')).default
    const ajv = new Ajv({ allErrors: true, strict: false })
    validate = ajv.compile(schema)
  } catch (e) {
    const schemaErrors = Array.isArray(e.errors)
      ? e.errors.map(item => ({
          path: toJsPath(item.instancePath || ''),
          message: item.message || '',
          schemaPath: item.schemaPath || '',
        }))
      : []
    result.value = {
      status: 'schemaError',
      schemaErrors,
      errors: [],
      detail: schemaErrors.length === 0 && e && e.message ? e.message : '',
    }
    if (manual) toast.error(t('toolsCommon.invalidInput'))
    return
  }

  let ok = false
  try {
    ok = validate(data)
  } catch (e) {
    result.value = { status: 'schemaError', errors: [], schemaErrors: [], detail: e && e.message ? e.message : '' }
    if (manual) toast.error(t('toolsCommon.invalidInput'))
    return
  }

  if (ok) {
    result.value = { status: 'valid', errors: [], schemaErrors: [], detail: '' }
    if (manual) toast.success(t('tools.jsonSchemaValidator.validResult'))
    return
  }

  const rows = (validate.errors || []).map(err => {
    const resolved = resolveValue(data, err.instancePath || '')
    return {
      path: toJsPath(err.instancePath || ''),
      expect: localizeExpect(err),
      message: err.message || '',
      schemaPath: err.schemaPath || '',
      value: resolved.found ? truncateJson(resolved.value) : t('tools.jsonSchemaValidator.valueMissing'),
    }
  })
  result.value = { status: 'invalid', errors: rows, schemaErrors: [], detail: '' }
  if (manual) toast.info(t('tools.jsonSchemaValidator.invalidResult'))
}

// 输入变化后静默自动验证
watchDebounced([schemaText, dataText], () => runValidate(false), { debounce: 600 })

function loadExample() {
  schemaText.value = EXAMPLE_SCHEMA
  dataText.value = EXAMPLE_DATA
  result.value = { status: 'idle', errors: [], schemaErrors: [], detail: '' }
}

function clearAll() {
  schemaText.value = ''
  dataText.value = ''
  dataFormat.value = ''
  result.value = { status: 'idle', errors: [], schemaErrors: [], detail: '' }
}
</script>

<template>
  <ToolPage tool-id="jsonSchemaValidator">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="jv-schema" class="label-base">{{ t('tools.jsonSchemaValidator.schemaLabel') }}</label>
          <textarea
            id="jv-schema"
            v-model="schemaText"
            class="input-base w-full font-mono h-64 resize-y"
            :placeholder="t('tools.jsonSchemaValidator.schemaPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <label for="jv-data" class="label-base flex-1">{{ t('tools.jsonSchemaValidator.dataLabel') }}</label>
            <span v-if="dataFormat" class="chip mb-1.5">
              {{ dataFormat === 'yaml' ? t('tools.jsonSchemaValidator.detectedYaml') : t('tools.jsonSchemaValidator.detectedJson') }}
            </span>
          </div>
          <textarea
            id="jv-data"
            v-model="dataText"
            class="input-base w-full font-mono h-64 resize-y"
            :placeholder="t('tools.jsonSchemaValidator.dataPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" class="btn-primary" @click="runValidate(true)">
          {{ t('tools.jsonSchemaValidator.validateBtn') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 结果区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.result') }}</h2>

      <!-- 通过 -->
      <div
        v-if="result.status === 'valid'"
        class="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 flex-shrink-0" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {{ t('tools.jsonSchemaValidator.validResult') }}
      </div>

      <!-- Schema / 数据解析失败 -->
      <div
        v-else-if="result.status === 'schemaParseError' || result.status === 'dataParseError'"
        class="rounded-xl border border-red-200 bg-red-50 px-4 py-3"
      >
        <p class="text-sm font-medium text-red-700 break-all">
          {{ result.status === 'schemaParseError' ? t('tools.jsonSchemaValidator.invalidSchemaJson') : t('tools.jsonSchemaValidator.invalidData') }}
        </p>
        <p v-if="result.detail" class="text-xs text-red-500 mt-1 break-all">{{ result.detail }}</p>
      </div>

      <!-- Schema 编译失败 -->
      <div v-else-if="result.status === 'schemaError'" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <p class="text-sm font-medium text-red-700">{{ t('tools.jsonSchemaValidator.schemaErrorTitle') }}</p>
        <p v-if="result.detail" class="text-xs text-red-500 mt-1 break-all">{{ result.detail }}</p>
        <ul v-if="result.schemaErrors.length" class="mt-2 space-y-1.5">
          <li v-for="(item, idx) in result.schemaErrors" :key="idx" class="text-xs text-red-600">
            <span class="font-mono">{{ item.path }}</span>
            <span class="mx-1 text-red-400">—</span>
            {{ item.message }}
          </li>
        </ul>
      </div>

      <!-- 验证失败：错误表 -->
      <div v-else-if="result.status === 'invalid'">
        <div class="flex items-center gap-2 mb-3">
          <p class="text-sm font-medium text-orange-600">{{ t('tools.jsonSchemaValidator.invalidResult') }}</p>
          <span class="chip bg-orange-50 text-orange-600 border-orange-100">
            {{ t('tools.jsonSchemaValidator.errorCountLabel') }} {{ result.errors.length }}
          </span>
        </div>

        <!-- 桌面表格 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="text-left text-xs text-slate-400 border-b border-slate-200">
                <th class="py-2 pr-3 font-medium">{{ t('tools.jsonSchemaValidator.colPath') }}</th>
                <th class="py-2 pr-3 font-medium">{{ t('tools.jsonSchemaValidator.colExpect') }}</th>
                <th class="py-2 pr-3 font-medium">{{ t('tools.jsonSchemaValidator.colValue') }}</th>
                <th class="py-2 pr-3 font-medium">{{ t('tools.jsonSchemaValidator.colMessage') }}</th>
                <th class="py-2 font-medium">{{ t('tools.jsonSchemaValidator.colSchemaPath') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in result.errors" :key="idx" class="border-b border-slate-100 align-top">
                <td class="py-2 pr-3 font-mono text-xs text-blue-600 whitespace-nowrap">{{ item.path }}</td>
                <td class="py-2 pr-3 text-orange-600">{{ item.expect }}</td>
                <td class="py-2 pr-3 font-mono text-xs text-slate-600 break-all max-w-[180px]">{{ item.value }}</td>
                <td class="py-2 pr-3 text-xs text-slate-500">{{ item.message }}</td>
                <td class="py-2 font-mono text-xs text-slate-400 whitespace-nowrap">{{ item.schemaPath }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动端卡片 -->
        <div class="md:hidden space-y-3">
          <div v-for="(item, idx) in result.errors" :key="idx" class="rounded-xl border border-slate-200 bg-white/70 p-3">
            <p class="font-mono text-xs text-blue-600 break-all">{{ item.path }}</p>
            <p class="text-sm text-orange-600 mt-1">{{ item.expect }}</p>
            <p class="text-xs text-slate-600 mt-1 break-all font-mono">{{ item.value }}</p>
            <p class="text-xs text-slate-500 mt-1">{{ item.message }}</p>
            <p class="text-xs text-slate-400 mt-1 font-mono break-all">{{ item.schemaPath }}</p>
          </div>
        </div>
      </div>

      <!-- 空态 -->
      <p v-else class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>

      <div v-if="result.status === 'invalid'" class="mt-3 flex justify-end">
        <CopyButton
          :text="result.errors.map(e => [e.path, e.expect, e.value, e.message].filter(Boolean).join('  ')).join('\n')"
          :label="t('toolsCommon.copyAll')"
        />
      </div>
    </section>
  </ToolPage>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'

/**
 * OpenAPI 3.x 转 Postman Collection v2.1（自实现转换器）
 * - 输入嗅探：以 { 开头按 JSON 解析，否则用 js-yaml 解析
 * - 解析 info/servers/paths/parameters/requestBody/responses，生成 path×method 的 item
 * - url.raw 中 {param} 转 :param；query/header 参数、JSON 请求体示例（schema 推断）齐全
 * - 按 tag 分组为 folder，无 tag 归根；servers[0].url 可选写入 baseUrl 变量
 * - 统计：接口数 / 分组数 / 含请求体数；转换选项持久化
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-openapi-to-postman-config', {
  includeVariables: true,
})

const input = ref('')
const output = ref('')
const errorMsg = ref('')
const converting = ref(false)
const stats = ref(null)
const downloadName = ref('collection.postman_collection.json')

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

/** 示例 OpenAPI 文档：覆盖 server / 标签 / 路径参数 / 查询参数 / 请求头 / 请求体 / 响应 */
const EXAMPLE = JSON.stringify(
  {
    openapi: '3.0.3',
    info: { title: 'ToolboxLab Demo API', version: '1.0.0', description: '示例 API 文档' },
    servers: [{ url: 'https://api.toolboxlab.example/v1' }],
    paths: {
      '/users': {
        get: {
          tags: ['用户'],
          summary: '获取用户列表',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '页码' },
            { name: 'X-Request-Id', in: 'header', schema: { type: 'string' }, description: '请求标识' },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
        },
        post: {
          tags: ['用户'],
          summary: '创建用户',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          responses: {
            '201': {
              description: '已创建',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['用户'],
          summary: '获取用户详情',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: '用户 ID' }],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          },
        },
        delete: {
          tags: ['用户'],
          summary: '删除用户',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '204': { description: '已删除' } },
        },
      },
      '/health': {
        get: {
          summary: '健康检查',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string', example: 'Alice' },
            email: { type: 'string', format: 'email' },
            active: { type: 'boolean' },
          },
          required: ['id', 'name'],
        },
      },
    },
  },
  null,
  2
)

/** 输入嗅探解析：{ 开头按 JSON，否则按 YAML */
async function parseSource(src) {
  const trimmed = src.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
  const yaml = await import('js-yaml')
  const doc = yaml.load(trimmed)
  if (doc === undefined || doc === null || typeof doc !== 'object') {
    const err = new Error(t('tools.openapiToPostman.parseError'))
    err.locale = true
    throw err
  }
  return doc
}

/** 解析本地引用（仅支持 #/ 开头的文档内引用） */
function resolveRef(root, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return node
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let cur = root
    for (const seg of node.$ref.slice(2).split('/')) {
      const key = seg.replace(/~1/g, '/').replace(/~0/g, '~')
      cur = cur && typeof cur === 'object' ? cur[key] : undefined
    }
    return resolveRef(root, cur, depth + 1)
  }
  return node
}

/** 安全序列化为 JSON 字符串 */
function safeStringify(value) {
  if (value === undefined) return 'null'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 生成 Postman 随机 id */
function makeId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 参数规范化 */
function normalizeParam(p) {
  return {
    name: (p && p.name) || '',
    in: (p && p.in) || 'query',
    description: (p && p.description) || '',
    required: !!(p && p.required),
    schema: (p && p.schema) || {},
  }
}

/** 标量占位值 */
function sampleScalar(schema) {
  const s = schema || {}
  if (Array.isArray(s.enum) && s.enum.length > 0) return String(s.enum[0])
  if (s.default !== undefined) return String(s.default)
  if (s.example !== undefined) return String(s.example)
  switch (s.type) {
    case 'integer':
    case 'number':
      return String(typeof s.minimum === 'number' ? s.minimum : 1)
    case 'boolean':
      return 'true'
    default: {
      if (s.format === 'date-time') return '2026-01-01T00:00:00Z'
      if (s.format === 'date') return '2026-01-01'
      if (s.format === 'email') return 'user@example.com'
      return 'string'
    }
  }
}

/** 从 JSON Schema 递归生成示例值 */
function sampleFromSchema(root, schema, depth = 0) {
  const s = resolveRef(root, schema)
  if (!s || typeof s !== 'object' || depth > 8) return null
  if (s.example !== undefined) return s.example
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) return sampleFromSchema(root, s.oneOf[0], depth + 1)
  if (Array.isArray(s.anyOf) && s.anyOf.length > 0) return sampleFromSchema(root, s.anyOf[0], depth + 1)
  if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    return sampleFromSchema(root, Object.assign({}, ...s.allOf), depth + 1)
  }
  const type = s.type || (s.properties ? 'object' : s.items ? 'array' : null)
  switch (type) {
    case 'object': {
      const out = {}
      const props = s.properties || {}
      for (const [key, val] of Object.entries(props)) {
        out[key] = sampleFromSchema(root, val, depth + 1)
      }
      return out
    }
    case 'array':
      return [sampleFromSchema(root, s.items, depth + 1)]
    case 'string':
      if (s.format === 'date-time') return '2026-01-01T00:00:00Z'
      if (s.format === 'date') return '2026-01-01'
      if (s.format === 'email') return 'user@example.com'
      if (s.format === 'uri') return 'https://example.com'
      return 'string'
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 0
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return null
  }
}

/** 从 media type 生成表单参数列表 */
function formParamsFromMedia(root, media) {
  const out = []
  if (media.example && typeof media.example === 'object' && !Array.isArray(media.example)) {
    for (const [key, value] of Object.entries(media.example)) {
      out.push({ key, value: String(value), type: 'text' })
    }
    return out
  }
  const schema = resolveRef(root, media.schema)
  if (schema && schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const resolved = resolveRef(root, prop)
      out.push({ key, value: sampleScalar(resolved), type: 'text', description: resolved.description || '' })
    }
  }
  return out
}

/** 请求体转换：application/json / urlencoded / formdata / 其他 raw */
function buildBody(root, requestBody) {
  if (!requestBody || typeof requestBody !== 'object' || !requestBody.content) return null
  const content = requestBody.content
  const description = requestBody.description || ''

  const jsonMedia = content['application/json']
  if (jsonMedia) {
    let sample
    if (jsonMedia.example !== undefined) {
      sample = jsonMedia.example
    } else if (jsonMedia.examples) {
      const first = Object.values(jsonMedia.examples)[0]
      sample = first && first.value !== undefined ? first.value : null
    } else {
      sample = sampleFromSchema(root, jsonMedia.schema, 0)
    }
    return {
      mode: 'raw',
      raw: safeStringify(sample),
      options: { raw: { language: 'json' } },
      description,
    }
  }

  const urlencoded = content['application/x-www-form-urlencoded']
  if (urlencoded) {
    return { mode: 'urlencoded', urlencoded: formParamsFromMedia(root, urlencoded), description }
  }

  const formdata = content['multipart/form-data']
  if (formdata) {
    return { mode: 'formdata', formdata: formParamsFromMedia(root, formdata), description }
  }

  const firstKey = Object.keys(content)[0]
  if (firstKey) {
    const media = content[firstKey] || {}
    const sample =
      media.example !== undefined ? media.example : sampleFromSchema(root, media.schema, 0)
    return {
      mode: 'raw',
      raw: safeStringify(sample),
      options: { raw: { language: 'text' } },
      description,
    }
  }
  return null
}

/** Postman URL 对象：{param} 转 :param，query 参数拼入 raw 与 query 数组 */
function buildPostmanUrl(serverUrl, path, pathParams, queryParams) {
  const base = String(serverUrl || 'https://example.com').replace(/\/+$/, '')
  const colonPath = String(path).replace(/\{([^}]+)\}/g, ':$1')
  const query = queryParams.map(p => ({
    key: p.name,
    value: sampleScalar(p.schema),
    description: p.description,
  }))
  const raw =
    query.length > 0
      ? `${base}${colonPath}?${query.map(q => `${q.key}=${q.value}`).join('&')}`
      : `${base}${colonPath}`
  let protocol = 'https'
  let host = [base]
  try {
    const parsed = new URL(base)
    protocol = parsed.protocol.replace(/:$/, '')
    host = parsed.hostname.split('.')
  } catch {
    host = [base]
  }
  return {
    raw,
    protocol,
    host,
    path: colonPath.split('/').filter(Boolean),
    query,
    variables: pathParams.map(p => ({
      key: p.name,
      value: sampleScalar(p.schema),
      description: p.description,
    })),
  }
}

/** 从 responses 生成响应示例（每个接口最多 2 条） */
function buildResponses(root, operation, originalRequest) {
  const responses = operation.responses || {}
  const entries = []
  for (const [code, resp] of Object.entries(responses)) {
    const content = resp && resp.content
    const jsonMedia = content && content['application/json']
    if (!jsonMedia) continue
    let sample
    if (jsonMedia.example !== undefined) {
      sample = jsonMedia.example
    } else if (jsonMedia.examples) {
      const first = Object.values(jsonMedia.examples)[0]
      sample = first && first.value !== undefined ? first.value : null
    } else {
      sample = sampleFromSchema(root, jsonMedia.schema, 0)
    }
    const numericCode = parseInt(code, 10)
    entries.push({
      name: `${code} - ${resp.description || ''}`.trim(),
      originalRequest,
      code: Number.isFinite(numericCode) ? numericCode : 200,
      status: numericCode === 204 ? 'No Content' : 'OK',
      header: [],
      body: safeStringify(sample),
      _postman_previewlanguage: 'json',
    })
    if (entries.length >= 2) break
  }
  return entries
}

/** 构建完整 Collection 并写入统计 */
function buildCollection(doc) {
  const serverUrl =
    Array.isArray(doc.servers) && doc.servers[0] && doc.servers[0].url
      ? doc.servers[0].url
      : 'https://example.com'
  const folders = new Map()
  const rootItems = []
  let endpoints = 0
  let bodies = 0

  for (const [path, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const pathLevelParams = Array.isArray(pathItem.parameters)
      ? pathItem.parameters.map(normalizeParam)
      : []
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op || typeof op !== 'object') continue
      endpoints += 1

      const params = [
        ...pathLevelParams,
        ...(Array.isArray(op.parameters) ? op.parameters.map(normalizeParam) : []),
      ]
      const pathParams = params.filter(p => p.in === 'path')
      const queryParams = params.filter(p => p.in === 'query')
      const headerParams = params.filter(p => p.in === 'header')

      const url = buildPostmanUrl(serverUrl, path, pathParams, queryParams)
      const body = buildBody(doc, resolveRef(doc, op.requestBody))
      if (body) bodies += 1

      const headers = headerParams.map(p => ({
        key: p.name,
        value: sampleScalar(p.schema),
        description: p.description,
      }))
      const name = op.summary || `${method.toUpperCase()} ${path}`
      const request = {
        method: method.toUpperCase(),
        header: headers,
        url,
        description: op.description || op.summary || '',
      }
      if (body) request.body = body

      const item = { name, request }
      const responses = buildResponses(doc, op, {
        method: request.method,
        url: { raw: url.raw },
        header: headers,
      })
      if (responses.length > 0) item.response = responses

      const tag = Array.isArray(op.tags) && op.tags.length > 0 ? op.tags[0] : ''
      if (tag) {
        if (!folders.has(tag)) folders.set(tag, [])
        folders.get(tag).push(item)
      } else {
        rootItems.push(item)
      }
    }
  }

  const collection = {
    info: {
      name: (doc.info && doc.info.title) || 'API Collection',
      _postman_id: makeId(),
      description: (doc.info && doc.info.description) || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      ...Array.from(folders.entries()).map(([tag, items]) => ({ name: tag, item: items })),
      ...rootItems,
    ],
  }
  if (config.value.includeVariables) {
    collection.variable = [{ key: 'baseUrl', value: serverUrl }]
  }
  stats.value = { endpoints, folders: folders.size, bodies }
  return collection
}

async function convert(manual) {
  errorMsg.value = ''
  output.value = ''
  stats.value = null
  downloadName.value = 'collection.postman_collection.json'
  if (!input.value.trim()) {
    if (manual) {
      errorMsg.value = t('toolsCommon.invalidInput')
      toast.error(t('toolsCommon.invalidInput'))
    }
    return
  }
  converting.value = true
  try {
    const doc = await parseSource(input.value)
    if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') {
      const err = new Error(t('tools.openapiToPostman.notOpenapi'))
      err.locale = true
      throw err
    }
    const collection = buildCollection(doc)
    output.value = JSON.stringify(collection, null, 2)
    const title = (doc.info && doc.info.title) || 'collection'
    const slug = title.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'collection'
    downloadName.value = `${slug}.postman_collection.json`
    if (manual) toast.success(t('tools.openapiToPostman.generated'))
  } catch (e) {
    output.value = ''
    stats.value = null
    errorMsg.value =
      e && e.locale ? e.message : `${t('tools.openapiToPostman.parseError')}：${e && e.message ? e.message : ''}`
    if (manual) toast.error(t('toolsCommon.invalidInput'))
  } finally {
    converting.value = false
  }
}

function loadExample() {
  input.value = EXAMPLE
  errorMsg.value = ''
}

function clearAll() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
  stats.value = null
}

function downloadCollection() {
  try {
    downloadText(output.value, downloadName.value, 'application/json;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="openapiToPostman">
    <!-- 选项与操作 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('toolsCommon.options') }}</h2>
      <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
        <input v-model="config.includeVariables" type="checkbox" class="w-4 h-4 accent-blue-600" />
        <span>{{ t('tools.openapiToPostman.includeVariables') }}</span>
      </label>
      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" class="btn-primary" :disabled="converting" @click="convert(true)">
          {{ converting ? t('toolsCommon.processing') : t('toolsCommon.convert') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="oai-input" class="label-base">{{ t('tools.openapiToPostman.inputLabel') }}</label>
      <textarea
        id="oai-input"
        v-model="input"
        class="input-base w-full font-mono h-64 resize-y"
        :placeholder="t('tools.openapiToPostman.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
    </section>

    <!-- 输出与统计 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-1.5">
        <label for="oai-output" class="label-base flex-1 mb-0">{{ t('tools.openapiToPostman.outputLabel') }}</label>
        <template v-if="stats">
          <span v-for="(value, key) in stats" :key="key" class="chip">
            {{ t(`tools.openapiToPostman.stat${key.charAt(0).toUpperCase()}${key.slice(1)}`) }} {{ value }}
          </span>
        </template>
      </div>
      <textarea
        id="oai-output"
        :value="output"
        readonly
        class="input-base w-full font-mono h-80 resize-y bg-slate-50/80"
        :aria-label="t('tools.openapiToPostman.outputLabel')"
        :placeholder="t('tools.openapiToPostman.outputPlaceholder')"
      ></textarea>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
        <button type="button" class="btn-ghost" :disabled="!output" @click="downloadCollection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {{ t('toolsCommon.download') }}
        </button>
      </div>
    </section>
  </ToolPage>
</template>

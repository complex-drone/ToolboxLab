<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']

/** HTTP 方法徽章配色（GET 绿 / POST 蓝 / PUT 黄 / DELETE 红 / PATCH 紫） */
const METHOD_STYLES = {
  GET: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-100 text-blue-700 border-blue-200',
  PUT: 'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
  PATCH: 'bg-purple-100 text-purple-700 border-purple-200',
}

/** 内置示例 OpenAPI 文档（YAML） */
const EXAMPLE_DOC = `openapi: 3.0.3
info:
  title: Petstore Demo API
  version: 1.2.0
  description: 一个小型宠物商店示例 API，用于演示文档预览效果。
servers:
  - url: https://petstore.example.com/api/v1
    description: 生产环境
  - url: https://staging.petstore.example.com/api/v1
    description: 预发布环境
tags:
  - name: pets
    description: 宠物资源
  - name: users
    description: 用户资源
paths:
  /pets:
    get:
      tags:
        - pets
      summary: 分页查询宠物列表
      operationId: listPets
      parameters:
        - name: limit
          in: query
          required: false
          description: 每页数量，默认 20
          schema:
            type: integer
        - name: q
          in: query
          required: false
          description: 名称关键词
          schema:
            type: string
      responses:
        '200':
          description: 宠物列表
    post:
      tags:
        - pets
      summary: 新增宠物
      operationId: createPet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
                  description: 宠物名称
                age:
                  type: integer
                  description: 年龄（月）
                tags:
                  type: array
                  description: 标签列表
      responses:
        '201':
          description: 创建成功
        '400':
          description: 参数错误
  /pets/{petId}:
    get:
      tags:
        - pets
      summary: 查询宠物详情
      operationId: showPetById
      parameters:
        - name: petId
          in: path
          required: true
          description: 宠物 ID
          schema:
            type: string
      responses:
        '200':
          description: 宠物详情
        '404':
          description: 未找到
    delete:
      tags:
        - pets
      summary: 删除宠物
      operationId: deletePetById
      parameters:
        - name: petId
          in: path
          required: true
          description: 宠物 ID
          schema:
            type: string
      responses:
        '204':
          description: 删除成功
  /users:
    get:
      tags:
        - users
      summary: 查询用户列表
      operationId: listUsers
      responses:
        '200':
          description: 用户列表
    post:
      tags:
        - users
      summary: 注册新用户
      operationId: createUser
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                username:
                  type: string
                  description: 用户名
                email:
                  type: string
                  description: 邮箱
                profile:
                  type: object
                  description: 个人资料
                  properties:
                    nickname:
                      type: string
                      description: 昵称
                    bio:
                      type: string
                      description: 简介
      responses:
        '201':
          description: 注册成功
`

const raw = ref('')
const debouncedRaw = ref('')
const search = ref('')

const syncDebounced = useDebounceFn(() => {
  debouncedRaw.value = raw.value
}, 400)
watch(raw, () => syncDebounced())

/**
 * 解析结果状态：
 * empty 未输入 / ok 解析成功 / error 解析失败（附具体错误与位置）
 */
const parseState = ref({ status: 'empty', format: '', versionOk: true, endpoints: [], servers: [], info: null, errorText: '', errorLine: 0, errorCol: 0 })

let parseSeq = 0

function collectEndpoints(doc) {
  const paths = doc && typeof doc === 'object' && doc.paths ? doc.paths : {}
  const list = []
  if (paths && typeof paths === 'object') {
    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey]
      if (!pathItem || typeof pathItem !== 'object') continue
      const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
      for (const method of METHODS) {
        const op = pathItem[method]
        if (!op || typeof op !== 'object') continue
        const opParams = Array.isArray(op.parameters) ? op.parameters : []
        const tags = Array.isArray(op.tags) && op.tags.length ? op.tags.filter(tag => typeof tag === 'string' && tag.trim()) : []
        list.push({
          key: method.toUpperCase() + ' ' + pathKey,
          method: method.toUpperCase(),
          path: pathKey,
          summary: typeof op.summary === 'string' ? op.summary : '',
          description: typeof op.description === 'string' ? op.description : '',
          tags,
          params: [...sharedParams, ...opParams],
          requestBody: op.requestBody && typeof op.requestBody === 'object' ? op.requestBody : null,
          responses: op.responses && typeof op.responses === 'object' ? op.responses : null,
        })
      }
    }
  }
  return list
}

async function parseDoc(text) {
  const seq = ++parseSeq
  if (!text.trim()) {
    parseState.value = { status: 'empty', format: '', versionOk: true, endpoints: [], servers: [], info: null, errorText: '', errorLine: 0, errorCol: 0 }
    return
  }
  const trimmed = text.trim()
  try {
    let doc
    let format
    if (trimmed.startsWith('{')) {
      format = 'JSON'
      doc = JSON.parse(trimmed)
    } else {
      format = 'YAML'
      const yaml = await import('js-yaml')
      doc = yaml.load(trimmed)
    }
    if (seq !== parseSeq) return
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('document root must be an object')
    }
    const version = typeof doc.openapi === 'string' ? doc.openapi : ''
    parseState.value = {
      status: 'ok',
      format,
      versionOk: version ? version.startsWith('3') : true,
      endpoints: collectEndpoints(doc),
      servers: Array.isArray(doc.servers) ? doc.servers : [],
      info: doc.info && typeof doc.info === 'object' ? doc.info : null,
      errorText: '',
      errorLine: 0,
      errorCol: 0,
    }
    expanded.value = {}
  } catch (err) {
    if (seq !== parseSeq) return
    const mark = err && err.mark ? err.mark : null
    parseState.value = {
      status: 'error',
      format: '',
      versionOk: true,
      endpoints: [],
      servers: [],
      info: null,
      errorText: err && err.message ? String(err.message) : String(err),
      errorLine: mark && typeof mark.line === 'number' ? mark.line + 1 : 0,
      errorCol: mark && typeof mark.column === 'number' ? mark.column + 1 : 0,
    }
  }
}
watch(debouncedRaw, value => {
  parseDoc(value).catch(() => {})
})

/** 展开状态：key 为 METHOD + path */
const expanded = ref({})
function toggleEndpoint(key) {
  const map = expanded.value
  map[key] = !map[key]
}

/** 搜索过滤：匹配 path / summary / tag */
const filteredEndpoints = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = parseState.value.status === 'ok' ? parseState.value.endpoints : []
  if (!q) return list
  return list.filter(item =>
    item.path.toLowerCase().includes(q)
    || item.summary.toLowerCase().includes(q)
    || item.tags.some(tag => tag.toLowerCase().includes(q))
  )
})

/** 按标签分组（未标注的接口归入“未分组”） */
const endpointGroups = computed(() => {
  const map = new Map()
  for (const item of filteredEndpoints.value) {
    const tags = item.tags.length ? item.tags : [null]
    for (const tag of tags) {
      if (!map.has(tag)) map.set(tag, [])
      map.get(tag).push(item)
    }
  }
  return Array.from(map.entries()).map(([tag, items]) => ({ tag, items }))
})

const totalCount = computed(() => (parseState.value.status === 'ok' ? parseState.value.endpoints.length : 0))
const tagCount = computed(() => {
  const set = new Set()
  for (const item of parseState.value.endpoints) {
    if (item.tags.length) item.tags.forEach(tag => set.add(tag))
    else set.add(null)
  }
  return set.size
})
const filteredCount = computed(() => filteredEndpoints.value.length)

function describeType(schema) {
  if (!schema || typeof schema !== 'object') return ''
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop() || 'ref'
  if (schema.type === 'array') return 'array<' + (describeType(schema.items) || 'any') + '>'
  if (schema.type) return String(schema.type)
  if (schema.properties) return 'object'
  return ''
}

/** 递归一层展开对象/数组字段，用于 schema 简要展示 */
function flattenSchema(schema, depth = 0, maxDepth = 1, out = []) {
  if (!schema || typeof schema !== 'object' || out.length >= 60) return out
  if (schema.type === 'array' && schema.items && depth < maxDepth) {
    flattenSchema(schema.items, depth + 1, maxDepth, out)
    return out
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const name of Object.keys(schema.properties)) {
      if (out.length >= 60) break
      const sub = schema.properties[name]
      const isObj = sub && typeof sub === 'object' && (sub.type === 'object' || (!sub.type && sub.properties))
      const isArr = sub && typeof sub === 'object' && sub.type === 'array'
      out.push({
        name,
        type: describeType(sub),
        desc: sub && typeof sub.description === 'string' ? sub.description : '',
        depth,
      })
      if ((isObj || isArr) && depth < maxDepth) {
        flattenSchema(isArr ? sub.items : sub, depth + 1, maxDepth, out)
      }
    }
  }
  return out
}

function paramType(param) {
  if (!param || typeof param !== 'object') return ''
  if (param.schema && typeof param.schema === 'object') return describeType(param.schema)
  return typeof param.type === 'string' ? param.type : ''
}

function responseEntries(responses) {
  if (!responses || typeof responses !== 'object') return []
  return Object.keys(responses).map(code => {
    const item = responses[code]
    return {
      code: String(code),
      desc: item && typeof item === 'object' && typeof item.description === 'string' ? item.description : '',
    }
  })
}

function requestBodyContents(requestBody) {
  if (!requestBody || typeof requestBody !== 'object') return []
  const content = requestBody.content && typeof requestBody.content === 'object' ? requestBody.content : {}
  return Object.keys(content).map(type => ({
    type,
    schema: content[type] && typeof content[type] === 'object' ? content[type].schema : null,
  }))
}

function loadExample() {
  raw.value = EXAMPLE_DOC
  debouncedRaw.value = EXAMPLE_DOC
  search.value = ''
  toast.info(t('toolsCommon.loaded'))
}
</script>

<template>
  <ToolPage tool-id="openapiViewer">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <label class="label-base mb-0" for="ov-raw">{{ t('tools.openapiViewer.inputLabel') }}</label>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('tools.openapiViewer.loadExample') }}
        </button>
      </div>
      <textarea
        id="ov-raw"
        v-model="raw"
        rows="8"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.openapiViewer.inputPlaceholder')"
        :aria-label="t('tools.openapiViewer.inputLabel')"
      ></textarea>
      <p v-if="parseState.status === 'error'" class="mt-2 text-sm text-red-600 break-all" role="alert">
        {{ t('tools.openapiViewer.parseError') }}: {{ parseState.errorText }}
        <span v-if="parseState.errorLine" class="font-mono">
          ({{ t('tools.openapiViewer.errorLine') }} {{ parseState.errorLine }}, {{ t('tools.openapiViewer.errorCol') }} {{ parseState.errorCol }})
        </span>
      </p>
    </section>

    <!-- 文档预览 -->
    <template v-if="parseState.status === 'ok'">
      <!-- info 区 -->
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <h2 class="text-lg font-bold text-slate-800 break-all">
              {{ parseState.info && parseState.info.title ? parseState.info.title : t('tools.openapiViewer.untitled') }}
            </h2>
            <p
              v-if="parseState.info && typeof parseState.info.description === 'string' && parseState.info.description"
              class="text-sm text-slate-500 mt-1 leading-relaxed"
            >
              {{ parseState.info.description }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <span v-if="parseState.info && parseState.info.version" class="chip font-mono">v{{ parseState.info.version }}</span>
            <span class="chip">{{ parseState.format }}</span>
            <span class="chip">{{ t('tools.openapiViewer.endpointsCount', { n: totalCount }) }}</span>
            <span class="chip">{{ t('tools.openapiViewer.tagsCount', { n: tagCount }) }}</span>
            <span v-if="search.trim()" class="chip border-amber-200 bg-amber-50 text-amber-700">
              {{ t('tools.openapiViewer.filteredCount', { n: filteredCount }) }}
            </span>
          </div>
        </div>
        <p v-if="!parseState.versionOk" class="mb-3 text-xs text-amber-600" role="alert">
          {{ t('tools.openapiViewer.notOpenapi3') }}
        </p>
        <div v-if="parseState.servers.length">
          <div class="section-title">{{ t('tools.openapiViewer.serversTitle') }}</div>
          <ul class="space-y-1.5">
            <li
              v-for="(server, i) in parseState.servers"
              :key="i"
              class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-white/70 px-3 py-2"
            >
              <code class="font-mono text-xs sm:text-sm text-slate-700 break-all min-w-0">
                {{ server && server.url ? server.url : '' }}
              </code>
              <span v-if="server && server.description" class="text-xs text-slate-400">{{ server.description }}</span>
            </li>
          </ul>
        </div>
        <!-- 搜索框 -->
        <div class="mt-3">
          <label class="sr-only" for="ov-search">{{ t('tools.openapiViewer.searchLabel') }}</label>
          <input
            id="ov-search"
            v-model="search"
            type="search"
            class="input-base"
            :placeholder="t('tools.openapiViewer.searchPlaceholder')"
            :aria-label="t('tools.openapiViewer.searchLabel')"
          />
        </div>
      </section>

      <!-- 按标签分组渲染接口 -->
      <section
        v-for="group in endpointGroups"
        :key="String(group.tag)"
        class="glass-card p-4 sm:p-6 mb-4"
      >
        <h3 class="flex items-center gap-2 mb-3">
          <span class="chip">{{ group.tag === null ? t('tools.openapiViewer.untagged') : group.tag }}</span>
          <span class="text-xs text-slate-400 font-mono">{{ group.items.length }}</span>
        </h3>
        <div class="space-y-2">
          <div
            v-for="item in group.items"
            :key="item.key"
            class="rounded-xl border border-slate-200 bg-white/70 overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 sm:gap-3 px-3 py-2.5 text-left hover:bg-blue-50/50 transition"
              :aria-expanded="expanded[item.key] ? 'true' : 'false'"
              @click="toggleEndpoint(item.key)"
            >
              <span
                class="shrink-0 inline-flex items-center justify-center min-w-[54px] px-2 py-0.5 rounded-md border text-xs font-bold font-mono"
                :class="METHOD_STYLES[item.method] || 'bg-slate-100 text-slate-600 border-slate-200'"
              >
                {{ item.method }}
              </span>
              <code class="font-mono text-sm text-slate-800 break-all min-w-0">{{ item.path }}</code>
              <span class="hidden sm:inline text-sm text-slate-500 truncate">{{ item.summary || t('tools.openapiViewer.noSummary') }}</span>
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"
                class="w-4 h-4 ml-auto shrink-0 text-slate-400 transition-transform"
                :class="expanded[item.key] ? 'rotate-180' : ''"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-if="expanded[item.key]" class="border-t border-slate-100 px-3 py-3 space-y-4 bg-white/50">
              <p v-if="item.description" class="text-sm text-slate-500 leading-relaxed">{{ item.description }}</p>

              <!-- 参数表格 -->
              <div>
                <div class="section-title">{{ t('tools.openapiViewer.paramsTitle') }}</div>
                <table v-if="item.params.length" class="w-full text-xs sm:text-sm">
                  <thead>
                    <tr class="text-left text-slate-400 border-b border-slate-100">
                      <th class="py-1.5 pr-2 font-medium">{{ t('tools.openapiViewer.colName') }}</th>
                      <th class="py-1.5 pr-2 font-medium">{{ t('tools.openapiViewer.colIn') }}</th>
                      <th class="py-1.5 pr-2 font-medium">{{ t('tools.openapiViewer.colRequired') }}</th>
                      <th class="py-1.5 pr-2 font-medium">{{ t('tools.openapiViewer.colType') }}</th>
                      <th class="py-1.5 font-medium">{{ t('tools.openapiViewer.colDesc') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(param, pi) in item.params" :key="pi" class="border-b border-slate-50 align-top">
                      <td class="py-1.5 pr-2 font-mono text-slate-700 break-all">{{ param && param.name ? param.name : '-' }}</td>
                      <td class="py-1.5 pr-2 font-mono text-slate-500">{{ param && param.in ? param.in : '-' }}</td>
                      <td class="py-1.5 pr-2">
                        <span
                          v-if="param && param.required === true"
                          class="inline-block px-1.5 py-0.5 rounded-full border text-[11px] font-medium bg-red-50 text-red-600 border-red-200"
                        >
                          {{ t('tools.openapiViewer.requiredBadge') }}
                        </span>
                        <span v-else class="inline-block px-1.5 py-0.5 rounded-full border text-[11px] font-medium bg-slate-50 text-slate-400 border-slate-200">
                          {{ t('tools.openapiViewer.optionalBadge') }}
                        </span>
                      </td>
                      <td class="py-1.5 pr-2 font-mono text-slate-500 break-all">{{ paramType(param) || '-' }}</td>
                      <td class="py-1.5 text-slate-500 break-all">{{ param && param.description ? param.description : '' }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="text-sm text-slate-400">{{ t('tools.openapiViewer.noParams') }}</p>
              </div>

              <!-- 请求体 -->
              <div>
                <div class="section-title">{{ t('tools.openapiViewer.requestBodyTitle') }}</div>
                <template v-if="requestBodyContents(item.requestBody).length">
                  <div
                    v-for="(content, ci) in requestBodyContents(item.requestBody)"
                    :key="ci"
                    class="mb-2 rounded-lg border border-slate-100 bg-white/80 p-2.5"
                  >
                    <code class="font-mono text-xs text-blue-600">{{ content.type }}</code>
                    <p v-if="!content.schema" class="mt-1 text-xs text-slate-400">{{ t('tools.openapiViewer.noSchema') }}</p>
                    <ul v-else-if="flattenSchema(content.schema).length" class="mt-1.5 space-y-1">
                      <li
                        v-for="(field, fi) in flattenSchema(content.schema)"
                        :key="fi"
                        class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                        :class="field.depth ? 'pl-4' : ''"
                      >
                        <span class="font-mono text-xs text-slate-700 break-all">
                          <span v-if="field.depth" class="text-slate-300 mr-1" aria-hidden="true">└</span>{{ field.name }}
                        </span>
                        <span class="font-mono text-[11px] text-purple-600">{{ field.type }}</span>
                        <span class="text-xs text-slate-400">{{ field.desc }}</span>
                      </li>
                    </ul>
                    <p v-else class="mt-1 font-mono text-xs text-slate-500 break-all">{{ describeType(content.schema) || t('toolsCommon.none') }}</p>
                  </div>
                </template>
                <p v-else class="text-sm text-slate-400">{{ t('tools.openapiViewer.noBody') }}</p>
              </div>

              <!-- 响应 -->
              <div>
                <div class="section-title">{{ t('tools.openapiViewer.responsesTitle') }}</div>
                <div v-if="responseEntries(item.responses).length" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="resp in responseEntries(item.responses)"
                    :key="resp.code"
                    class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-mono"
                    :class="resp.code.startsWith('2')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : resp.code.startsWith('4') || resp.code.startsWith('5')
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-white text-slate-500'"
                  >
                    {{ resp.code }}
                    <span v-if="resp.desc" class="font-sans font-normal">{{ resp.desc }}</span>
                  </span>
                </div>
                <p v-else class="text-sm text-slate-400">{{ t('tools.openapiViewer.noResponses') }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 搜索无结果 -->
      <section v-if="!endpointGroups.length" class="glass-card p-4 sm:p-6 mb-4">
        <p class="text-sm text-slate-400">{{ t('tools.openapiViewer.noMatch') }}</p>
      </section>
    </template>

    <!-- 空状态 -->
    <section v-else-if="parseState.status === 'empty'" class="glass-card p-4 sm:p-6 mb-4">
      <p class="text-sm text-slate-400">{{ t('tools.openapiViewer.emptyHint') }}</p>
    </section>
  </ToolPage>
</template>

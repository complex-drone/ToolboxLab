<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/** 方向与输入持久化 */
const store = useStorage('tool-graphql-rest-converter', {
  direction: 'g2r',
  gql: '',
  rest: '',
})

const directionModel = computed({
  get: () => (store.value.direction === 'r2g' ? 'r2g' : 'g2r'),
  set: v => {
    store.value.direction = v === 'r2g' ? 'r2g' : 'g2r'
  },
})
const gqlText = computed({
  get: () => (typeof store.value.gql === 'string' ? store.value.gql : ''),
  set: v => {
    store.value.gql = String(v ?? '')
  },
})
const restText = computed({
  get: () => (typeof store.value.rest === 'string' ? store.value.rest : ''),
  set: v => {
    store.value.rest = String(v ?? '')
  },
})

/** 示例含花括号等语言包禁用字符，必须放在 JS 常量中 */
const SAMPLE_GQL = '{ user(id: 1) { name posts { title } } }'
const SAMPLE_REST = '/users/1/posts'

/* ================================================================== */
/* GraphQL 轻量解析：tokenizer + 递归下降（自实现，无依赖）              */
/* 支持：operation 名与 query 前缀（可选）、嵌套字段、别名、参数、        */
/* 变量定义括号（跳过）、标量/枚举/变量/列表/对象值。                     */
/* 不支持：fragments 与指令（遇到报错）、schema 描述等。                 */
/* ================================================================== */
class GqlParseError extends Error {
  constructor(info) {
    super(info && info.key ? info.key : 'GqlParseError')
    this.info = info || { key: 'errUnexpectedToken', params: {} }
  }
}

function posInfo(key, pos, src, extra) {
  const before = String(src).slice(0, pos)
  const line = before.split('\n').length
  const col = pos - before.lastIndexOf('\n')
  return { key, params: Object.assign({ line, col }, extra || {}) }
}

const PUNCT_SET = new Set(['{', '}', '(', ')', ':', '[', ']'])
const OP_WORDS = new Set(['query', 'mutation', 'subscription'])

function tokenizeGql(src) {
  const tokens = []
  const n = src.length
  let i = 0
  while (i < n) {
    const ch = src[i]
    if (ch === '#') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    // 空白与逗号（GraphQL 中逗号仅相当于空白）
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      i++
      continue
    }
    if (ch === '"') {
      if (src.slice(i, i + 3) === '"""') {
        const end = src.indexOf('"""', i + 3)
        if (end === -1) throw new GqlParseError(posInfo('errUnterminatedString', i, src))
        tokens.push({ type: 'string', value: src.slice(i + 3, end), pos: i })
        i = end + 3
        continue
      }
      let j = i + 1
      let val = ''
      let closed = false
      while (j < n) {
        const c = src[j]
        if (c === '\\') {
          val += src[j + 1] || ''
          j += 2
          continue
        }
        if (c === '"') {
          closed = true
          break
        }
        if (c === '\n') break
        val += c
        j++
      }
      if (!closed) throw new GqlParseError(posInfo('errUnterminatedString', i, src))
      tokens.push({ type: 'string', value: val, pos: i })
      i = j + 1
      continue
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
      if (!m) throw new GqlParseError(posInfo('errUnexpectedChar', i, src, { ch }))
      tokens.push({ type: 'variable', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
      tokens.push({ type: 'name', value: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i))
      if (!m || !m[0] || m[0] === '-') throw new GqlParseError(posInfo('errUnexpectedChar', i, src, { ch }))
      tokens.push({ type: 'number', value: Number(m[0]), pos: i })
      i += m[0].length
      continue
    }
    if (ch === '.' || ch === '@') {
      throw new GqlParseError(posInfo('errUnsupportedFeature', i, src))
    }
    if (PUNCT_SET.has(ch)) {
      tokens.push({ type: ch, pos: i })
      i++
      continue
    }
    throw new GqlParseError(posInfo('errUnexpectedChar', i, src, { ch }))
  }
  return tokens
}

function parseGqlDocument(src) {
  const tokens = tokenizeGql(src)
  if (tokens.length === 0) throw new GqlParseError(posInfo('errEmpty', 0, src))
  let i = 0
  const peek = () => (i < tokens.length ? tokens[i] : null)

  function expectName() {
    const tok = peek()
    if (!tok || tok.type !== 'name') {
      throw new GqlParseError(posInfo('errExpectedName', tok ? tok.pos : src.length, src))
    }
    i++
    return tok
  }

  function parseValue() {
    const tok = peek()
    if (!tok) throw new GqlParseError(posInfo('errUnexpectedToken', src.length, src))
    if (tok.type === 'string') {
      i++
      return { kind: 'string', value: tok.value }
    }
    if (tok.type === 'number') {
      i++
      return { kind: 'number', value: tok.value }
    }
    if (tok.type === 'variable') {
      i++
      return { kind: 'variable', value: tok.value }
    }
    if (tok.type === 'name') {
      i++
      if (tok.value === 'true') return { kind: 'boolean', value: true }
      if (tok.value === 'false') return { kind: 'boolean', value: false }
      if (tok.value === 'null') return { kind: 'null', value: null }
      return { kind: 'enum', value: tok.value }
    }
    if (tok.type === '[') {
      i++
      const items = []
      while (peek() && peek().type !== ']') {
        items.push(parseValue())
        if (peek() && peek().type === ',') i++
      }
      if (!peek()) throw new GqlParseError(posInfo('errUnclosedBracket', src.length, src))
      i++
      return { kind: 'list', value: items }
    }
    if (tok.type === '{') {
      i++
      const fields = []
      while (peek() && peek().type !== '}') {
        const kt = expectName()
        const colon = peek()
        if (!colon || colon.type !== ':') {
          throw new GqlParseError(posInfo('errExpectedColon', colon ? colon.pos : src.length, src))
        }
        i++
        fields.push({ name: kt.value, value: parseValue() })
        if (peek() && peek().type === ',') i++
      }
      if (!peek()) throw new GqlParseError(posInfo('errUnclosedBrace', src.length, src))
      i++
      return { kind: 'object', value: fields }
    }
    throw new GqlParseError(posInfo('errUnexpectedToken', tok.pos, src))
  }

  function parseArguments() {
    i++ // 消费 (
    const args = []
    for (;;) {
      const tok = peek()
      if (!tok) throw new GqlParseError(posInfo('errUnclosedParen', src.length, src))
      if (tok.type === ')') {
        i++
        break
      }
      const nameTok = expectName()
      const colon = peek()
      if (!colon || colon.type !== ':') {
        throw new GqlParseError(posInfo('errExpectedColon', colon ? colon.pos : src.length, src))
      }
      i++
      args.push({ name: nameTok.value, value: parseValue() })
      if (peek() && peek().type === ',') i++
    }
    return args
  }

  function parseField() {
    const first = expectName()
    let alias = ''
    let name = first.value
    if (peek() && peek().type === ':') {
      i++
      const real = expectName()
      alias = first.value
      name = real.value
    }
    const args = []
    if (peek() && peek().type === '(') args.push(...parseArguments())
    let children = null
    if (peek() && peek().type === '{') children = parseSelectionSet()
    return { alias, name, args, children }
  }

  function parseSelectionSet() {
    i++ // 消费 {
    const fields = []
    for (;;) {
      const tok = peek()
      if (!tok) throw new GqlParseError(posInfo('errUnclosedBrace', src.length, src))
      if (tok.type === '}') {
        i++
        break
      }
      fields.push(parseField())
    }
    return fields
  }

  const operations = []
  while (i < tokens.length) {
    const tok = tokens[i]
    let opType = 'query'
    let opName = ''
    if (tok.type === 'name' && OP_WORDS.has(tok.value)) {
      opType = tok.value
      i++
      const nt = peek()
      if (nt && nt.type === 'name') {
        opName = nt.value
        i++
      }
      // 变量定义括号：跳过平衡的圆括号内容
      if (peek() && peek().type === '(') {
        let depth = 0
        do {
          const t = tokens[i]
          if (t.type === '(') depth++
          else if (t.type === ')') depth--
          i++
        } while (i < tokens.length && depth > 0)
        if (depth !== 0) throw new GqlParseError(posInfo('errUnclosedParen', src.length, src))
      }
    } else if (tok.type === 'name') {
      throw new GqlParseError(posInfo('errUnexpectedToken', tok.pos, src))
    }
    if (!peek() || peek().type !== '{') {
      const bad = peek()
      throw new GqlParseError(posInfo('errUnexpectedToken', bad ? bad.pos : src.length, src))
    }
    operations.push({ opType, name: opName, fields: parseSelectionSet() })
  }
  return operations
}

/* ================================================================== */
/* 单复数转换（简单映射表 + 规则后备，仅用于路径建议）                    */
/* ================================================================== */
const IRREGULAR_PLURAL = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  tooth: 'teeth',
  foot: 'feet',
  mouse: 'mice',
  goose: 'geese',
}
const IRREGULAR_SINGULAR = {}
Object.keys(IRREGULAR_PLURAL).forEach(k => {
  IRREGULAR_SINGULAR[IRREGULAR_PLURAL[k]] = k
})

function pluralize(word) {
  const w = String(word || '')
  if (!w) return w
  const lower = w.toLowerCase()
  if (IRREGULAR_PLURAL[lower]) return IRREGULAR_PLURAL[lower]
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies'
  if (/(x|z|ch|sh)$/i.test(w)) return w + 'es'
  if (/s$/i.test(w)) return w // 已是复数形式，保持不变
  return w + 's'
}

function singularize(word) {
  const w = String(word || '')
  if (!w) return w
  const lower = w.toLowerCase()
  if (IRREGULAR_SINGULAR[lower]) return IRREGULAR_SINGULAR[lower]
  if (/ies$/i.test(w)) return w.slice(0, -3) + 'y'
  if (/sses$/i.test(w)) return w.slice(0, -2)
  if (/(x|ch|sh)es$/i.test(w)) return w.slice(0, -2)
  if (/ss$/i.test(w)) return w
  if (/s$/i.test(w)) return w.slice(0, -1)
  return w
}

/* ================================================================== */
/* 正向：GraphQL 字段树 → REST 路径建议                                 */
/* ================================================================== */
function valueToPathPart(val) {
  if (!val) return ''
  if (val.kind === 'string') return val.value
  if (val.kind === 'number') return String(val.value)
  if (val.kind === 'boolean') return val.value ? 'true' : 'false'
  if (val.kind === 'enum') return val.value
  if (val.kind === 'null') return 'null'
  return ''
}

function buildRestRows(fields) {
  const rows = []
  function walk(list, parentPath) {
    for (const f of list) {
      const seg = pluralize(f.name)
      const basePath = parentPath === '' ? `/${seg}` : `${parentPath}/${seg}`
      const idArg = f.args.find(a => a.name === 'id')
      const fullPath = idArg ? `${basePath}/${valueToPathPart(idArg.value)}` : basePath
      const children = f.children || []
      const leaves = children.filter(c => !c.children)
      const branches = children.filter(c => c.children && c.children.length > 0)
      rows.push({ path: fullPath, fields: leaves.map(c => c.name) })
      for (const b of branches) walk([b], fullPath)
    }
  }
  walk(fields, '')
  return rows
}

/* ================================================================== */
/* 反向：REST 路径 → GraphQL 查询草图                                   */
/* ================================================================== */
function restPathToGraphql(pathStr) {
  const clean = String(pathStr || '').trim()
  if (!clean) throw { key: 'errEmptyPath', params: {} }
  const segs = clean.split(/[/?#]+/).filter(Boolean)
  const parts = []
  for (const seg of segs) {
    if (/^\d+$/.test(seg)) {
      if (parts.length === 0) throw { key: 'errFieldFirst', params: {} }
      parts[parts.length - 1].id = seg
      continue
    }
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(seg)) {
      throw { key: 'errBadPath', params: { seg } }
    }
    parts.push({ raw: seg, field: seg, id: null })
  }
  if (parts.length === 0) throw { key: 'errEmptyPath', params: {} }
  // 单数化规则：中间段与带 id 的段转为单数（users/1 → user(id:"1")）；
  // 末段（无 id 的集合字段）保持原样（如 posts { ... }）
  const lastIdx = parts.length - 1
  parts.forEach((p, idx) => {
    if (idx < lastIdx || p.id !== null) p.field = singularize(p.raw)
  })

  function lines(idx, depth) {
    const pad = '  '.repeat(depth)
    const p = parts[idx]
    const isLast = idx === parts.length - 1
    const args = p.id !== null ? `(id: "${p.id}")` : ''
    const head = `${pad}${p.field}${args} {`
    if (isLast) return [head, `${pad}  ...`, `${pad}}`]
    return [head].concat(lines(idx + 1, depth + 1), [`${pad}}`])
  }
  return ['query {'].concat(lines(0, 1), ['}']).join('\n')
}

/* ================================================================== */
/* 双向自动执行（防抖 300ms + 行内报错）                                 */
/* ================================================================== */
const forwardState = ref({ status: 'idle', rows: [], error: null })
const backwardState = ref({ status: 'idle', gql: '', error: null })

function errorInfo(err) {
  if (err instanceof GqlParseError && err.info) return err.info
  if (err && err.key) return err
  return { key: 'errUnexpectedToken', params: {} }
}

function runForward() {
  const src = gqlText.value
  if (!src.trim()) {
    forwardState.value = { status: 'idle', rows: [], error: null }
    return
  }
  try {
    const ops = parseGqlDocument(src)
    const fields = []
    for (const op of ops) fields.push(...op.fields)
    forwardState.value = { status: 'ok', rows: buildRestRows(fields), error: null }
  } catch (err) {
    forwardState.value = { status: 'error', rows: [], error: errorInfo(err) }
  }
}

function runBackward() {
  const src = restText.value
  if (!src.trim()) {
    backwardState.value = { status: 'idle', gql: '', error: null }
    return
  }
  try {
    backwardState.value = { status: 'ok', gql: restPathToGraphql(src), error: null }
  } catch (err) {
    backwardState.value = { status: 'error', gql: '', error: errorInfo(err) }
  }
}

const debouncedRun = useDebounceFn(() => {
  runForward()
  runBackward()
}, 300)
watch([gqlText, restText], () => debouncedRun())

// 解析出错时给出一次 Toast 提示（行内提示常驻）
watch(
  () => forwardState.value.error,
  (val, old) => {
    if (val && !old) toast.error(t('toolsCommon.invalidInput'))
  }
)
watch(
  () => backwardState.value.error,
  (val, old) => {
    if (val && !old) toast.error(t('toolsCommon.invalidInput'))
  }
)

/* 初始化：持久化内容立即执行一次 */
runForward()
runBackward()

/* ================================================================== */
/* 操作                                                                */
/* ================================================================== */
function errorText(info) {
  if (!info) return ''
  return t(`tools.graphqlRestConverter.${info.key}`, info.params || {})
}

function applySampleGql() {
  gqlText.value = SAMPLE_GQL
  runForward()
}

function applySampleRest() {
  restText.value = SAMPLE_REST
  runBackward()
}

function copyAllPaths() {
  const rows = forwardState.value.rows
  if (!rows.length) return ''
  return rows.map(r => r.path).join('\n')
}
</script>

<template>
  <ToolPage tool-id="graphqlRestConverter">
    <!-- 方向切换 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          :class="directionModel === 'g2r' ? 'btn-primary' : 'btn-ghost'"
          @click="directionModel = 'g2r'"
        >
          {{ t('tools.graphqlRestConverter.tabG2r') }}
        </button>
        <button
          type="button"
          :class="directionModel === 'r2g' ? 'btn-primary' : 'btn-ghost'"
          @click="directionModel = 'r2g'"
        >
          {{ t('tools.graphqlRestConverter.tabR2g') }}
        </button>
      </div>
    </section>

    <!-- 正向：GraphQL 转 REST -->
    <template v-if="directionModel === 'g2r'">
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label class="label-base mb-0" for="gql-input">{{ t('tools.graphqlRestConverter.gqlInput') }}</label>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" @click="applySampleGql">
              {{ t('tools.graphqlRestConverter.sampleGql') }}
            </button>
            <button type="button" class="btn-ghost" :disabled="!gqlText" @click="gqlText = ''">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>
        <textarea
          id="gql-input"
          v-model="gqlText"
          rows="7"
          spellcheck="false"
          autocomplete="off"
          class="input-base w-full font-mono"
          :class="forwardState.error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
          :placeholder="t('tools.graphqlRestConverter.gqlPlaceholder')"
          :aria-invalid="forwardState.error ? 'true' : 'false'"
          :aria-label="t('tools.graphqlRestConverter.gqlInput')"
        ></textarea>
        <p v-if="forwardState.error" class="mt-2 text-red-600 text-sm break-all" role="alert">
          {{ t('tools.graphqlRestConverter.parseError') }}:
          {{ errorText(forwardState.error) }}
          <span class="text-xs">({{ t('tools.graphqlRestConverter.atPos', forwardState.error.params || {}) }})</span>
        </p>
      </section>

      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 class="section-title mb-0">{{ t('tools.graphqlRestConverter.pathsTable') }}</h2>
          <div v-if="forwardState.rows.length" class="flex items-center gap-2">
            <CopyButton :text="copyAllPaths()" :label="t('tools.graphqlRestConverter.copyAllPaths')" />
          </div>
        </div>

        <p v-if="forwardState.status === 'idle'" class="text-sm text-slate-400">
          {{ t('tools.graphqlRestConverter.gqlPlaceholder') }}
        </p>
        <p v-else-if="forwardState.error" class="text-sm text-slate-400">
          {{ t('tools.graphqlRestConverter.parseError') }}
        </p>
        <p v-else-if="!forwardState.rows.length" class="text-sm text-slate-400">{{ t('toolsCommon.none') }}</p>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-400">
                <th class="py-2 pr-2 font-medium w-8">#</th>
                <th class="py-2 pr-2 font-medium">{{ t('tools.graphqlRestConverter.colPath') }}</th>
                <th class="py-2 pr-2 font-medium">{{ t('tools.graphqlRestConverter.colFields') }}</th>
                <th class="py-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in forwardState.rows"
                :key="i"
                class="border-t border-slate-100 align-top"
              >
                <td class="py-2 pr-2 font-mono text-xs text-slate-400">{{ i + 1 }}</td>
                <td class="py-2 pr-2">
                  <code class="font-mono text-slate-800 break-all">{{ row.path }}</code>
                </td>
                <td class="py-2 pr-2 text-slate-500 break-all">
                  <template v-if="row.fields.length">{{ row.fields.join(', ') }}</template>
                  <span v-else class="text-slate-300 text-xs">{{ t('tools.graphqlRestConverter.noFields') }}</span>
                </td>
                <td class="py-2">
                  <CopyButton compact :text="row.path" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-xs text-slate-400">{{ t('tools.graphqlRestConverter.placeholderHint') }}</p>
      </section>
    </template>

    <!-- 反向：REST 转 GraphQL -->
    <template v-else>
      <section class="glass-card p-4 sm:p-6 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label class="label-base mb-0" for="rest-input">{{ t('tools.graphqlRestConverter.restInput') }}</label>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" @click="applySampleRest">
              {{ t('tools.graphqlRestConverter.sampleRest') }}
            </button>
            <button type="button" class="btn-ghost" :disabled="!restText" @click="restText = ''">
              {{ t('toolsCommon.clear') }}
            </button>
          </div>
        </div>
        <input
          id="rest-input"
          v-model="restText"
          type="text"
          spellcheck="false"
          autocomplete="off"
          class="input-base font-mono"
          :class="backwardState.error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''"
          :placeholder="t('tools.graphqlRestConverter.restPlaceholder')"
          :aria-invalid="backwardState.error ? 'true' : 'false'"
          :aria-label="t('tools.graphqlRestConverter.restInput')"
        />
        <p v-if="backwardState.error" class="mt-2 text-red-600 text-sm break-all" role="alert">
          {{ t('tools.graphqlRestConverter.parseError') }}: {{ errorText(backwardState.error) }}
        </p>
      </section>

      <section class="glass-card p-4 sm:p-6 mb-4">
        <h2 class="section-title">{{ t('tools.graphqlRestConverter.queryResult') }}</h2>
        <template v-if="backwardState.status === 'ok' && backwardState.gql">
          <div class="rounded-xl border border-slate-200 bg-white/80 p-3 max-h-96 overflow-y-auto">
            <pre class="font-mono text-xs text-slate-800 whitespace-pre-wrap break-all">{{ backwardState.gql }}</pre>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <CopyButton :text="backwardState.gql" :label="t('toolsCommon.copy')" />
          </div>
        </template>
        <p v-else class="text-sm text-slate-400">{{ t('tools.graphqlRestConverter.restPlaceholder') }}</p>
        <p class="mt-3 text-xs text-slate-400">{{ t('tools.graphqlRestConverter.placeholderHint') }}</p>
      </section>
    </template>
  </ToolPage>
</template>

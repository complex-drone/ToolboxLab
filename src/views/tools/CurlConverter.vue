<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, useDebounceFn } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

const { t } = useI18n()

const LANGS = [
  { id: 'python', labelKey: 'langPython' },
  { id: 'javascript', labelKey: 'langJs' },
  { id: 'java', labelKey: 'langJava' },
  { id: 'go', labelKey: 'langGo' },
]

/** 常见示例 curl 命令（含反斜杠续行与单/双引号） */
const EXAMPLES = [
  {
    key: 'Get',
    cmd: 'curl "https://api.github.com/repos/vuejs/core"',
  },
  {
    key: 'PostJson',
    cmd: [
      "curl -X POST 'https://httpbin.org/post' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -H 'Authorization: Bearer token123' \\",
      '  -d \'{"name": "toolbox", "count": 3}\'',
    ].join('\n'),
  },
  {
    key: 'Headers',
    cmd: 'curl -L -u "user:pass123" -H "Accept: application/json" "https://api.example.com/v1/users?page=2&size=20"',
  },
]

/**
 * 需要取值的选项：kind 决定语义
 */
const VALUE_FLAGS = {
  '-X': 'method', '--request': 'method',
  '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data', '--data-urlencode': 'data',
  '-u': 'user', '--user': 'user',
  '-F': 'form', '--form': 'form',
  '--url': 'url',
  '-A': 'agent', '--user-agent': 'agent',
  '-e': 'referer', '--referer': 'referer',
  '-b': 'cookie', '--cookie': 'cookie',
  '-o': 'ignored', '--output': 'ignored',
  '-m': 'ignored', '--max-time': 'ignored', '--connect-timeout': 'ignored', '--retry': 'ignored',
  '-x': 'ignored', '--proxy': 'ignored',
}

/** 无值开关选项 */
const BOOL_FLAGS = new Set(['-G', '--get', '-L', '--location', '-k', '--insecure', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-f', '--fail', '-I', '--head', '-i', '--include', '--compressed', '--http1.0', '--http1.1', '--http2', '--progress-bar'])
/** 可组合的短开关字符，如 -sS、-skL */
const BOOL_CHARS = new Set(['G', 'L', 'k', 's', 'S', 'v', 'f', 'I', 'i', '#', '4', '6'])

/**
 * shell 参数 tokenizer：
 * 支持 反斜杠续行、单引号字面量、双引号内转义（\" \\ \$ \`）、反斜杠转义
 */
function tokenizeShell(input) {
  const text = input.replace(/\\\r?\n/g, '')
  const tokens = []
  let current = ''
  let hasCurrent = false
  let quote = null
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") { quote = null } else { current += ch }
      hasCurrent = true
      i += 1
      continue
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; hasCurrent = true; i += 1; continue }
      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1]
        if (next === '"' || next === '\\' || next === '$' || next === '`') { current += next; i += 2; continue }
      }
      current += ch
      hasCurrent = true
      i += 1
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasCurrent) { tokens.push(current); current = ''; hasCurrent = false }
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1]
      hasCurrent = true
      i += 2
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      hasCurrent = true
      i += 1
      continue
    }
    current += ch
    hasCurrent = true
    i += 1
  }
  if (quote !== null) throw new Error('unterminated-quote')
  if (hasCurrent) tokens.push(current)
  return tokens
}

function splitUrl(rawUrl) {
  let rest = String(rawUrl).trim()
  const hashIndex = rest.indexOf('#')
  if (hashIndex !== -1) rest = rest.slice(0, hashIndex)
  const qIndex = rest.indexOf('?')
  let base = rest
  let queryStr = ''
  if (qIndex !== -1) {
    base = rest.slice(0, qIndex)
    queryStr = rest.slice(qIndex + 1)
  }
  const query = []
  if (queryStr) {
    try {
      for (const pair of new URLSearchParams(queryStr)) query.push([pair[0], pair[1]])
    } catch {
      query.push([queryStr, ''])
    }
  }
  return { base, query }
}

function parseDataToQuery(data) {
  const query = []
  try {
    for (const pair of new URLSearchParams(data)) query.push([pair[0], pair[1]])
  } catch {
    query.push([data, ''])
  }
  return query
}

/**
 * 解析 curl 命令为规范化请求对象
 * @returns {{ ok: boolean, errorKey: string, request: object }}
 */
function parseCurl(input) {
  let tokens
  try {
    tokens = tokenizeShell(input)
  } catch {
    return { ok: false, errorKey: 'quoteError', request: null }
  }
  if (!tokens.length) return { ok: false, errorKey: 'empty', request: null }

  let start = 0
  if (tokens.length > 1 && /^curl(\.exe)?$/i.test(tokens[0])) start = 1

  const req = {
    method: '',
    urlRaw: '',
    headers: [],
    dataParts: [],
    formParts: [],
    authRaw: '',
    getFlag: false,
    insecure: false,
    follow: false,
  }

  let i = start
  while (i < tokens.length) {
    const token = tokens[i]
    if (token.length > 1 && token[0] === '-') {
      let kind = null
      let attached = ''
      if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, token)) {
        kind = VALUE_FLAGS[token]
      } else if (BOOL_FLAGS.has(token)) {
        applyBoolFlag(req, token)
      } else {
        const eqIndex = token.indexOf('=')
        if (eqIndex > 1) {
          const name = token.slice(0, eqIndex)
          if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, name)) {
            kind = VALUE_FLAGS[name]
            attached = token.slice(eqIndex + 1)
          }
        }
        if (kind === null && token[1] !== '-') {
          for (const shortFlag of ['-X', '-H', '-d', '-u', '-F', '-A', '-e', '-b', '-o', '-x', '-m']) {
            if (token.startsWith(shortFlag) && token.length > shortFlag.length) {
              kind = VALUE_FLAGS[shortFlag]
              attached = token.slice(shortFlag.length)
              break
            }
          }
          if (kind === null) {
            // 组合短开关，如 -sS / -skL
            for (const ch of token.slice(1)) {
              if (BOOL_CHARS.has(ch)) applyBoolFlag(req, '-' + ch)
            }
          }
        }
      }

      if (kind && attached === '') {
        // 取值型选项：值在下一个 token
        i += 1
        attached = i < tokens.length ? tokens[i] : ''
      }
      if (kind) applyValueFlag(req, kind, attached)
      i += 1
      continue
    }
    // 非 flag token：第一个当作 URL
    if (!req.urlRaw) req.urlRaw = token
    i += 1
  }

  if (!req.urlRaw.trim()) return { ok: false, errorKey: 'noUrl', request: null }

  const hasForm = req.formParts.length > 0
  const hasData = req.dataParts.length > 0 && !hasForm
  let body = hasData ? req.dataParts.join('&') : ''

  let method = req.method
  if (req.getFlag) {
    method = method || 'GET'
  } else if (!method && (hasForm || hasData)) {
    method = 'POST'
  } else if (!method) {
    method = 'GET'
  }

  const split = splitUrl(req.urlRaw)
  let query = split.query
  if (req.getFlag && body) {
    // -G：把 -d 数据合并为 URL 查询参数
    query = [...query, ...parseDataToQuery(body)]
    body = ''
  }

  // form-data 模式下由 HTTP 库自动生成 multipart 边界，移除手写的 Content-Type
  const headers = req.headers.filter(h => !(hasForm && h[0].toLowerCase() === 'content-type'))

  let auth = null
  if (req.authRaw) {
    const colonIndex = req.authRaw.indexOf(':')
    auth = colonIndex === -1
      ? { user: req.authRaw, pass: '' }
      : { user: req.authRaw.slice(0, colonIndex), pass: req.authRaw.slice(colonIndex + 1) }
  }

  return {
    ok: true,
    errorKey: '',
    request: {
      method,
      baseUrl: split.base,
      query,
      headers,
      body,
      form: hasForm ? req.formParts : null,
      auth,
      insecure: req.insecure,
      follow: req.follow,
    },
  }
}

function applyBoolFlag(req, flag) {
  if (flag === '-G' || flag === '--get') req.getFlag = true
  else if (flag === '-k' || flag === '--insecure') req.insecure = true
  else if (flag === '-L' || flag === '--location') req.follow = true
}

function applyValueFlag(req, kind, value) {
  if (value === '' && kind !== 'method') return
  switch (kind) {
    case 'method':
      req.method = String(value).trim().toUpperCase()
      break
    case 'header': {
      const colonIndex = String(value).indexOf(':')
      if (colonIndex === -1) break
      const name = String(value).slice(0, colonIndex).trim()
      const headerValue = String(value).slice(colonIndex + 1).trim()
      if (name) req.headers.push([name, headerValue])
      break
    }
    case 'data':
      req.dataParts.push(String(value))
      break
    case 'user':
      req.authRaw = String(value)
      break
    case 'form': {
      const eqIndex = String(value).indexOf('=')
      if (eqIndex === -1) break
      const name = String(value).slice(0, eqIndex)
      const raw = String(value).slice(eqIndex + 1)
      const isFile = raw.startsWith('@')
      req.formParts.push({ name, value: isFile ? raw.slice(1) : raw, isFile })
      break
    }
    case 'url':
      req.urlRaw = String(value)
      break
    case 'agent':
      req.headers.push(['User-Agent', String(value)])
      break
    case 'referer':
      req.headers.push(['Referer', String(value)])
      break
    case 'cookie':
      req.headers.push(['Cookie', String(value)])
      break
    default:
      break
  }
}

/* ---------------- 各语言字符串转义 ---------------- */
function escDouble(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}
function escSingle(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}
const dq = value => '"' + escDouble(value) + '"'
const sq = value => "'" + escSingle(value) + "'"

const queryEntries = req => req.query

/* ---------------- Python requests ---------------- */
function genPython(req) {
  const lines = ['import requests', '']
  const args = []

  let urlExpr = dq(req.baseUrl)
  if (queryEntries(req).length) {
    lines.push('params = {')
    for (const pair of queryEntries(req)) lines.push('    ' + dq(pair[0]) + ': ' + dq(pair[1]) + ',')
    lines.push('}')
    args.push('params=params')
  }

  const headers = [...req.headers]

  if (headers.length) {
    lines.push('headers = {')
    for (const h of headers) lines.push('    ' + dq(h[0]) + ': ' + dq(h[1]) + ',')
    lines.push('}')
    args.push('headers=headers')
  }

  if (req.form) {
    const plainFields = req.form.filter(f => !f.isFile)
    const fileFields = req.form.filter(f => f.isFile)
    if (plainFields.length) {
      lines.push('data = {')
      for (const f of plainFields) lines.push('    ' + dq(f.name) + ': ' + dq(f.value) + ',')
      lines.push('}')
      args.push('data=data')
    }
    if (fileFields.length) {
      lines.push('files = {')
      for (const f of fileFields) lines.push('    ' + dq(f.name) + ': open(' + dq(f.value) + ', ' + dq('rb') + '),')
      lines.push('}')
      args.push('files=files')
    }
  } else if (req.body) {
    lines.push('data = ' + dq(req.body))
    args.push('data=data')
  }

  if (req.auth) args.push('auth=(' + dq(req.auth.user) + ', ' + dq(req.auth.pass) + ')')
  if (req.insecure) args.push('verify=False')
  if (req.follow) args.push('allow_redirects=True')

  const fn = 'requests.' + req.method.toLowerCase()
  args.unshift('url=' + urlExpr)
  lines.push('')
  lines.push('response = ' + fn + '(')
  for (const arg of args) lines.push('    ' + arg + ',')
  lines.push(')')
  lines.push('')
  lines.push('print(response.status_code)')
  lines.push('print(response.text)')
  return lines.join('\n')
}

/* ---------------- JavaScript fetch ---------------- */
function genJavaScript(req) {
  const lines = []
  const hasQuery = queryEntries(req).length > 0
  lines.push((hasQuery ? 'const url = new URL(' : 'const url = ') + dq(req.baseUrl) + (hasQuery ? ')' : ''))
  if (hasQuery) {
    for (const pair of queryEntries(req)) {
      lines.push('url.searchParams.append(' + dq(pair[0]) + ', ' + dq(pair[1]) + ')')
    }
  }

  const headers = [...req.headers]
  if (req.auth) headers.push(['Authorization', '"Basic " + btoa(' + dq(req.auth.user + ':' + req.auth.pass) + ')'])
  if (headers.length) {
    lines.push('')
    lines.push('const headers = {')
    for (const h of headers) {
      lines.push('    ' + sq(h[0]) + ': ' + (h[1].startsWith('"Basic " + btoa(') ? h[1] : sq(h[1])) + ',')
    }
    lines.push('}')
  }

  let bodyExpr = ''
  if (req.form) {
    lines.push('')
    lines.push('const form = new FormData()')
    for (const f of req.form) {
      if (f.isFile) {
        lines.push('form.append(' + sq(f.name) + ', file, ' + sq(f.value) + ') // TODO: file is a File/Blob for ' + dq(f.value))
      } else {
        lines.push('form.append(' + sq(f.name) + ', ' + sq(f.value) + ')')
      }
    }
    bodyExpr = 'body: form,'
  } else if (req.body) {
    bodyExpr = 'body: ' + dq(req.body) + ','
  }

  lines.push('')
  const options = []
  if (req.method !== 'GET') options.push('    method: ' + sq(req.method) + ',')
  if (headers.length) options.push('    headers,')
  if (bodyExpr) options.push('    ' + bodyExpr)
  if (req.follow) options.push('    redirect: "follow", // -L')
  lines.push('const response = await fetch(url, {')
  lines.push(...options)
  lines.push('})')
  lines.push('')
  lines.push('console.log(response.status)')
  lines.push('console.log(await response.text())')
  if (req.insecure) {
    lines.push('')
    lines.push('// NOTE: --insecure requires NODE_TLS_REJECT_UNAUTHORIZED=0 or a custom https.Agent (dev only)')
  }
  return lines.join('\n')
}

/* ---------------- Java HttpClient ---------------- */
function genJava(req) {
  const imports = ['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse']
  if (req.auth) imports.push('java.util.Base64')
  const sorted = imports.sort()

  const lines = []
  for (const imp of sorted) lines.push('import ' + imp + ';')
  lines.push('')
  lines.push('public class Main {')
  lines.push('    public static void main(String[] args) throws Exception {')
  lines.push('        HttpClient client = HttpClient.newBuilder()')
  if (req.follow) {
    lines.push('            .followRedirects(HttpClient.Redirect.NORMAL) // -L')
  }
  lines.push('            .build();')
  lines.push('')
  lines.push('        HttpRequest.Builder builder = HttpRequest.newBuilder()')
  lines.push('            .uri(URI.create(' + dq(buildFullUrl(req)) + '))')

  for (const h of req.headers) {
    lines.push('            .header(' + dq(h[0]) + ', ' + dq(h[1]) + ')')
  }
  if (req.auth) {
    lines.push('            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(' + dq(req.auth.user + ':' + req.auth.pass) + '.getBytes()))')
  }

  if (req.form) {
    lines.push('        String boundary = "----toolboxlab" + System.currentTimeMillis();')
    lines.push('        String body = ""')
    for (const f of req.form) {
      lines.push('            + "--" + boundary + "\\r\\n"')
      if (f.isFile) {
        lines.push('            + "Content-Disposition: form-data; name=' + dq(f.name) + '; filename=' + dq(f.value) + '\\r\\n"')
        lines.push('            + "\\r\\n"')
        lines.push('            + "<file content>" // TODO: read the real file content')
      } else {
        lines.push('            + "Content-Disposition: form-data; name=' + dq(f.name) + '\\r\\n"')
        lines.push('            + "\\r\\n"')
        lines.push('            + ' + dq(f.value))
      }
      lines.push('            + "\\r\\n"')
    }
    lines.push('            + "--" + boundary + "--\\r\\n";')
    lines.push('        builder.header("Content-Type", "multipart/form-data; boundary=" + boundary)')
    lines.push('            .POST(HttpRequest.BodyPublishers.ofString(body))')
  } else if (req.body) {
    // 带 body 的任意方法（含非标准的 GET/HEAD + body）
    const bodyStr = 'HttpRequest.BodyPublishers.ofString(' + dq(req.body) + ')'
    if (req.method === 'POST' || req.method === 'PUT') {
      lines.push('            .' + req.method + '(' + bodyStr + ')')
    } else {
      lines.push('            .method(' + dq(req.method) + ', ' + bodyStr + ')')
    }
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    lines.push('            .GET()')
  } else {
    lines.push('            .method(' + dq(req.method) + ', HttpRequest.BodyPublishers.noBody())')
  }
  lines.push('            .build();')
  lines.push('')
  lines.push('        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());')
  lines.push('        System.out.println(response.statusCode());')
  lines.push('        System.out.println(response.body());')
  if (req.insecure) {
    lines.push('        // NOTE: --insecure requires a custom SSLContext that trusts all certificates (dev only)')
  }
  lines.push('    }')
  lines.push('}')
  return lines.join('\n')
}

/* ---------------- Go net/http ---------------- */
function genGo(req) {
  const imports = new Set(['fmt', 'io', 'net/http'])
  let bodySetup = ''
  if (req.form) {
    imports.add('bytes')
    imports.add('mime/multipart')
    bodySetup = [
      '\tvar buf bytes.Buffer',
      '\twriter := multipart.NewWriter(&buf)',
      ...req.form.map(f => {
        if (f.isFile) {
          return [
            '\tfileWriter, _ := writer.CreateFormFile(' + dq(f.name) + ', ' + dq(f.value) + ')',
            '\tfileWriter.Write([]byte("<file content>")) // TODO: read the real file content',
          ].join('\n')
        }
        return '\twriter.WriteField(' + dq(f.name) + ', ' + dq(f.value) + ')'
      }),
      '\twriter.Close()',
      '',
    ].join('\n')
  } else if (req.body) {
    imports.add('strings')
    bodySetup = ''
  }
  if (req.insecure) imports.add('crypto/tls')
  const sorted = Array.from(imports).sort()

  const lines = ['package main', '', 'import (']
  for (const imp of sorted) lines.push('\t"' + imp + '"')
  lines.push(')', '')
  lines.push('func main() {')
  if (req.form) {
    lines.push(bodySetup)
  }
  const bodyArg = req.form ? '&buf' : req.body ? 'strings.NewReader(' + dq(req.body) + ')' : 'nil'
  lines.push('\treq, err := http.NewRequest(' + dq(req.method) + ', ' + dq(buildFullUrl(req)) + ', ' + bodyArg + ')')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}')
  for (const h of req.headers) {
    lines.push('\treq.Header.Set(' + dq(h[0]) + ', ' + dq(h[1]) + ')')
  }
  if (req.form) {
    lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')
  }
  if (req.auth) {
    lines.push('\treq.SetBasicAuth(' + dq(req.auth.user) + ', ' + dq(req.auth.pass) + ')')
  }
  lines.push('')
  if (req.insecure) {
    lines.push('\tclient := &http.Client{')
    lines.push('\t\tTransport: &http.Transport{')
    lines.push('\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // --insecure (dev only)')
    lines.push('\t\t},')
    lines.push('\t}')
  } else {
    lines.push('\tclient := &http.Client{}')
  }
  if (req.follow) {
    lines.push('\t// -L: net/http follows up to 10 redirects by default')
  }
  lines.push('\tresp, err := client.Do(req)')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}')
  lines.push('\tdefer resp.Body.Close()')
  lines.push('')
  lines.push('\tbody, err := io.ReadAll(resp.Body)')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}')
  lines.push('\tfmt.Println(resp.Status)')
  lines.push('\tfmt.Println(string(body))')
  lines.push('}')
  return lines.join('\n')
}

/** baseUrl + 重新编码后的查询串 */
function buildFullUrl(req) {
  if (!queryEntries(req).length) return req.baseUrl
  const queryStr = queryEntries(req)
    .map(pair => encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]))
    .join('&')
  return req.baseUrl + '?' + queryStr
}

const GENERATORS = {
  python: genPython,
  javascript: genJavaScript,
  java: genJava,
  go: genGo,
}

/* ---------------- 组件状态 ---------------- */
const config = useStorage('tool-curl-converter-config', { lang: 'python' })
const currentLang = computed(() => LANGS.some(l => l.id === config.value.lang) ? config.value.lang : 'python')

const raw = ref('')
const debouncedRaw = ref('')
const syncDebounced = useDebounceFn(() => {
  debouncedRaw.value = raw.value
}, 300)
watch(raw, () => syncDebounced())

const parseResult = computed(() => {
  try {
    return parseCurl(debouncedRaw.value)
  } catch {
    return { ok: false, errorKey: 'parseFailed', request: null }
  }
})

const errorMessage = computed(() => {
  if (!raw.value.trim() || parseResult.value.ok) return ''
  return t('tools.curlConverter.' + (parseResult.value.errorKey || 'parseFailed'))
})

const generatedCode = computed(() => {
  const result = parseResult.value
  if (!result.ok) return ''
  try {
    const generator = GENERATORS[currentLang.value]
    return generator(result.request)
  } catch {
    return ''
  }
})

function applyExample(example) {
  raw.value = example.cmd
  debouncedRaw.value = example.cmd
}
</script>

<template>
  <ToolPage tool-id="curlConverter">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <label class="label-base mb-0" for="cc-raw">{{ t('tools.curlConverter.inputLabel') }}</label>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-400">{{ t('tools.curlConverter.examplesLabel') }}</span>
          <button
            v-for="example in EXAMPLES"
            :key="example.key"
            type="button"
            class="btn-ghost"
            @click="applyExample(example)"
          >
            {{ t(`tools.curlConverter.example${example.key}`) }}
          </button>
        </div>
      </div>
      <textarea
        id="cc-raw"
        v-model="raw"
        rows="6"
        spellcheck="false"
        class="input-base w-full font-mono"
        :placeholder="t('tools.curlConverter.inputPlaceholder')"
        :aria-label="t('tools.curlConverter.inputLabel')"
      ></textarea>
      <p v-if="errorMessage" class="mt-2 text-sm text-red-600" role="alert">{{ errorMessage }}</p>
      <p class="mt-2 text-xs text-slate-400 leading-relaxed">{{ t('tools.curlConverter.supportedHint') }}</p>
    </section>

    <!-- 语言 Tab -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.curlConverter.langLabel') }}</h2>
      <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('tools.curlConverter.langLabel')">
        <button
          v-for="lang in LANGS"
          :key="lang.id"
          type="button"
          role="tab"
          class="px-3.5 py-1.5 rounded-xl text-sm font-medium border transition select-none"
          :class="currentLang === lang.id
            ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
            : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300 hover:text-blue-600'"
          :aria-selected="currentLang === lang.id ? 'true' : 'false'"
          @click="config.lang = lang.id"
        >
          {{ t(`tools.curlConverter.${lang.labelKey}`) }}
        </button>
      </div>
    </section>

    <!-- 代码预览 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.curlConverter.outputTitle') }}</h2>
        <CopyButton :text="generatedCode" :label="t('toolsCommon.copy')" :disabled="!generatedCode" />
      </div>
      <pre v-if="generatedCode" class="cc-preview font-mono text-sm text-slate-800">{{ generatedCode }}</pre>
      <p v-else class="text-sm text-slate-400">{{ t('tools.curlConverter.emptyHint') }}</p>
    </section>
  </ToolPage>
</template>

<style scoped>
.cc-preview {
  white-space: pre;
  overflow-x: auto;
  max-height: 560px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgb(226 232 240);
  border-radius: 0.75rem;
  padding: 0.85rem 1rem;
  tab-size: 4;
}
</style>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'

/**
 * .htaccess 转 Nginx：逐行解析 Apache 指令并生成 Nginx 配置，
 * 支持 Redirect / RedirectMatch / RewriteRule / 访问控制 / 错误页 /
 * 默认首页 / Options 等常见指令；RewriteCond 上下文关联提示，
 * 无法转换或被忽略的指令连同原文行列出，供人工核对
 */

/** 示例 .htaccess：覆盖 Redirect、RewriteRule、访问控制与错误页 */
const EXAMPLE_HTACCESS = [
  'RewriteEngine On',
  'RewriteBase /',
  '',
  '# 旧页面 301 跳转',
  'Redirect 301 /old-page.html /new-page.html',
  'RedirectMatch 301 ^/blog/([0-9]{4})/(.*)$ /posts/$1/$2',
  '',
  '# 强制跳转到 HTTPS',
  'RewriteCond %{HTTPS} off',
  'RewriteRule ^(.*)$ https://www.example.com/$1 [R=301,L]',
  '',
  '# 伪静态规则',
  'RewriteRule ^article/([0-9]+)$ article.php?id=$1 [L]',
  'RewriteRule ^download/(.*)$ files/$1 [L]',
  '',
  '# 仅允许指定 IP 访问',
  'Order allow,deny',
  'Deny from all',
  'Allow from 203.0.113.7',
  '',
  '# 自定义错误页',
  'ErrorDocument 404 /404.html',
  '',
  'DirectoryIndex index.html index.php',
  'Options -Indexes',
].join('\n')

/** Apache 重定向状态字与数字状态码的映射 */
const REDIRECT_WORDS = { permanent: 301, temp: 302, seeother: 303, gone: 410 }

const { t } = useI18n()
const toast = useToast()

/** 输入内容持久化 */
const config = useStorage('tool-htaccess-to-nginx-config', { source: '' })
const source = ref(typeof config.value.source === 'string' ? config.value.source : '')
watch(source, value => {
  config.value.source = value
})

function fillExample() {
  source.value = EXAMPLE_HTACCESS
  toast.info(t('toolsCommon.done'))
}

function clearSource() {
  source.value = ''
}

function downloadNginxConf() {
  if (!result.value.output) return
  downloadText(result.value.output, 'nginx.conf', 'text/plain;charset=utf-8')
}

/** 解析 RewriteRule 方括号中的标志位 */
function parseFlags(raw) {
  const flags = { redirect: 0, noCase: false, forbidden: false, gone: false }
  const inner = String(raw || '').replace(/^\[/, '').replace(/\]$/, '')
  if (!inner) return flags
  inner.split(',').forEach(part => {
    const flag = part.trim()
    const rMatch = flag.match(/^R(?:=(\d{3}))?$/i)
    if (rMatch) {
      flags.redirect = rMatch[1] ? parseInt(rMatch[1], 10) : 302
      return
    }
    if (/^NC$/i.test(flag)) flags.noCase = true
    else if (/^F$/i.test(flag)) flags.forbidden = true
    else if (/^G$/i.test(flag)) flags.gone = true
  })
  return flags
}

/**
 * 逐行转换 .htaccess 内容（纯函数）
 * @returns {{ output: string, converted: number, issues: Array }}
 */
function convert(sourceText) {
  const directives = []
  const issues = []
  const accessRules = []
  let converted = 0
  let pendingConds = []

  const push = line => directives.push('    ' + line)
  const pushWarning = (lineNo, text, reason) => issues.push({ lineNo, text, kind: 'unsupported', reason })
  const pushIgnored = (lineNo, text, reason) => issues.push({ lineNo, text, kind: 'ignored', reason })

  /** 尚未关联到 RewriteRule 的 RewriteCond 统一列为警告 */
  const flushConds = () => {
    pendingConds.forEach(cond => pushWarning(cond.lineNo, cond.text, t('tools.htaccessToNginx.reasonCond')))
    pendingConds = []
  }

  /** Redirect / RedirectMatch：生成 location 块包裹的 return */
  function convertRedirect(rest, isMatch, line, lineNo) {
    const tokens = rest.trim().split(/\s+/)
    let status = 302
    const first = tokens[0] || ''
    const word = first.toLowerCase()
    if (/^\d{3}$/.test(first)) {
      status = parseInt(first, 10)
      tokens.shift()
    } else if (REDIRECT_WORDS[word]) {
      status = REDIRECT_WORDS[word]
      tokens.shift()
    }
    const path = tokens.shift() || ''
    const target = tokens.join(' ')
    if (!path || (status !== 410 && !target)) {
      pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonUnsupported'))
      return
    }
    push('location ' + (isMatch ? '~ ' + path : path) + ' {')
    if (status === 410) push('    return 410;')
    else push('    return ' + status + ' ' + target + ';')
    push('}')
    converted += 1
  }

  /** RewriteRule：R 标志生成 return，内部重写生成 rewrite ... last */
  function convertRewriteRule(rest, line, lineNo) {
    const parts = rest.trim().split(/\s+/)
    if (parts.length < 2) {
      pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonUnsupported'))
      return
    }
    const pattern = parts[0]
    const target = parts[1]
    const flags = parseFlags(parts.slice(2).join(' '))

    // 与本规则关联的 RewriteCond 无法自动转换：先列出提示，再继续转换规则本身
    flushConds()

    const matcher = (flags.noCase ? '~* ' : '~ ') + pattern

    // [F] 禁止访问 / [G] 已删除
    if (flags.forbidden || flags.gone) {
      push('location ' + matcher + ' {')
      push('    return ' + (flags.forbidden ? 403 : 410) + ';')
      push('}')
      converted += 1
      return
    }

    // [R=301] / [R=302] 外部重定向
    if (flags.redirect) {
      push('location ' + matcher + ' {')
      push('    return ' + flags.redirect + ' ' + target + ';')
      push('}')
      converted += 1
      return
    }

    // [L] 或无标志的内部重写
    push('rewrite ' + pattern + ' ' + target + ' last;')
    converted += 1
  }

  /** Options：仅转换 Indexes 开关，其余选项列为忽略 */
  function convertOptions(rest, line, lineNo) {
    const tokens = rest.trim().split(/\s+/)
    let handled = false
    let hasOthers = false
    tokens.forEach(token => {
      if (/^[+-]?indexes$/i.test(token)) {
        push(token.charAt(0) === '-' ? 'autoindex off;' : 'autoindex on;')
        handled = true
      } else {
        hasOthers = true
      }
    })
    if (handled) converted += 1
    if (hasOthers) pushIgnored(lineNo, line, t('tools.htaccessToNginx.reasonOption'))
  }

  /** Deny from / Allow from：收集后统一包进 location 块 */
  function convertAccess(rest, verb, line, lineNo) {
    const targets = rest.trim().split(/\s+/).filter(token => token && token.indexOf('=') === -1)
    if (!targets.length) {
      pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonUnsupported'))
      return
    }
    targets.forEach(target => accessRules.push(verb + ' ' + target + ';'))
    converted += 1
  }

  String(sourceText || '')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNo = index + 1
      const line = rawLine.trim()
      if (!line || line.charAt(0) === '#') return

      let m

      // Apache 容器标签：Nginx 用 server / location 组织，直接忽略
      if (/^<\/?(ifmodule|files|filesmatch|directory|directorymatch|location)\b/i.test(line)) {
        pushIgnored(lineNo, line, t('tools.htaccessToNginx.reasonContainer'))
        return
      }

      // RewriteEngine：Nginx rewrite 模块默认开启，忽略
      if ((m = line.match(/^rewriteengine\s+(on|off)$/i))) {
        pushIgnored(lineNo, line, t('tools.htaccessToNginx.reasonEngine'))
        return
      }

      // RewriteBase：Nginx 基于完整 URI 匹配，忽略
      if (/^rewritebase\b/i.test(line)) {
        pushIgnored(lineNo, line, t('tools.htaccessToNginx.reasonBase'))
        return
      }

      // Order：Nginx 按指令书写顺序匹配，忽略
      if (/^order\s+(allow,deny|deny,allow|mutual-failure)$/i.test(line)) {
        pushIgnored(lineNo, line, t('tools.htaccessToNginx.reasonOrder'))
        return
      }

      // RewriteCond：记录上下文，待关联的 RewriteRule 处理时统一提示
      if (/^rewritecond\b/i.test(line)) {
        pendingConds.push({ lineNo, text: line })
        return
      }

      // 注意顺序：RedirectMatch 必须先于 Redirect 判断
      if ((m = line.match(/^redirectmatch\s+(.+)$/i))) {
        convertRedirect(m[1], true, line, lineNo)
        return
      }
      if ((m = line.match(/^redirect\s+(.+)$/i))) {
        convertRedirect(m[1], false, line, lineNo)
        return
      }

      if ((m = line.match(/^rewriterule\s+(.+)$/i))) {
        convertRewriteRule(m[1], line, lineNo)
        return
      }

      // ErrorDocument 404 /404.html
      if ((m = line.match(/^errordocument\s+(\d{3})\s+(.+)$/i))) {
        const code = m[1]
        const target = m[2].trim().replace(/^["']|["']$/g, '')
        if (target.charAt(0) === '/') {
          push('error_page ' + code + ' ' + target + ';')
          converted += 1
        } else {
          pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonErrorDoc'))
        }
        return
      }

      // DirectoryIndex index.html index.php
      if ((m = line.match(/^directoryindex\s+(.+)$/i))) {
        push('index ' + m[1].trim() + ';')
        converted += 1
        return
      }

      if ((m = line.match(/^options\s+(.+)$/i))) {
        convertOptions(m[1], line, lineNo)
        return
      }

      if ((m = line.match(/^deny\s+from\s+(.+)$/i))) {
        convertAccess(m[1], 'deny', line, lineNo)
        return
      }
      if ((m = line.match(/^allow\s+from\s+(.+)$/i))) {
        convertAccess(m[1], 'allow', line, lineNo)
        return
      }

      // Header / RequestHeader 等响应头指令
      if (/^(requestheader|header)\b/i.test(line)) {
        pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonHeader'))
        return
      }

      // 其余指令无法识别
      pushWarning(lineNo, line, t('tools.htaccessToNginx.reasonUnsupported'))
    })

  // 末尾没有 RewriteRule 接收的 RewriteCond
  flushConds()

  // 访问控制统一包进 location 块
  if (accessRules.length) {
    push('location / {')
    accessRules.forEach(rule => push('    ' + rule))
    push('}')
  }

  const output = directives.length
    ? [
        '# Nginx configuration converted from .htaccess by ToolboxLab',
        '# For reference only. Review manually before enabling.',
        'server {',
        ...directives,
        '}',
      ].join('\n')
    : ''

  return { output, converted, issues }
}

const result = computed(() => convert(source.value))
</script>

<template>
  <ToolPage tool-id="htaccessToNginx">
    <!-- 输入区 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 flex-wrap mb-1.5">
        <label class="label-base !mb-0" for="htaccess-input">{{ t('tools.htaccessToNginx.inputLabel') }}</label>
        <div class="flex gap-2">
          <button type="button" class="btn-ghost" @click="fillExample">{{ t('tools.htaccessToNginx.exampleBtn') }}</button>
          <button type="button" class="btn-danger" :disabled="!source" @click="clearSource">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
      <textarea
        id="htaccess-input"
        v-model="source"
        class="input-base font-mono text-xs leading-relaxed"
        rows="12"
        :placeholder="t('tools.htaccessToNginx.inputPlaceholder')"
        spellcheck="false"
        autocomplete="off"
      ></textarea>
    </section>

    <!-- 转换结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="section-title !mb-0">{{ t('tools.htaccessToNginx.outputTitle') }}</h2>
          <span v-if="result.converted" class="chip">
            {{ t('tools.htaccessToNginx.convertedCount', { n: result.converted }) }}
          </span>
        </div>
        <div v-if="result.output" class="flex items-center gap-2">
          <CopyButton :text="result.output" :label="t('toolsCommon.copy')" />
          <button type="button" class="btn-ghost" @click="downloadNginxConf">{{ t('toolsCommon.download') }}</button>
        </div>
      </div>

      <pre
        v-if="result.output"
        class="font-mono text-xs leading-relaxed text-slate-700 bg-slate-50/80 border border-slate-200 rounded-xl p-3 sm:p-4 overflow-x-auto"
      ><code>{{ result.output }}</code></pre>
      <p v-else class="py-8 text-center text-sm text-slate-400">{{ t('tools.htaccessToNginx.emptyInput') }}</p>
    </section>

    <!-- 未转换指令警告列表 -->
    <section v-if="result.issues.length" class="glass-card p-4 sm:p-6 mb-4 !bg-amber-50/60 !border-amber-100">
      <div class="flex items-center gap-2 flex-wrap mb-1">
        <h2 class="section-title !mb-0 text-amber-700">{{ t('tools.htaccessToNginx.unconvertedTitle') }}</h2>
        <span class="chip !bg-amber-100 !text-amber-700 !border-amber-200">
          {{ t('tools.htaccessToNginx.unconvertedCount', { n: result.issues.length }) }}
        </span>
      </div>
      <ul class="divide-y divide-amber-100">
        <li v-for="(issue, index) in result.issues" :key="index" class="py-2.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="chip !bg-white/80 !text-slate-500 !border-slate-200 font-mono">
              {{ t('tools.htaccessToNginx.lineNo', { n: issue.lineNo }) }}
            </span>
            <span
              class="px-2 py-0.5 rounded-full text-xs font-medium border"
              :class="
                issue.kind === 'ignored'
                  ? 'bg-slate-100 text-slate-500 border-slate-200'
                  : 'bg-amber-100 text-amber-700 border-amber-200'
              "
            >
              {{ issue.kind === 'ignored' ? t('tools.htaccessToNginx.kindIgnored') : t('tools.htaccessToNginx.kindUnsupported') }}
            </span>
          </div>
          <p class="mt-1 font-mono text-xs text-slate-700 break-all">{{ issue.text }}</p>
          <p class="mt-0.5 text-xs text-slate-500 leading-relaxed">{{ issue.reason }}</p>
        </li>
      </ul>
      <div class="mt-3 pt-3 border-t border-amber-100 flex items-start gap-2" role="note">
        <svg
          class="w-4 h-4 shrink-0 mt-0.5 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p class="text-sm font-medium text-amber-700">{{ t('tools.htaccessToNginx.warnTitle') }}</p>
          <p class="mt-0.5 text-xs text-amber-700/80 leading-relaxed">{{ t('tools.htaccessToNginx.warnText') }}</p>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

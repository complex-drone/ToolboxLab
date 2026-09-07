<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'
import { downloadText } from '@/utils/download'
import { byteLength, formatBytes } from '@/utils/format'

const { t } = useI18n()
const toast = useToast()

/**
 * 级别与选项持久化；输入代码可能含敏感信息，不做持久化
 */
const config = useStorage('tool-js-obfuscator-config', {
  level: 'low',
  dropConsole: false,
  encodeStrings: false,
})

const LEVELS = ['low', 'mid', 'high']

/** 存储值安全读取层：被破坏时回退默认值，不让页面崩溃 */
const levelModel = computed({
  get: () => (LEVELS.includes(config.value.level) ? config.value.level : 'low'),
  set: v => {
    config.value.level = LEVELS.includes(v) ? v : 'low'
  },
})
const dropConsoleModel = computed({
  get: () => config.value.dropConsole === true,
  set: v => {
    config.value.dropConsole = v === true
  },
})
const encodeStringsModel = computed({
  get: () => config.value.encodeStrings === true,
  set: v => {
    config.value.encodeStrings = v === true
  },
})

const code = ref('')
const output = ref('')
const outputMode = ref('') // 'obfuscate' | 'format'
const stats = ref(null) // { original, processed, savedPercent }
const inlineError = ref('')
const busy = ref(false)

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/* ------------------------------------------------------------------ */
/* terser 动态加载（main.js 为浏览器可用 ESM，minify 为命名导出）        */
/* ------------------------------------------------------------------ */
let minifyFn = null
async function loadMinify() {
  if (typeof minifyFn === 'function') return minifyFn
  const mod = await import('terser')
  const fn =
    typeof mod.minify === 'function'
      ? mod.minify
      : mod.default && typeof mod.default.minify === 'function'
        ? mod.default.minify
        : null
  if (typeof fn !== 'function') throw new Error('terser minify unavailable')
  minifyFn = fn
  return fn
}

/* ------------------------------------------------------------------ */
/* 轻度压缩：状态机剥离注释，正确跳过字符串/模板字符串（含 ${} 嵌套）    */
/* 局限：不解析正则字面量，正则中出现连续斜杠或块注释符可能误判          */
/* ------------------------------------------------------------------ */
function stripCommentsAndBlank(src) {
  const n = src.length
  let out = ''
  let i = 0
  let state = 'code' // code | sq | dq | tpl | line | block
  let retState = 'code' // 字符串/注释结束后回到的状态（code 或 expr）
  const frames = [] // 'tpl'（模板字符串）或 { depth }（模板内 ${ } 花括号计数）
  while (i < n) {
    const ch = src[i]
    const next = i + 1 < n ? src[i + 1] : ''
    if (state === 'code' || state === 'expr') {
      const cur = state
      if (ch === '/' && next === '/') {
        retState = cur
        state = 'line'
        i += 2
        continue
      }
      if (ch === '/' && next === '*') {
        retState = cur
        state = 'block'
        i += 2
        continue
      }
      if (ch === "'" || ch === '"') {
        retState = cur
        state = ch === "'" ? 'sq' : 'dq'
        out += ch
        i++
        continue
      }
      if (ch === '`') {
        frames.push('tpl')
        state = 'tpl'
        out += ch
        i++
        continue
      }
      if (cur === 'expr') {
        const top = frames[frames.length - 1]
        if (ch === '{') {
          top.depth++
          out += ch
          i++
          continue
        }
        if (ch === '}') {
          if (top.depth === 0) {
            frames.pop()
            state = 'tpl'
            out += ch
            i++
            continue
          }
          top.depth--
          out += ch
          i++
          continue
        }
      }
      out += ch
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      if (ch === '\\') {
        out += ch + next
        i += 2
        continue
      }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) {
        state = retState
      }
      out += ch
      i++
      continue
    }
    if (state === 'tpl') {
      if (ch === '\\') {
        out += ch + next
        i += 2
        continue
      }
      if (ch === '`') {
        frames.pop()
        const top = frames[frames.length - 1]
        state = top && typeof top === 'object' ? 'expr' : 'code'
        out += ch
        i++
        continue
      }
      if (ch === '$' && next === '{') {
        frames.push({ depth: 0 })
        state = 'expr'
        out += '${'
        i += 2
        continue
      }
      out += ch
      i++
      continue
    }
    if (state === 'line') {
      if (ch === '\n' || ch === '\r') {
        state = retState
        out += ch
      }
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = retState
        i += 2
        continue
      }
      i++
      continue
    }
  }
  return out
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ */
/* 重度选项：把长度 ≥8 的简单单双引号字符串字面量替换为 atob('...')      */
/* 仅处理简单场景：不在模板字符串内部、内容无转义符、btoa 可编码、        */
/* 闭合引号后不是冒号（避免破坏对象键）。                                */
/* ------------------------------------------------------------------ */
function collectStringRanges(codeText) {
  const n = codeText.length
  const ranges = []
  let i = 0
  let state = 'code' // code | sq | dq | tpl | expr | skipLine | skipBlock
  let retState = 'code'
  let strStart = -1
  const frames = []
  while (i < n) {
    const ch = codeText[i]
    const next = i + 1 < n ? codeText[i + 1] : ''
    if (state === 'code' || state === 'expr') {
      const cur = state
      if (ch === '/' && next === '/') {
        retState = cur
        state = 'skipLine'
        i += 2
        continue
      }
      if (ch === '/' && next === '*') {
        retState = cur
        state = 'skipBlock'
        i += 2
        continue
      }
      if (ch === "'" || ch === '"') {
        retState = cur
        state = ch === "'" ? 'sq' : 'dq'
        strStart = i
        i++
        continue
      }
      if (ch === '`') {
        frames.push('tpl')
        state = 'tpl'
        i++
        continue
      }
      if (cur === 'expr') {
        const top = frames[frames.length - 1]
        if (ch === '{') {
          top.depth++
          i++
          continue
        }
        if (ch === '}') {
          if (top.depth === 0) {
            frames.pop()
            state = 'tpl'
            i++
            continue
          }
          top.depth--
          i++
          continue
        }
      }
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) {
        const end = i + 1
        let j = end
        while (j < n && (codeText[j] === ' ' || codeText[j] === '\t' || codeText[j] === '\n' || codeText[j] === '\r')) j++
        const content = codeText.slice(strStart + 1, i)
        if (
          frames.length === 0 &&
          codeText[j] !== ':' &&
          content.length >= 8 &&
          !content.includes('\\')
        ) {
          try {
            ranges.push({ start: strStart, end, b64: btoa(content) })
          } catch {
            /* 非 Latin-1 内容 btoa 失败，跳过 */
          }
        }
        state = retState
      }
      i++
      continue
    }
    if (state === 'tpl') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') {
        frames.pop()
        const top = frames[frames.length - 1]
        state = top && typeof top === 'object' ? 'expr' : 'code'
        i++
        continue
      }
      if (ch === '$' && next === '{') {
        frames.push({ depth: 0 })
        state = 'expr'
        i += 2
        continue
      }
      i++
      continue
    }
    if (state === 'skipLine') {
      if (ch === '\n' || ch === '\r') state = retState
      i++
      continue
    }
    if (state === 'skipBlock') {
      if (ch === '*' && next === '/') {
        state = retState
        i += 2
        continue
      }
      i++
      continue
    }
  }
  return ranges
}

function encodeStringsWithBase64(codeText) {
  try {
    const ranges = collectStringRanges(codeText)
    let out = codeText
    for (let r = ranges.length - 1; r >= 0; r--) {
      const { start, end, b64 } = ranges[r]
      out = out.slice(0, start) + "atob('" + b64 + "')" + out.slice(end)
    }
    return out
  } catch {
    return codeText
  }
}

/* ------------------------------------------------------------------ */
/* 执行与统计                                                          */
/* ------------------------------------------------------------------ */
function terserErrorText(err) {
  const msg = err && err.message ? err.message : String(err)
  if (err && typeof err.line === 'number') {
    const col = typeof err.col === 'number' ? err.col : 0
    return `${msg} (${t('tools.jsObfuscator.errAtLine', { line: err.line, col })})`
  }
  return msg
}

function computeStats(src, result) {
  const original = byteLength(src)
  const processed = byteLength(result)
  const savedPercent = original > 0 ? Math.round((1 - processed / original) * 1000) / 10 : 0
  return { original, processed, savedPercent }
}

function resetOutput() {
  output.value = ''
  outputMode.value = ''
  stats.value = null
}

async function runObfuscate() {
  const src = code.value
  inlineError.value = ''
  if (!src.trim()) {
    resetOutput()
    return
  }
  busy.value = true
  try {
    let result = ''
    if (levelModel.value === 'low') {
      result = stripCommentsAndBlank(src)
    } else {
      const minify = await loadMinify()
      const opts =
        levelModel.value === 'mid'
          ? { mangle: true, compress: true }
          : {
              mangle: { toplevel: true },
              compress: { passes: 2, drop_console: dropConsoleModel.value },
            }
      const res = await minify(src, opts)
      result = res && typeof res.code === 'string' ? res.code : ''
      if (levelModel.value === 'high' && encodeStringsModel.value && result) {
        result = encodeStringsWithBase64(result)
      }
    }
    output.value = result
    outputMode.value = 'obfuscate'
    stats.value = computeStats(src, result)
    toast.success(t('toolsCommon.done'))
  } catch (err) {
    resetOutput()
    inlineError.value = terserErrorText(err)
    toast.error(t('toolsCommon.invalidInput'))
  } finally {
    busy.value = false
  }
}

async function runFormat() {
  const src = code.value
  inlineError.value = ''
  if (!src.trim()) {
    resetOutput()
    return
  }
  busy.value = true
  try {
    const minify = await loadMinify()
    const res = await minify(src, {
      compress: false,
      mangle: false,
      format: { beautify: true },
    })
    const result = res && typeof res.code === 'string' ? res.code : ''
    output.value = result
    outputMode.value = 'format'
    stats.value = computeStats(src, result)
    toast.success(t('toolsCommon.done'))
  } catch (err) {
    resetOutput()
    inlineError.value = terserErrorText(err)
    toast.error(t('toolsCommon.invalidInput'))
  } finally {
    busy.value = false
  }
}

function downloadOutput() {
  if (!output.value) return
  const name = outputMode.value === 'format' ? 'js-formatted.js' : 'js-obfuscated.js'
  try {
    downloadText(output.value, name, 'text/javascript;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function clearAll() {
  code.value = ''
  inlineError.value = ''
  resetOutput()
}
</script>

<template>
  <ToolPage tool-id="jsObfuscator">
    <!-- 输入与选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between gap-2 mb-2">
        <label class="label-base mb-0" for="js-ob-input">{{ t('tools.jsObfuscator.inputCode') }}</label>
        <button type="button" class="btn-ghost" @click="clearAll">{{ t('toolsCommon.clear') }}</button>
      </div>
      <textarea
        id="js-ob-input"
        v-model="code"
        rows="10"
        spellcheck="false"
        autocomplete="off"
        class="input-base w-full font-mono"
        :placeholder="t('tools.jsObfuscator.codePlaceholder')"
        :aria-label="t('tools.jsObfuscator.inputCode')"
      ></textarea>

      <div class="section-title mt-4">{{ t('tools.jsObfuscator.level') }}</div>
      <div class="grid gap-2 sm:grid-cols-3">
        <label
          v-for="lv in LEVELS"
          :key="lv"
          class="chip cursor-pointer items-start"
          :class="{ 'ring-1 ring-blue-400': levelModel === lv }"
        >
          <input
            v-model="levelModel"
            type="radio"
            name="js-ob-level"
            :value="lv"
            class="mt-0.5 accent-blue-600"
          />
          <span class="min-w-0">
            <span class="block font-semibold text-slate-700">{{ t(`tools.jsObfuscator.level${cap(lv)}`) }}</span>
            <span class="block text-xs font-normal text-slate-500">{{ t(`tools.jsObfuscator.level${cap(lv)}Hint`) }}</span>
          </span>
        </label>
      </div>

      <!-- 重度级别附加选项 -->
      <div v-if="levelModel === 'high'" class="mt-3 flex flex-col items-start gap-2">
        <label class="chip cursor-pointer">
          <input v-model="dropConsoleModel" type="checkbox" class="mr-1 accent-blue-600" />
          <span>{{ t('tools.jsObfuscator.dropConsole') }}</span>
        </label>
        <label class="chip cursor-pointer">
          <input v-model="encodeStringsModel" type="checkbox" class="mr-1 accent-blue-600" />
          <span>{{ t('tools.jsObfuscator.encodeStrings') }}</span>
        </label>
        <p v-if="encodeStringsModel" class="text-xs text-amber-600">{{ t('tools.jsObfuscator.encodeLimit') }}</p>
      </div>
      <p v-if="levelModel === 'low'" class="mt-3 text-xs text-amber-600">{{ t('tools.jsObfuscator.lowLimit') }}</p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary" :disabled="busy || !code.trim()" @click="runObfuscate">
          {{ busy ? t('toolsCommon.processing') : t('tools.jsObfuscator.run') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="busy || !code.trim()" @click="runFormat">
          {{ t('tools.jsObfuscator.formatBtn') }}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.jsObfuscator.formatNote') }}</p>

      <p v-if="inlineError" class="mt-2 text-red-600 text-sm break-all" role="alert">
        {{ t('tools.jsObfuscator.parseError') }}: {{ inlineError }}
      </p>
    </section>

    <!-- 输出与体积对比 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('toolsCommon.output') }}</h2>
        <span v-if="output" class="chip">
          {{ outputMode === 'format' ? t('tools.jsObfuscator.outputModeFormat') : t('tools.jsObfuscator.outputModeObfuscate') }}
        </span>
      </div>

      <div v-if="stats" class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="rounded-xl border border-slate-100 bg-white/70 p-2">
          <div class="text-xs text-slate-400">{{ t('tools.jsObfuscator.statOriginal') }}</div>
          <div class="font-mono text-sm font-semibold text-slate-700">{{ formatBytes(stats.original) }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-2">
          <div class="text-xs text-slate-400">{{ t('tools.jsObfuscator.statProcessed') }}</div>
          <div class="font-mono text-sm font-semibold text-slate-700">{{ formatBytes(stats.processed) }}</div>
        </div>
        <div class="rounded-xl border border-slate-100 bg-white/70 p-2">
          <div class="text-xs text-slate-400">{{ t('tools.jsObfuscator.statRatio') }}</div>
          <div class="font-mono text-sm font-semibold" :class="stats.savedPercent >= 0 ? 'text-green-600' : 'text-amber-600'">
            {{ stats.savedPercent >= 0 ? '-' : '+' }}{{ Math.abs(stats.savedPercent) }}%
          </div>
        </div>
      </div>

      <template v-if="output">
        <div class="rounded-xl border border-slate-200 bg-white/80 p-3 max-h-96 overflow-y-auto">
          <pre class="font-mono text-xs text-slate-800 whitespace-pre-wrap break-all">{{ output }}</pre>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton :text="output" :label="t('toolsCommon.copy')" />
          <button type="button" class="btn-ghost" @click="downloadOutput">{{ t('toolsCommon.download') }}</button>
        </div>
      </template>
      <p v-else class="text-sm text-slate-400">{{ t('tools.jsObfuscator.emptyHint') }}</p>
    </section>
  </ToolPage>
</template>

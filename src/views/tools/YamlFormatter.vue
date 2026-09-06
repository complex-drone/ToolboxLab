<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'

/**
 * YAML 格式化 & 校验
 * - 三种模式：YAML 格式化 / YAML → JSON / JSON → YAML
 * - js-yaml load + dump 实现格式化，indent 2/4 可选
 * - YAMLException.mark（0 基）+1 换算为「第 X 行 第 Y 列」
 * - 输入防抖 300ms 实时校验，结果区带复制/下载
 */
const { t } = useI18n()
const toast = useToast()

const MODES = ['format', 'yaml2json', 'json2yaml']

const config = useStorage('tool-yaml-formatter-config', {
  mode: 'format',
  indent: 2,
})
// 防止持久化数据异常
if (!MODES.includes(config.value.mode)) config.value.mode = 'format'
if (![2, 4].includes(config.value.indent)) config.value.indent = 2

const input = ref('')
const output = ref('')
const errorMsg = ref('')
const errorPos = ref('')
const busy = ref(false)
// 用于只在错误首次出现时弹 toast，避免逐键弹窗
const hadError = ref(false)

/** 示例：嵌套 map + list */
const EXAMPLE_YAML = [
  'name: ToolboxLab',
  'version: 2',
  'features:',
  '  - name: formatter',
  '    enabled: true',
  '    options:',
  '      indent: 2',
  '      sortKeys: false',
  '  - name: validator',
  '    enabled: false',
  'server:',
  '  host: 127.0.0.1',
  '  port: 8080',
  '  tls:',
  '    enabled: true',
  '    cert: /etc/ssl/toolboxlab.pem',
  'tags:',
  '  - fast',
  '  - offline',
  '  - privacy',
].join('\n')

const EXAMPLE_JSON = JSON.stringify(
  {
    name: 'ToolboxLab',
    version: 2,
    features: [
      { name: 'formatter', enabled: true, options: { indent: 2, sortKeys: false } },
      { name: 'validator', enabled: false },
    ],
    server: { host: '127.0.0.1', port: 8080, tls: { enabled: true, cert: '/etc/ssl/toolboxlab.pem' } },
    tags: ['fast', 'offline', 'privacy'],
  },
  null,
  2
)

const inputKind = computed(() => (config.value.mode === 'json2yaml' ? 'json' : 'yaml'))
const outputKind = computed(() => (config.value.mode === 'yaml2json' ? 'json' : 'yaml'))

const inputPlaceholder = computed(() =>
  inputKind.value === 'json'
    ? t('tools.yamlFormatter.jsonPlaceholder')
    : t('tools.yamlFormatter.yamlPlaceholder')
)

const inputLines = computed(() => (input.value ? input.value.split('\n').length : 0))
const outputLines = computed(() => (output.value ? output.value.split('\n').length : 0))

/** 由字符偏移量换算行列（均从 1 计） */
function posFromOffset(text, offset) {
  const before = text.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/**
 * 生成带行列定位的错误描述
 * js-yaml 的 mark.line / mark.column 从 0 计，需 +1
 */
function describeError(e, src) {
  if (e && e.mark && typeof e.mark.line === 'number') {
    return {
      pos: t('tools.yamlFormatter.errorAt', {
        line: e.mark.line + 1,
        column: (typeof e.mark.column === 'number' ? e.mark.column : 0) + 1,
      }),
      message: e.reason || e.message || String(e),
    }
  }
  // JSON.parse 的错误消息通常带 position
  const msg = e && e.message ? e.message : String(e)
  const m = /position (\d+)/i.exec(msg)
  if (m) {
    const { line, column } = posFromOffset(src, Number(m[1]))
    return { pos: t('tools.yamlFormatter.errorAt', { line, column }), message: msg }
  }
  return { pos: '', message: msg }
}

let evalSeq = 0

async function run() {
  const seq = ++evalSeq
  const src = input.value
  errorMsg.value = ''
  errorPos.value = ''
  if (!src.trim()) {
    output.value = ''
    hadError.value = false
    return
  }
  busy.value = true
  try {
    // 1. 解析输入
    let data
    try {
      if (inputKind.value === 'json') {
        data = JSON.parse(src)
      } else {
        const yaml = await import('js-yaml')
        data = yaml.load(src)
        if (data === undefined) data = null
      }
    } catch (e) {
      const d = describeError(e, src)
      throw Object.assign(new Error(d.message), { posText: d.pos })
    }
    // 2. 序列化输出
    let text
    if (outputKind.value === 'json') {
      text = JSON.stringify(data, null, config.value.indent)
    } else {
      const yaml = await import('js-yaml')
      text = yaml.dump(data, { indent: config.value.indent, skipInvalid: true, lineWidth: -1 })
    }
    if (seq !== evalSeq) return
    output.value = text
    hadError.value = false
  } catch (e) {
    if (seq !== evalSeq) return
    output.value = ''
    errorMsg.value = e && e.message ? e.message : t('toolsCommon.error')
    errorPos.value = (e && e.posText) || ''
    if (!hadError.value) {
      toast.error(
        inputKind.value === 'json'
          ? t('tools.yamlFormatter.parseErrorJson')
          : t('tools.yamlFormatter.parseErrorYaml')
      )
    }
    hadError.value = true
  } finally {
    if (seq === evalSeq) busy.value = false
  }
}

watchDebounced([input, () => config.value.mode, () => config.value.indent], run, { debounce: 300 })
onMounted(run)

function loadExample() {
  input.value = config.value.mode === 'json2yaml' ? EXAMPLE_JSON : EXAMPLE_YAML
  errorMsg.value = ''
  errorPos.value = ''
}

function clearAll() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
  errorPos.value = ''
  hadError.value = false
}

function downloadOutput() {
  if (!output.value) return
  if (outputKind.value === 'json') {
    downloadText(output.value, 'converted.json', 'application/json;charset=utf-8')
  } else {
    const name = config.value.mode === 'format' ? 'formatted.yaml' : 'converted.yaml'
    downloadText(output.value, name, 'application/yaml;charset=utf-8')
  }
}
</script>

<template>
  <ToolPage tool-id="yamlFormatter">
    <!-- 模式与选项 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <span class="label-base">{{ t('tools.yamlFormatter.modeLabel') }}</span>
      <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('tools.yamlFormatter.modeLabel')">
        <button
          v-for="m in MODES"
          :key="m"
          type="button"
          role="tab"
          :aria-selected="config.mode === m"
          class="px-3 py-1.5 rounded-lg text-sm font-medium transition select-none border"
          :class="
            config.mode === m
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white/70 text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          @click="config.mode = m"
        >
          {{ t(`tools.yamlFormatter.mode_${m}`) }}
        </button>
      </div>

      <div class="flex flex-wrap items-end gap-3 mt-4">
        <div>
          <label for="yaml-indent" class="label-base">{{ t('tools.yamlFormatter.indent') }}</label>
          <select id="yaml-indent" v-model.number="config.indent" class="input-base w-32">
            <option :value="2">{{ t('tools.yamlFormatter.indentSpaces', { n: 2 }) }}</option>
            <option :value="4">{{ t('tools.yamlFormatter.indentSpaces', { n: 4 }) }}</option>
          </select>
        </div>
        <div class="flex gap-2 sm:ml-auto">
          <button type="button" class="btn-ghost" @click="loadExample">
            {{ t('toolsCommon.example') }}
          </button>
          <button type="button" class="btn-danger" @click="clearAll">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>

      <p class="mt-3 text-xs text-slate-400">{{ t('tools.yamlFormatter.liveHint') }}</p>
    </section>

    <!-- 输入 / 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <label for="yaml-input" class="label-base flex-1 mb-0">
              {{ t('toolsCommon.input') }}（{{ t(`tools.yamlFormatter.${inputKind}`) }}）
            </label>
            <span class="chip">{{ input.length }} {{ t('toolsCommon.chars') }}</span>
            <span class="chip">{{ inputLines }} {{ t('toolsCommon.lines') }}</span>
          </div>
          <textarea
            id="yaml-input"
            v-model="input"
            class="input-base w-full font-mono h-64 resize-y"
            :placeholder="inputPlaceholder"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">
              {{ t('toolsCommon.output') }}（{{ t(`tools.yamlFormatter.${outputKind}`) }}）
            </span>
            <span class="chip">{{ output.length }} {{ t('toolsCommon.chars') }}</span>
            <span class="chip">{{ outputLines }} {{ t('toolsCommon.lines') }}</span>
            <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
            <button type="button" class="btn-ghost" :disabled="!output" @click="downloadOutput">
              {{ t('toolsCommon.download') }}
            </button>
          </div>
          <textarea
            id="yaml-output"
            :value="output"
            readonly
            class="input-base w-full font-mono h-64 resize-y bg-slate-50/80"
            :aria-label="t('toolsCommon.output')"
            :placeholder="t('tools.yamlFormatter.outputPlaceholder')"
          ></textarea>
        </div>
      </div>

      <!-- 行内错误提示 -->
      <div
        v-if="errorMsg"
        class="mt-3 rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-sm text-red-600"
        role="alert"
      >
        <p v-if="errorPos" class="font-semibold">{{ errorPos }}</p>
        <p class="break-all">{{ errorMsg }}</p>
      </div>
      <p v-else-if="busy" class="mt-3 text-xs text-slate-400">{{ t('toolsCommon.processing') }}</p>
    </section>
  </ToolPage>
</template>

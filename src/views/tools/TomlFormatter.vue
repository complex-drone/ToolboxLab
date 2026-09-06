<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * TOML 格式化 & 校验
 * - smol-toml 动态加载：parse / stringify（原生 ESM、无 Node 依赖、无 eval）
 * - 双向：TOML => JSON 与 JSON => TOML；输出 = parse 后 stringify 的格式化 TOML + JSON
 * - 300ms 防抖实时校验；TOML 错误对象含 line/col 时显示行列位置，否则显示原始消息
 */
const { t } = useI18n()

const config = useStorage('tool-toml-formatter-config', {
  direction: 'toml2json', // 'toml2json' | 'json2toml'
  indent: 2, // JSON 输出缩进
})

const input = ref('')
const formattedToml = ref('')
const jsonOutput = ref('')
const errorMsg = ref('')
const valid = ref(false)

/** 示例 TOML（含 table、嵌套 table、数组与内联表） */
const EXAMPLE_TOML = [
  'title = "ToolboxLab"',
  '',
  '[owner]',
  'name = "Alice"',
  'dob = 1979-05-27T07:32:00Z',
  '',
  '[database]',
  'enabled = true',
  'ports = [8000, 8001, 8002]',
  'data = [["delta", "phi"], [3.14]]',
  'temp_targets = { cpu = 79.5, case = 72.0 }',
  '',
  '[servers.alpha]',
  'ip = "10.0.0.1"',
  '',
  '[servers.beta]',
  'ip = "10.0.0.2"',
].join('\n')

let tomlModule = null

/** 按需动态加载 smol-toml（原生 ESM 命名导出；TomlError 自带 line/column 行定位） */
async function loadToml() {
  if (tomlModule) return tomlModule
  const mod = await import('smol-toml')
  tomlModule = mod && mod.default ? mod.default : mod
  if (!tomlModule || typeof tomlModule.parse !== 'function') {
    throw new Error('toml module unavailable')
  }
  return tomlModule
}

/** 拼装错误信息：优先使用 line/col 定位，缺失时回退原始消息 */
function describeError(e) {
  const msg = e && e.message ? e.message : String(e || t('toolsCommon.error'))
  try {
    const line = e && typeof e.line === 'number' ? e.line : null
    const col = e
      ? typeof e.col === 'number'
        ? e.col
        : typeof e.column === 'number'
          ? e.column
          : null
      : null
    if (line !== null && col !== null) {
      return (
        t('tools.tomlFormatter.positionHint').replace('%1', String(line)).replace('%2', String(col)) +
        ' ' +
        msg
      )
    }
  } catch {
    // 忽略错误描述自身的异常，回退原始消息
  }
  return msg
}

let runToken = 0

/** 防抖后的实际执行：解析 + 校验 + 生成两份格式化输出 */
async function run() {
  const token = ++runToken
  const text = input.value
  formattedToml.value = ''
  jsonOutput.value = ''
  errorMsg.value = ''
  valid.value = false
  if (!text.trim()) return

  let TOML
  try {
    TOML = await loadToml()
  } catch (e) {
    if (token !== runToken) return
    errorMsg.value = t('toolsCommon.networkError')
    return
  }

  try {
    let data
    if (config.value.direction === 'json2toml') {
      data = JSON.parse(text)
    } else {
      data = TOML.parse(text)
    }
    const tomlText = TOML.stringify(data)
    const jsonText = JSON.stringify(data, null, config.value.indent)
    if (token !== runToken) return
    formattedToml.value = tomlText
    jsonOutput.value = jsonText
    valid.value = true
  } catch (e) {
    if (token !== runToken) return
    errorMsg.value = describeError(e)
  }
}

// 输入 / 方向 / 缩进变化时 300ms 防抖实时校验与格式化
watchDebounced([input, config], run, { debounce: 300 })

function loadExample() {
  input.value = EXAMPLE_TOML
  errorMsg.value = ''
}

function clearInput() {
  input.value = ''
}

function swapDirection() {
  if (!formattedToml.value && !jsonOutput.value) {
    config.value.direction = config.value.direction === 'toml2json' ? 'json2toml' : 'toml2json'
    return
  }
  const nextInput =
    config.value.direction === 'toml2json' ? jsonOutput.value : formattedToml.value
  config.value.direction = config.value.direction === 'toml2json' ? 'json2toml' : 'toml2json'
  input.value = nextInput
}

const inputFormatLabel = computed(() =>
  config.value.direction === 'toml2json'
    ? t('tools.tomlFormatter.toml')
    : t('tools.tomlFormatter.json')
)

const hasOutput = computed(() => formattedToml.value.length > 0 || jsonOutput.value.length > 0)
</script>

<template>
  <ToolPage tool-id="tomlFormatter">
    <!-- 方向 / 缩进 / 状态 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <div class="label-base">{{ t('tools.tomlFormatter.direction') }}</div>
          <div class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/70 p-1">
            <button
              type="button"
              :class="config.direction === 'toml2json' ? 'btn-primary' : 'btn-ghost border-0 bg-transparent shadow-none'"
              @click="config.direction = 'toml2json'"
            >
              {{ t('tools.tomlFormatter.dirTomlToJson') }}
            </button>
            <button
              type="button"
              :class="config.direction === 'json2toml' ? 'btn-primary' : 'btn-ghost border-0 bg-transparent shadow-none'"
              @click="config.direction = 'json2toml'"
            >
              {{ t('tools.tomlFormatter.dirJsonToToml') }}
            </button>
          </div>
        </div>
        <div class="w-28">
          <label for="toml-indent" class="label-base">{{ t('tools.tomlFormatter.jsonIndent') }}</label>
          <select id="toml-indent" v-model.number="config.indent" class="input-base">
            <option :value="2">2</option>
            <option :value="4">4</option>
          </select>
        </div>
        <div class="ml-auto flex items-center gap-2 pb-1">
          <span v-if="valid" class="chip bg-green-50 text-green-600 border-green-100">
            {{ t('tools.tomlFormatter.valid') }}
          </span>
          <span v-else-if="errorMsg" class="chip bg-red-50 text-red-600 border-red-100">
            {{ t('tools.tomlFormatter.invalid') }}
          </span>
          <button type="button" class="btn-ghost" @click="swapDirection">
            {{ t('toolsCommon.swap') }}
          </button>
          <button type="button" class="btn-ghost" @click="loadExample">
            {{ t('toolsCommon.example') }}
          </button>
          <button type="button" class="btn-danger" @click="clearInput">
            {{ t('toolsCommon.clear') }}
          </button>
        </div>
      </div>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="toml-input" class="label-base">
        {{ t('toolsCommon.input') }}（{{ inputFormatLabel }}）
      </label>
      <textarea
        id="toml-input"
        v-model="input"
        class="input-base w-full font-mono h-64 resize-y"
        :placeholder="t('tools.tomlFormatter.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
    </section>

    <!-- 输出：格式化 TOML + JSON -->
    <section v-if="hasOutput" class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.tomlFormatter.formattedToml') }}</span>
            <CopyButton :text="formattedToml" :label="t('toolsCommon.copy')" :disabled="!formattedToml" />
          </div>
          <pre
            class="font-mono text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-auto h-64 text-slate-700 whitespace-pre"
          >{{ formattedToml || t('toolsCommon.none') }}</pre>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="label-base flex-1 mb-0">{{ t('tools.tomlFormatter.jsonOutput') }}</span>
            <CopyButton :text="jsonOutput" :label="t('toolsCommon.copy')" :disabled="!jsonOutput" />
          </div>
          <pre
            class="font-mono text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-auto h-64 text-slate-700 whitespace-pre"
          >{{ jsonOutput || t('toolsCommon.none') }}</pre>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

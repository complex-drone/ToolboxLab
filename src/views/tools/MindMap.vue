<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import { downloadText, readFileAsText } from '@/utils/download'

/**
 * 思维导图：mind-elixir@4（懒加载，dist 产物自带样式注入，无需额外 CSS）
 * - 初始数据按当前语言生成，语言切换仅影响之后的「重置」结果
 * - 导出：instance.getData()（v4 实际 API，非 getAllData）+ downloadText
 * - 导入：文件或粘贴，先 JSON.parse 与结构校验，再 instance.refresh(data)
 * - 工具栏：toCenter() 居中 / scaleFit() 缩放重置；卸载时 destroy()
 */
const { t, locale } = useI18n()
const toast = useToast()

const containerRef = ref(null)
const ready = ref(false)
const initFailed = ref(false)
const showImport = ref(false)
const importMode = ref('file')
const pasteText = ref('')
const importError = ref('')
const fileRef = ref(null)

let mind = null
let uidCounter = 0

function uid() {
  uidCounter += 1
  return 'me-' + Date.now().toString(36) + '-' + uidCounter + '-' + Math.random().toString(36).slice(2, 6)
}

/* ---------- 初始数据（按当前语言生成） ---------- */
function buildDefaultData() {
  return {
    nodeData: {
      id: 'me-root',
      topic: t('tools.mindMap.rootTopic'),
      children: [
        {
          id: 'me-child-1',
          topic: t('tools.mindMap.childTopic1'),
          children: [{ id: 'me-child-1-1', topic: t('tools.mindMap.childTopic3') }],
        },
        { id: 'me-child-2', topic: t('tools.mindMap.childTopic2') },
        { id: 'me-child-3', topic: t('tools.mindMap.childTopic1') },
      ],
    },
  }
}

/* ---------- 初始化 ---------- */
function mapLocale(currentLocale) {
  return currentLocale === 'en-US' ? 'en' : 'zh_CN'
}

async function initMindMap() {
  if (!containerRef.value || mind) return
  let MindElixirCtor
  try {
    const mod = await import('mind-elixir')
    MindElixirCtor = mod.default || mod
  } catch (e) {
    initFailed.value = true
    toast.error(t('toolsCommon.networkError'))
    return
  }
  try {
    mind = new MindElixirCtor({
      el: containerRef.value,
      direction: typeof MindElixirCtor.SIDE === 'number' ? MindElixirCtor.SIDE : 2,
      locale: mapLocale(locale.value),
      draggable: true,
      editable: true,
      contextMenu: true,
      toolBar: false,
      keypress: true,
      allowUndo: true,
      overflowHidden: false,
    })
    mind.init(buildDefaultData())
    ready.value = true
  } catch (e) {
    mind = null
    initFailed.value = true
    toast.error(t('tools.mindMap.initFailed'))
  }
}

onMounted(() => {
  initMindMap()
})

onBeforeUnmount(() => {
  if (mind) {
    try {
      mind.destroy()
    } catch (e) {
      /* 忽略销毁异常 */
    }
    mind = null
  }
})

/* ---------- 工具栏动作 ---------- */
function centerMap() {
  if (!mind) return
  try {
    mind.toCenter()
  } catch (e) {
    /* 忽略 */
  }
}

function fitMap() {
  if (!mind) return
  try {
    mind.scaleFit()
  } catch (e) {
    /* 忽略 */
  }
}

function resetMap() {
  if (!mind) return
  try {
    mind.refresh(buildDefaultData())
    mind.toCenter()
    toast.success(t('tools.mindMap.resetSuccess'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

/* ---------- 导出 / 导入 ---------- */
function exportJson() {
  if (!mind) return
  try {
    const data = mind.getData()
    const json = JSON.stringify(data, null, 2)
    downloadText(json, 'mind-map.json', 'application/json;charset=utf-8')
    toast.success(t('tools.mindMap.exportSuccess'))
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

/** 校验并补全导入数据：必须有 nodeData.topic，节点缺 id 时自动补齐 */
function normalizeImportedData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const nodeData = raw.nodeData
  if (!nodeData || typeof nodeData !== 'object' || typeof nodeData.topic !== 'string') return null
  const seen = new Set()
  const walk = (node) => {
    if (typeof node.id !== 'string' || !node.id || seen.has(node.id)) {
      let fresh = uid()
      while (seen.has(fresh)) fresh = uid()
      node.id = fresh
    }
    seen.add(node.id)
    if (node.children !== undefined && !Array.isArray(node.children)) {
      delete node.children
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(nodeData)
  return { nodeData, arrows: Array.isArray(raw.arrows) ? raw.arrows : [], summaries: Array.isArray(raw.summaries) ? raw.summaries : [] }
}

function applyImportedText(text) {
  importError.value = ''
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    importError.value = t('tools.mindMap.invalidJson')
    toast.error(t('tools.mindMap.invalidJson'))
    return
  }
  const data = normalizeImportedData(raw)
  if (!data) {
    importError.value = t('tools.mindMap.invalidStructure')
    toast.error(t('tools.mindMap.invalidStructure'))
    return
  }
  if (!mind) {
    importError.value = t('tools.mindMap.initFailed')
    toast.error(t('tools.mindMap.initFailed'))
    return
  }
  try {
    mind.refresh(data)
    mind.toCenter()
    toast.success(t('tools.mindMap.importSuccess'))
    pasteText.value = ''
    showImport.value = false
  } catch (e) {
    importError.value = t('tools.mindMap.invalidStructure')
    toast.error(t('toolsCommon.error'))
  }
}

async function onFileChange(event) {
  const file = event.target && event.target.files && event.target.files[0]
  if (!file) return
  try {
    const text = await readFileAsText(file)
    applyImportedText(text)
  } catch (e) {
    importError.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    if (fileRef.value) fileRef.value.value = ''
  }
}

function confirmPasteImport() {
  if (!pasteText.value.trim()) {
    importError.value = t('tools.mindMap.invalidJson')
    toast.error(t('tools.mindMap.invalidJson'))
    return
  }
  applyImportedText(pasteText.value)
}

function toggleImport() {
  showImport.value = !showImport.value
  importError.value = ''
}

const SHORTCUT_TIPS = ['tipEdit', 'tipChild', 'tipSibling', 'tipDelete', 'tipDrag', 'tipZoom', 'tipPaste']
</script>

<template>
  <ToolPage tool-id="mindMap">
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title mb-0 mr-auto">{{ t('tools.mindMap.mapStatus') }}</span>
        <button type="button" class="btn-ghost" @click="centerMap">{{ t('tools.mindMap.center') }}</button>
        <button type="button" class="btn-ghost" @click="fitMap">{{ t('tools.mindMap.fitView') }}</button>
        <button type="button" class="btn-ghost" @click="resetMap">{{ t('toolsCommon.reset') }}</button>
        <button type="button" class="btn-primary" @click="exportJson" :disabled="!ready">
          {{ t('tools.mindMap.exportJson') }}
        </button>
        <button type="button" class="btn-ghost" :class="{ 'text-blue-600 border-blue-300': showImport }" @click="toggleImport">
          {{ t('tools.mindMap.importJson') }}
        </button>
      </div>

      <!-- 导入面板 -->
      <div v-if="showImport" class="rounded-xl border border-slate-200 bg-white/70 p-3 sm:p-4 mb-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span class="label-base mb-0 mr-auto">{{ t('tools.mindMap.importTitle') }}</span>
          <button
            type="button"
            class="btn-ghost"
            :class="{ 'text-blue-600 border-blue-300': importMode === 'file' }"
            @click="importMode = 'file'"
          >
            {{ t('tools.mindMap.importFromFile') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :class="{ 'text-blue-600 border-blue-300': importMode === 'paste' }"
            @click="importMode = 'paste'"
          >
            {{ t('tools.mindMap.importPaste') }}
          </button>
        </div>

        <div v-if="importMode === 'file'">
          <input
            ref="fileRef"
            type="file"
            accept=".json,application/json"
            class="input-base w-full text-sm cursor-pointer file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white/70 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-600 file:cursor-pointer"
            @change="onFileChange"
          />
        </div>
        <div v-else>
          <textarea
            v-model="pasteText"
            class="input-base w-full font-mono h-36 resize-none text-xs"
            :placeholder="t('tools.mindMap.pastePlaceholder')"
            spellcheck="false"
          ></textarea>
          <div class="flex justify-end mt-2">
            <button type="button" class="btn-primary" @click="confirmPasteImport">
              {{ t('tools.mindMap.confirmImport') }}
            </button>
          </div>
        </div>

        <p v-if="importError" class="mt-2 text-sm text-red-600">{{ importError }}</p>
      </div>

      <!-- 画布容器 -->
      <div
        ref="containerRef"
        class="mindmap-container w-full h-[400px] sm:h-[520px] rounded-xl border border-slate-200 bg-white/80 overflow-hidden"
      ></div>

      <p v-if="initFailed" class="mt-3 text-sm text-red-600">{{ t('tools.mindMap.initFailed') }}</p>
    </section>

    <!-- 操作说明卡片 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.mindMap.tipsTitle') }}</h2>
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-600">
        <li v-for="tip in SHORTCUT_TIPS" :key="tip" class="flex items-start gap-2">
          <span class="text-blue-500 mt-0.5">•</span>
          <span>{{ t(`tools.mindMap.${tip}`) }}</span>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

<style scoped>
/* mind-elixir 样式由其 dist 产物在导入时自动注入（css-injected-by-js） */
.mindmap-container :deep(.map-container) {
  background-color: transparent;
}
</style>

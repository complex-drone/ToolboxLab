<script setup>
import { ref, computed } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * JSON 树形可视化：
 * - 粘贴 JSON，防抖 400ms 解析，失败行内报错
 * - 扁平化渲染可展开/折叠树（默认展开到第 2 层），节点带类型徽章与值缩略
 * - 搜索键名/值/路径片段：命中高亮并自动展开祖先链
 * - 顶部节点计数（对象/数组/叶子），一键展开/折叠全部，节点 hover 复制路径（$.a.b[0].c）
 * - 节点总数超过 20000 时仅渲染前 20000 个并提示
 */
const { t } = useI18n()
const toast = useToast()

const MAX_NODES = 20000
const MAX_STR_LEN = 40

/* ---------- 示例数据（JS 常量，避免写入语言包） ---------- */
const SAMPLE_JSON = JSON.stringify(
  {
    name: 'toolbox-demo',
    version: '1.0.0',
    enabled: true,
    tags: ['json', 'tree', 'viewer'],
    owner: { id: 1, name: 'alice', email: 'alice@example.com' },
    users: [
      { id: 1, name: 'alice', roles: ['admin'], score: 98.5, active: true },
      { id: 2, name: 'bob', roles: ['editor', 'viewer'], score: 76, active: false },
    ],
    config: { theme: 'light', retries: 3, timeout: null, proxy: { host: '127.0.0.1', port: 8080 } },
    description: 'A sample payload used to demonstrate the JSON tree viewer.',
  },
  null,
  2
)

const inputText = ref('')
const parsed = ref(null) // { root, counter }
const parseError = ref('')
const searchQuery = ref('')

/* ---------- 树构建 ---------- */
let idSeq = 0

function pathSegment(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? '.' + key : "['" + key + "']"
}

function buildNode(value, path, key, depth, counter) {
  counter.total += 1
  const node = { id: ++idSeq, key, path, depth, children: null, count: 0 }
  if (value === null) {
    node.type = 'null'
    node.value = null
    counter.leaf += 1
  } else if (Array.isArray(value)) {
    node.type = 'arr'
    counter.arr += 1
    node.count = value.length
    node.children = value.map((item, i) => buildNode(item, path + '[' + i + ']', String(i), depth + 1, counter))
  } else {
    switch (typeof value) {
      case 'object': {
        node.type = 'obj'
        counter.obj += 1
        const entries = Object.entries(value)
        node.count = entries.length
        node.children = entries.map(([k, v]) => buildNode(v, path + pathSegment(k), k, depth + 1, counter))
        break
      }
      case 'number':
        node.type = 'num'
        node.value = value
        counter.leaf += 1
        break
      case 'boolean':
        node.type = 'bool'
        node.value = value
        counter.leaf += 1
        break
      default:
        node.type = 'str'
        node.value = String(value)
        counter.leaf += 1
    }
  }
  return node
}

function collectExpandedDefault(root) {
  // 默认展开到第 2 层：展开深度 0 与 1 的容器节点
  const ids = []
  const walk = (node) => {
    if (node.children && node.depth <= 1) {
      ids.push(node.id)
      node.children.forEach(walk)
    }
  }
  walk(root)
  return new Set(ids)
}

function doParse(text) {
  if (!text.trim()) {
    parsed.value = null
    parseError.value = ''
    return
  }
  try {
    const data = JSON.parse(text)
    const counter = { obj: 0, arr: 0, leaf: 0, total: 0 }
    const root = buildNode(data, '$', '', 0, counter)
    parsed.value = { root, counter }
    expanded.value = collectExpandedDefault(root)
    parseError.value = ''
  } catch (e) {
    parsed.value = null
    parseError.value = t('tools.jsonTreeView.errInvalid')
  }
}

watchDebounced(inputText, (text) => doParse(text), { debounce: 400, maxWait: 1200 })

function loadSample() {
  inputText.value = SAMPLE_JSON
  doParse(SAMPLE_JSON)
  toast.success(t('toolsCommon.done'))
}

function clearInput() {
  inputText.value = ''
  searchQuery.value = ''
  parsed.value = null
  parseError.value = ''
}

/* ---------- 展开 / 折叠 ---------- */
const expanded = ref(new Set())

function isOpen(node) {
  return expanded.value.has(node.id)
}

function toggleNode(node) {
  if (!node.children) return
  const next = new Set(expanded.value)
  if (next.has(node.id)) next.delete(node.id)
  else next.add(node.id)
  expanded.value = next
}

function collectContainerIds(root) {
  const ids = []
  const walk = (node) => {
    if (node.children) {
      ids.push(node.id)
      node.children.forEach(walk)
    }
  }
  walk(root)
  return ids
}

function expandAll() {
  if (!parsed.value) return
  expanded.value = new Set(collectContainerIds(parsed.value.root))
}

function collapseAll() {
  expanded.value = new Set()
}

/* ---------- 搜索：命中 + 祖先链 ---------- */
const trimmedQuery = computed(() => searchQuery.value.trim().toLowerCase())

const searchIndex = computed(() => {
  const q = trimmedQuery.value
  if (!q || !parsed.value) return null
  const matched = new Set()
  const ancestors = new Set()
  const walk = (node, chain) => {
    const hit =
      node.key.toLowerCase().includes(q) ||
      node.path.toLowerCase().includes(q) ||
      (node.children === null && String(node.value).toLowerCase().includes(q))
    if (hit) {
      matched.add(node.id)
      chain.forEach((id) => ancestors.add(id))
    }
    if (node.children) node.children.forEach((c) => walk(c, chain.concat(node.id)))
  }
  walk(parsed.value.root, [])
  return { matched, ancestors }
})

/* ---------- 可见节点（DFS，受展开集合控制，含渲染上限） ---------- */
const visibleList = computed(() => {
  if (!parsed.value) return []
  const si = searchIndex.value
  const eff = si ? new Set([...expanded.value, ...si.ancestors, ...si.matched]) : expanded.value
  const out = []
  const stack = [parsed.value.root]
  while (stack.length) {
    const node = stack.pop()
    out.push(node)
    if (node.children && eff.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i])
    }
  }
  return out
})

const renderedNodes = computed(() => visibleList.value.slice(0, MAX_NODES))
const isTruncated = computed(() => {
  if (!parsed.value) return false
  return parsed.value.counter.total > MAX_NODES || visibleList.value.length > MAX_NODES
})

const isMatched = (node) => {
  const si = searchIndex.value
  return !!(si && si.matched.has(node.id))
}

/* ---------- 展示辅助 ---------- */
const TYPE_LABEL = { obj: 'typeObj', arr: 'typeArr', str: 'typeStr', num: 'typeNum', bool: 'typeBool', null: 'typeNull' }

/* Tailwind 类保持完整字面量，确保 JIT 扫描生效 */
const TYPE_CLASS = {
  obj: 'bg-sky-50 text-sky-600 border-sky-200',
  arr: 'bg-violet-50 text-violet-600 border-violet-200',
  str: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  num: 'bg-amber-50 text-amber-600 border-amber-200',
  bool: 'bg-rose-50 text-rose-600 border-rose-200',
  null: 'bg-slate-100 text-slate-500 border-slate-200',
}

function truncateStr(s) {
  return s.length > MAX_STR_LEN ? s.slice(0, MAX_STR_LEN) + '…' : s
}

function nodePreview(node) {
  if (node.type === 'obj') return t('tools.jsonTreeView.keysCount', { n: node.count })
  if (node.type === 'arr') return t('tools.jsonTreeView.itemsCount', { n: node.count })
  if (node.type === 'str') return '"' + truncateStr(node.value) + '"'
  return String(node.value)
}

function nodeKeyLabel(node) {
  return node.depth === 0 ? t('tools.jsonTreeView.rootLabel') : node.key
}

const counterView = computed(() => parsed.value ? parsed.value.counter : { obj: 0, arr: 0, leaf: 0, total: 0 })
</script>

<template>
  <ToolPage tool-id="jsonTreeView">
    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-1.5">
        <span class="label-base flex-1 mb-0">{{ t('toolsCommon.input') }}</span>
        <button type="button" class="btn-ghost" @click="loadSample">{{ t('tools.jsonTreeView.loadSample') }}</button>
        <button type="button" class="btn-ghost" @click="clearInput">{{ t('toolsCommon.clear') }}</button>
      </div>
      <textarea
        v-model="inputText"
        class="input-base w-full font-mono h-44 resize-y"
        :placeholder="t('tools.jsonTreeView.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="parseError" class="mt-2 text-sm text-red-600">{{ parseError }}</p>

      <!-- 节点统计 -->
      <div v-if="parsed" class="flex flex-wrap items-center gap-2 mt-3">
        <span class="section-title mb-0 mr-1">{{ t('tools.jsonTreeView.statsTitle') }}:</span>
        <span class="chip">{{ t('tools.jsonTreeView.objNodes') }}: {{ counterView.obj }}</span>
        <span class="chip">{{ t('tools.jsonTreeView.arrNodes') }}: {{ counterView.arr }}</span>
        <span class="chip">{{ t('tools.jsonTreeView.leafNodes') }}: {{ counterView.leaf }}</span>
        <span class="chip">{{ t('tools.jsonTreeView.totalNodes') }}: {{ counterView.total }}</span>
      </div>
    </section>

    <!-- 树 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="section-title mb-0 mr-auto">{{ t('tools.jsonTreeView.treeTitle') }}</span>
        <button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" :disabled="!parsed" @click="expandAll">
          {{ t('tools.jsonTreeView.expandAll') }}
        </button>
        <button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" :disabled="!parsed" @click="collapseAll">
          {{ t('tools.jsonTreeView.collapseAll') }}
        </button>
      </div>

      <!-- 搜索 -->
      <div v-if="parsed">
        <input
          v-model="searchQuery"
          type="text"
          class="input-base mb-3"
          :placeholder="t('tools.jsonTreeView.searchPlaceholder')"
          spellcheck="false"
        />
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span v-if="trimmedQuery && searchIndex && searchIndex.matched.size" class="chip">
            {{ t('tools.jsonTreeView.matchedCount', { n: searchIndex.matched.size }) }}
          </span>
          <span v-if="trimmedQuery && searchIndex && !searchIndex.matched.size" class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
            {{ t('tools.jsonTreeView.noMatch') }}
          </span>
          <span v-if="isTruncated" class="chip !bg-amber-50 !text-amber-600 !border-amber-200">
            {{ t('tools.jsonTreeView.truncated', { n: MAX_NODES }) }}
          </span>
        </div>
      </div>

      <div v-if="!parsed" class="text-sm text-slate-400 py-10 text-center">
        {{ t('toolsCommon.none') }}
      </div>
      <div v-else class="overflow-x-auto rounded-xl border border-slate-200 bg-white/70 p-2">
        <div class="min-w-max">
          <div
            v-for="node in renderedNodes"
            :key="node.id"
            class="tree-row group flex items-center gap-1.5 rounded-lg pr-2 py-1 text-sm cursor-pointer hover:bg-slate-50 transition-colors"
            :class="{ 'bg-amber-50': isMatched(node) }"
            :style="{ paddingLeft: node.depth * 14 + 4 + 'px' }"
            @click="toggleNode(node)"
          >
            <span class="w-4 h-4 flex-none flex items-center justify-center text-slate-400">
              <svg
                v-if="node.children"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-3 h-3 transition-transform"
                :class="{ 'rotate-90': isOpen(node) }"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span class="font-medium text-slate-700 truncate max-w-[45%] flex-none" :class="{ 'italic text-slate-400': node.depth === 0 }">
              {{ nodeKeyLabel(node) }}
            </span>
            <span
              class="flex-none inline-flex items-center rounded-full border px-1.5 text-[10px] leading-4 font-semibold uppercase tracking-wide"
              :class="TYPE_CLASS[node.type]"
            >
              {{ t(`tools.jsonTreeView.${TYPE_LABEL[node.type]}`) }}
            </span>
            <span class="text-slate-500 truncate min-w-0 flex-1 font-mono text-xs">{{ nodePreview(node) }}</span>
            <span class="flex-none opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" @click.stop>
              <CopyButton compact :text="node.path" />
            </span>
          </div>
        </div>
      </div>
    </section>
  </ToolPage>
</template>

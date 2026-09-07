<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import { copyText } from '@/utils/clipboard'

/**
 * 剪贴板历史管理器（本地）
 * - 捕获阶段监听 document copy 事件，记录在本页面内发生的复制（文本 / 图片）
 * - 浏览器安全模型限制：无法读取系统级剪贴板历史，仅能记录本页面内的复制（UI 中已说明）
 * - 最近 30 条存入 localStorage（useStorage），同内容去重上移
 * - 图片经 FileReader 转 dataURL 存缩略，超过 100KB 跳过；文本超过 100KB 跳过（保护存储）
 * - 点击条目重新复制；支持搜索过滤、清空、手动读取当前剪贴板
 */
const { t } = useI18n()
const toast = useToast()

const MAX_ITEMS = 30
const MAX_IMAGE_BYTES = 100 * 1024
const MAX_TEXT_BYTES = 100 * 1024
const PREVIEW_LENGTH = 300

const history = useStorage('tool-clipboard-history', [])
const query = ref('')
const readError = ref('')
const tick = ref(0) // 定时刷新相对时间

let seq = 0
let tickTimer = null

/* ---------- 记录 ---------- */

function addItem(type, content, preview) {
  const now = Date.now()
  const rest = history.value.filter(item => item.content !== content)
  const item = { id: `${now}-${seq++}`, type, content, preview: preview || '', time: now }
  history.value = [item, ...rest].slice(0, MAX_ITEMS)
}

function onCopy(e) {
  try {
    const dt = e.clipboardData
    if (!dt) return

    // 图片优先：items 中存在 image/* 时按图片记录
    let imageFile = null
    if (dt.items && dt.items.length) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i]
        if (item.type && item.type.indexOf('image/') === 0 && typeof item.getAsFile === 'function') {
          const f = item.getAsFile()
          if (f) {
            imageFile = f
            break
          }
        }
      }
    }
    if (imageFile) {
      if (imageFile.size > MAX_IMAGE_BYTES) {
        toast.info(t('tools.clipboardHistory.imageTooLarge'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addItem('image', reader.result, '')
        }
      }
      reader.onerror = () => {
        /* 图片读取失败，忽略 */
      }
      reader.readAsDataURL(imageFile)
      return
    }

    const text = dt.getData('text/plain')
    if (text && text.trim()) {
      if (text.length > MAX_TEXT_BYTES) {
        toast.info(t('tools.clipboardHistory.textTooLarge'))
        return
      }
      addItem('text', text, text.slice(0, PREVIEW_LENGTH))
    }
  } catch {
    /* 非预期的剪贴板数据，忽略 */
  }
}

/* ---------- 列表 ---------- */

function relativeTime(ts) {
  tick.value // 建立依赖，tick 变化时重新计算
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return t('tools.clipboardHistory.timeNow')
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} ${t('tools.clipboardHistory.timeMin')}`
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} ${t('tools.clipboardHistory.timeHour')}`
  if (diff < 7 * 86400 * 1000) return `${Math.floor(diff / 86400000)} ${t('tools.clipboardHistory.timeDay')}`
  return new Date(ts).toLocaleDateString()
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return history.value
  return history.value.filter(item => item.type === 'text' && (item.content || '').toLowerCase().includes(q))
})

const hasQuery = computed(() => query.value.trim().length > 0)

/* ---------- 操作 ---------- */

async function copyItem(item) {
  try {
    const ok = await copyText(item.content)
    if (ok) {
      toast.success(t('tools.clipboardHistory.copied'))
    } else {
      toast.error(t('toolsCommon.copyFailed'))
    }
  } catch {
    toast.error(t('toolsCommon.copyFailed'))
  }
}

function clearHistory() {
  history.value = []
  toast.success(t('tools.clipboardHistory.cleared'))
}

async function addCurrent() {
  readError.value = ''
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      readError.value = t('tools.clipboardHistory.readUnavailable')
      return
    }
    const text = await navigator.clipboard.readText()
    if (text && text.trim()) {
      if (text.length > MAX_TEXT_BYTES) {
        toast.info(t('tools.clipboardHistory.textTooLarge'))
        return
      }
      addItem('text', text, text.slice(0, PREVIEW_LENGTH))
      toast.success(t('tools.clipboardHistory.addDone'))
    } else {
      toast.info(t('tools.clipboardHistory.addEmpty'))
    }
  } catch {
    readError.value = t('tools.clipboardHistory.permissionDenied')
  }
}

onMounted(() => {
  document.addEventListener('copy', onCopy, true)
  tickTimer = setInterval(() => {
    tick.value++
  }, 30000)
})

onBeforeUnmount(() => {
  document.removeEventListener('copy', onCopy, true)
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})
</script>

<template>
  <ToolPage tool-id="clipboardHistory">
    <!-- 能力边界与隐私说明 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <p class="text-sm text-slate-600 leading-relaxed">
        {{ t('tools.clipboardHistory.capabilityNote') }}
      </p>
      <p class="text-sm text-slate-500 leading-relaxed mt-2">
        {{ t('tools.clipboardHistory.privacyNote') }}
      </p>
    </section>

    <!-- 工具栏 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          v-model="query"
          type="text"
          class="input-base sm:flex-1 min-w-0"
          :placeholder="t('tools.clipboardHistory.searchPlaceholder')"
        />
        <div class="flex gap-2 flex-shrink-0">
          <button type="button" class="btn-ghost" @click="addCurrent">
            {{ t('tools.clipboardHistory.addCurrent') }}
          </button>
          <button type="button" class="btn-danger" :disabled="!history.length" @click="clearHistory">
            {{ t('tools.clipboardHistory.clearHistory') }}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-3">
        <span class="chip bg-slate-100 text-slate-500">
          {{ t('toolsCommon.total') }} {{ history.length }} / {{ MAX_ITEMS }} {{ t('tools.clipboardHistory.itemsCount') }}
        </span>
      </div>
      <p v-if="readError" class="mt-2 text-xs text-red-600">{{ readError }}</p>
    </section>

    <!-- 历史列表 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div v-if="!filtered.length" class="py-8 text-center">
        <p class="text-sm text-slate-400">
          {{ hasQuery ? t('tools.clipboardHistory.noMatch') : t('tools.clipboardHistory.empty') }}
        </p>
      </div>

      <ul v-else class="flex flex-col gap-2">
        <li v-for="item in filtered" :key="item.id">
          <button
            type="button"
            class="w-full text-left p-3 rounded-xl border border-slate-200 bg-white/70 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
            :title="t('tools.clipboardHistory.clickToCopy')"
            @click="copyItem(item)"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-base flex-shrink-0" aria-hidden="true">{{ item.type === 'image' ? '🖼️' : '📝' }}</span>
              <span class="chip bg-slate-100 text-slate-500">
                {{ item.type === 'image' ? t('tools.clipboardHistory.imageItem') : t('tools.clipboardHistory.textItem') }}
              </span>
              <span class="ml-auto text-xs text-slate-400 flex-shrink-0">{{ relativeTime(item.time) }}</span>
            </div>
            <img
              v-if="item.type === 'image'"
              :src="item.content"
              :alt="t('tools.clipboardHistory.imageItem')"
              class="max-h-24 rounded-lg border border-slate-100"
            />
            <p v-else class="text-sm text-slate-600 whitespace-pre-wrap break-all line-clamp-3">{{ item.content }}</p>
          </button>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

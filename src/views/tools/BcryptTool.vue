<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { useToast } from '@/composables/useToast'

/**
 * Bcrypt 加密 / 校验（bcryptjs 纯 JS 实现，懒加载，全部本地完成）
 * - 隐私要求：明文与哈希仅存于组件内存，绝不写入 localStorage，仅持久化 cost 偏好
 * - 示例哈希为预生成的真实哈希（"toolboxlab", cost 10），可直接比对验证
 */

/** 预生成示例：bcrypt.hashSync('toolboxlab', 10) 的真实结果 */
const EXAMPLE_TEXT = 'toolboxlab'
const EXAMPLE_HASH = '$2a$10$zMLwdzL2a6a.lyI.mKUOQeMbTLNp1NIjJXemXGwtaOU2w1RlyWKji'

/** 标准 bcrypt 哈希：$2a$ + 2 位 cost + $ + 22 位 salt + 31 位校验值，共 60 字符 */
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

const { t } = useI18n()
const toast = useToast()

/** 仅持久化 cost 偏好 */
const config = useStorage('tool-bcrypt-config', { cost: 10 })

// 生成哈希
const hashText = ref('')
const hashResult = ref('')
const hashMs = ref(null)
const hashBusy = ref(false)
const hashError = ref('')

// 比对验证
const compareText = ref('')
const compareHash = ref('')
const compareResult = ref(null) // null | true | false
const compareMs = ref(null)
const compareBusy = ref(false)
const compareError = ref('')

/** bcryptjs 为 CJS 包，兼容 default 与命名导出两种互操作形态 */
async function loadBcrypt() {
  const mod = await import('bcryptjs')
  const bcrypt = mod.default && typeof mod.default.hash === 'function' ? mod.default : mod
  if (!bcrypt || typeof bcrypt.hash !== 'function' || typeof bcrypt.compare !== 'function') {
    throw new Error('bcryptjs unavailable')
  }
  return bcrypt
}

async function generateHash() {
  hashError.value = ''
  if (!hashText.value) {
    hashError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  hashBusy.value = true
  try {
    const bcrypt = await loadBcrypt()
    const start = performance.now()
    // 使用异步 hash，避免长 cost 时阻塞主线程
    const hash = await bcrypt.hash(hashText.value, config.value.cost)
    hashMs.value = Math.round(performance.now() - start)
    hashResult.value = hash
  } catch {
    hashResult.value = ''
    hashMs.value = null
    hashError.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    hashBusy.value = false
  }
}

async function runCompare() {
  compareError.value = ''
  compareResult.value = null
  if (!compareText.value || !compareHash.value.trim()) {
    compareError.value = t('toolsCommon.invalidInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  const hash = compareHash.value.trim()
  if (!BCRYPT_HASH_RE.test(hash)) {
    compareError.value = t('tools.bcryptTool.invalidHash')
    toast.error(compareError.value)
    return
  }
  compareBusy.value = true
  try {
    const bcrypt = await loadBcrypt()
    const start = performance.now()
    const ok = await bcrypt.compare(compareText.value, hash)
    compareMs.value = Math.round(performance.now() - start)
    compareResult.value = ok
  } catch {
    compareMs.value = null
    compareError.value = t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  } finally {
    compareBusy.value = false
  }
}

function fillExample() {
  compareText.value = EXAMPLE_TEXT
  compareHash.value = EXAMPLE_HASH
  compareResult.value = null
  compareError.value = ''
  toast.info(t('tools.bcryptTool.exampleFilled'))
}

function clearHashInput() {
  hashText.value = ''
  hashResult.value = ''
  hashMs.value = null
  hashError.value = ''
}

function clearCompareInputs() {
  compareText.value = ''
  compareHash.value = ''
  compareResult.value = null
  compareMs.value = null
  compareError.value = ''
}
</script>

<template>
  <ToolPage tool-id="bcryptTool">
    <!-- cost 设置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span class="section-title mb-0">{{ t('tools.bcryptTool.costLabel') }}</span>
        <span class="chip font-mono">{{ config.cost }}</span>
      </div>
      <input
        v-model.number="config.cost"
        type="range"
        class="w-full accent-blue-600"
        min="4"
        max="15"
        step="1"
        :aria-label="t('tools.bcryptTool.costLabel')"
      />
      <div class="flex justify-between text-xs text-slate-400 mt-0.5">
        <span>4</span>
        <span>15</span>
      </div>
      <p v-if="config.cost > 12" class="mt-2 text-sm font-medium text-amber-600">
        {{ t('tools.bcryptTool.costSlowWarning') }}
      </p>
      <p class="mt-2 text-xs text-slate-400">{{ t('tools.bcryptTool.costNote') }}</p>
    </section>

    <!-- 生成哈希 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <h2 class="section-title">{{ t('tools.bcryptTool.hashTitle') }}</h2>

      <label class="label-base" for="bcrypt-hash-input">{{ t('tools.bcryptTool.plaintextLabel') }}</label>
      <div class="relative">
        <input
          id="bcrypt-hash-input"
          v-model="hashText"
          type="text"
          class="input-base w-full pr-16 font-mono"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('tools.bcryptTool.plaintextPlaceholder')"
        />
        <button
          type="button"
          class="btn-danger absolute right-1.5 top-1/2 -translate-y-1/2 !px-2 !py-1"
          :disabled="!hashText"
          :aria-label="t('toolsCommon.clear')"
          @click="clearHashInput"
        >
          {{ t('toolsCommon.clear') }}
        </button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-primary"
          :disabled="hashBusy || !hashText"
          @click="generateHash"
        >
          {{ t('tools.bcryptTool.hashButton') }}
        </button>
        <span v-if="hashBusy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
        <span v-if="hashMs !== null" class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
          {{ t('tools.bcryptTool.elapsedMs', { n: hashMs }) }}
        </span>
      </div>
      <p v-if="hashError" class="mt-2 text-sm text-red-600">{{ hashError }}</p>

      <div v-if="hashResult" class="mt-4">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-sm font-medium text-slate-600">{{ t('tools.bcryptTool.hashResultLabel') }}</span>
          <CopyButton :text="hashResult" />
        </div>
        <textarea
          :value="hashResult"
          rows="2"
          readonly
          class="input-base w-full font-mono text-xs bg-slate-50"
          spellcheck="false"
        ></textarea>
      </div>
      <p v-else class="mt-3 text-xs text-slate-400">{{ t('tools.bcryptTool.hashFormatNote') }}</p>
    </section>

    <!-- 比对验证 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="section-title mb-0">{{ t('tools.bcryptTool.compareTitle') }}</h2>
        <button type="button" class="btn-ghost" @click="fillExample">
          {{ t('tools.bcryptTool.exampleButton') }}
        </button>
      </div>

      <label class="label-base" for="bcrypt-compare-text">{{ t('tools.bcryptTool.compareTextLabel') }}</label>
      <input
        id="bcrypt-compare-text"
        v-model="compareText"
        type="text"
        class="input-base w-full font-mono"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('tools.bcryptTool.plaintextPlaceholder')"
      />

      <label class="label-base mt-3" for="bcrypt-compare-hash">{{ t('tools.bcryptTool.compareHashLabel') }}</label>
      <textarea
        id="bcrypt-compare-hash"
        v-model="compareHash"
        rows="2"
        class="input-base w-full font-mono"
        spellcheck="false"
        :placeholder="t('tools.bcryptTool.compareHashPlaceholder')"
      ></textarea>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-primary"
          :disabled="compareBusy || !compareText || !compareHash.trim()"
          @click="runCompare"
        >
          {{ t('tools.bcryptTool.compareButton') }}
        </button>
        <button type="button" class="btn-danger" @click="clearCompareInputs">
          {{ t('toolsCommon.clear') }}
        </button>
        <span v-if="compareBusy" class="chip animate-pulse">{{ t('toolsCommon.processing') }}</span>
        <span v-if="compareMs !== null" class="chip !bg-slate-50 !text-slate-500 !border-slate-200">
          {{ t('tools.bcryptTool.elapsedMs', { n: compareMs }) }}
        </span>
      </div>
      <p v-if="compareError" class="mt-2 text-sm text-red-600">{{ compareError }}</p>

      <div
        v-if="compareResult === true"
        class="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5"
      >
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 shrink-0 text-emerald-600" aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <p class="text-sm font-semibold text-emerald-600">{{ t('tools.bcryptTool.match') }}</p>
      </div>
      <div
        v-else-if="compareResult === false"
        class="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5"
      >
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 shrink-0 text-red-600" aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <p class="text-sm font-semibold text-red-600">{{ t('tools.bcryptTool.mismatch') }}</p>
      </div>
    </section>
  </ToolPage>
</template>

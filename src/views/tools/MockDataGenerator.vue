<script setup>
import { ref, computed } from 'vue'
import { clampInt } from '@/utils/number'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { randomInt, randomIntBetween, randomPick } from '@/utils/random'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const toast = useToast()

/* ==================== 姓名库（组件常量，不进语言包） ==================== */

/** 常见中文姓氏（100 个单姓 + 复姓） */
const SURNAMES = [
  '李', '王', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '马', '朱', '胡',
  '郭', '何', '高', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡', '余', '杜', '叶', '程', '苏',
  '魏', '吕', '丁', '任', '沈', '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金',
  '石', '廖', '贾', '夏', '韦', '付', '方', '白', '邹', '孟', '熊', '秦', '邱', '江', '尹',
  '薛', '闫', '段', '雷', '侯', '龙', '史', '陶', '黎', '贺', '顾', '毛', '郝', '龚', '邵',
  '万', '钱', '严', '覃', '武', '戴', '莫', '孔', '向', '汤',
  '欧阳', '上官', '司马', '诸葛', '皇甫', '司徒',
]

/** 常见中文名（名部分） */
const GIVEN_ZH = [
  '伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛',
  '明', '超', '霞', '平', '刚', '辉', '健', '晨', '浩', '子轩', '雨婷', '欣怡', '梓涵',
  '浩然', '诗涵', '宇轩', '欣妍', '佳怡', '梓萱', '博文', '思远', '天佑', '雨泽', '文博',
  '若曦', '梦琪', '语嫣', '嘉怡', '子墨', '一鸣', '心怡', '志强', '建华', '国栋', '晓东',
  '海燕', '春花', '玉兰', '秀珍', '桂芳', '建军', '志明', '丽华', '小雅', '明辉', '文静',
  '雅婷', '志远', '立群', '国华', '锦程', '泽宇', '可欣', '慧敏', '瑞霖', '梓豪', '雨欣',
]

/** 常见英文姓 / 名 */
const FIRST_EN = [
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Andrew', 'Kevin', 'Brian', 'Emma',
  'Olivia', 'Sophia', 'Isabella', 'Charlotte', 'Amelia', 'Mia', 'Harper', 'Evelyn', 'Abigail',
  'Emily', 'Elizabeth', 'Grace', 'Chloe', 'Victoria', 'Riley', 'Lillian', 'Natalie', 'Hannah', 'Zoe',
]
const LAST_EN = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez',
  'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson',
  'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott',
  'Green', 'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Turner', 'Phillips', 'Campbell',
]

/** 邮箱用户名前缀与示例域名 */
const EMAIL_USERS = [
  'james', 'lucy', 'jack', 'emma', 'david', 'linda', 'tom', 'sophia', 'kevin', 'nina',
  'peter', 'grace', 'leo', 'anna', 'mark', 'jane', 'paul', 'ruby', 'sam', 'ivy',
  'ben', 'vera', 'carl', 'daisy',
]
const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com', 'demo.com', 'mail.com']

/** 地址组成常量 */
const PROVINCES = [
  '北京市', '上海市', '天津市', '重庆市', '广东省', '江苏省', '浙江省', '山东省', '四川省',
  '湖北省', '湖南省', '河南省', '河北省', '福建省', '安徽省', '辽宁省', '陕西省', '江西省',
  '广西壮族自治区', '云南省', '贵州省', '山西省', '吉林省', '黑龙江省', '海南省', '甘肃省',
  '青海省', '内蒙古自治区', '新疆维吾尔自治区', '西藏自治区', '宁夏回族自治区',
]
const CITIES = [
  '广州', '深圳', '杭州', '南京', '苏州', '成都', '武汉', '长沙', '郑州', '西安', '青岛',
  '济南', '大连', '宁波', '厦门', '福州', '合肥', '昆明', '贵阳', '南宁', '南昌', '哈尔滨',
  '沈阳', '长春', '石家庄', '太原', '兰州', '海口', '无锡', '佛山', '东莞', '珠海', '温州',
]
const DISTRICTS = [
  '朝阳区', '海淀区', '福田区', '南山区', '高新区', '经济开发区', '城关区', '和平区',
  '天河区', '武侯区', '锦江区', '鼓楼区', '西湖区', '江干区', '越秀区', '龙岗区',
  '经开区', '新华区', '中山路街道', '解放路街道', '人民路街道',
]
const ROADS = [
  '人民', '中山', '解放', '建设', '光明', '和平', '文化', '朝阳', '春晖', '望江',
  '临江', '金龙', '凤凰', '梧桐', '银杏', '滨河', '育才', '康乐',
]

/* ==================== 字段类型定义 ==================== */

const TYPES = [
  { value: 'name', labelKey: 'typeName' },
  { value: 'email', labelKey: 'typeEmail' },
  { value: 'phone', labelKey: 'typePhone' },
  { value: 'address', labelKey: 'typeAddress' },
  { value: 'date', labelKey: 'typeDate' },
  { value: 'number', labelKey: 'typeNumber' },
  { value: 'bool', labelKey: 'typeBool' },
  { value: 'uuid', labelKey: 'typeUuid' },
]

const COUNT_MIN = 1
const COUNT_MAX = 100
const COUNT_FALLBACK = 10
const DECIMALS_MAX = 4


function normalizeField(f, idx) {
  const src = f && typeof f === 'object' ? f : {}
  const type = TYPES.some(tp => tp.value === src.type) ? src.type : 'name'
  const min = Number(src.min)
  const max = Number(src.max)
  const decimals = clampInt(src.decimals, 0, DECIMALS_MAX, 0)
  return {
    id: Number.isFinite(Number(src.id)) && Number(src.id) > 0 ? Number(src.id) : idx + 1,
    name: typeof src.name === 'string' ? src.name : '',
    type,
    style: src.style === 'en' ? 'en' : 'zh',
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 100,
    decimals,
  }
}

/** 字段配置持久化 */
const config = useStorage('tool-mock-data-generator-config', {
  count: COUNT_FALLBACK,
  fields: [
    { id: 1, name: '', type: 'name', style: 'zh', min: 0, max: 100, decimals: 0 },
    { id: 2, name: '', type: 'email', style: 'zh', min: 0, max: 100, decimals: 0 },
    { id: 3, name: '', type: 'phone', style: 'zh', min: 0, max: 100, decimals: 0 },
  ],
})

if (!Array.isArray(config.value.fields) || config.value.fields.length === 0) {
  config.value.fields = [
    { id: 1, name: '', type: 'name', style: 'zh', min: 0, max: 100, decimals: 0 },
    { id: 2, name: '', type: 'email', style: 'zh', min: 0, max: 100, decimals: 0 },
    { id: 3, name: '', type: 'phone', style: 'zh', min: 0, max: 100, decimals: 0 },
  ]
} else {
  config.value.fields = config.value.fields.map(normalizeField)
}

const records = ref([])

/** 表格列名：字段名为空时回退为 fieldN */
function colName(field, idx) {
  const name = typeof field.name === 'string' ? field.name.trim() : ''
  return name || `field${idx + 1}`
}

/* ==================== 各类型生成器（全部使用加密级随机） ==================== */

function randomZhName() {
  return randomPick(SURNAMES) + randomPick(GIVEN_ZH)
}

function randomEnName() {
  return `${randomPick(FIRST_EN)} ${randomPick(LAST_EN)}`
}

function randomEmail() {
  return `${randomPick(EMAIL_USERS)}${randomIntBetween(1, 999)}@${randomPick(EMAIL_DOMAINS)}`
}

/** +86 手机号：1 + [3-9] + 9 位数字，按 3-4-4 分组展示 */
function randomPhone() {
  let digits = `1${randomIntBetween(3, 9)}`
  for (let i = 0; i < 9; i++) digits += String(randomInt(10))
  return `+86 ${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
}

function randomAddress() {
  return (
    randomPick(PROVINCES) +
    randomPick(CITIES) +
    randomPick(DISTRICTS) +
    randomPick(ROADS) +
    '路' +
    randomIntBetween(1, 999) +
    '号'
  )
}

/** 近 5 年内的随机 ISO 日期（yyyy-MM-dd）；randomInt 上限为 2^32，故按天 + 当天毫秒两段组合 */
function randomDate() {
  const dayMs = 24 * 60 * 60 * 1000
  const days = randomIntBetween(0, 1825)
  const msInDay = randomInt(dayMs)
  const ts = Date.now() - days * dayMs - msInDay
  return new Date(ts).toISOString().slice(0, 10)
}

/** randomInt 的拒绝采样仅支持 2^32 以内的跨度，超大范围需截断保护 */
const RANDOM_SPAN_LIMIT = 0xffffffff

function randomNumber(field) {
  let min = Number(field.min)
  let max = Number(field.max)
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = 100
  if (min > max) {
    const tmp = min
    min = max
    max = tmp
  }
  const decimals = clampInt(field.decimals, 0, DECIMALS_MAX, 0)
  let lo
  let hi
  if (decimals === 0) {
    lo = Math.ceil(min)
    hi = Math.floor(max)
  } else {
    const scale = 10 ** decimals
    lo = Math.round(min * scale)
    hi = Math.round(max * scale)
  }
  if (lo > hi) {
    const tmp = lo
    lo = hi
    hi = tmp
  }
  if (hi - lo > RANDOM_SPAN_LIMIT) {
    hi = lo + RANDOM_SPAN_LIMIT
  }
  const raw = lo === hi ? lo : randomIntBetween(lo, hi)
  return decimals === 0 ? raw : Number((raw / 10 ** decimals).toFixed(decimals))
}

/** UUID v4：优先 crypto.randomUUID，异常时降级为随机字节拼接 */
function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      // 继续走降级方案
    }
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function makeValue(field) {
  switch (field.type) {
    case 'email':
      return randomEmail()
    case 'phone':
      return randomPhone()
    case 'address':
      return randomAddress()
    case 'date':
      return randomDate()
    case 'number':
      return randomNumber(field)
    case 'bool':
      return randomPick([true, false])
    case 'uuid':
      return randomUuid()
    case 'name':
    default:
      return field.style === 'en' ? randomEnName() : randomZhName()
  }
}

/** 生成数据（silent 为 true 时不弹提示，用于首次进入页面） */
function generate(silent = false) {
  try {
    config.value.count = clampInt(config.value.count, COUNT_MIN, COUNT_MAX, COUNT_FALLBACK)
    const fields = config.value.fields
    const rows = []
    for (let i = 0; i < config.value.count; i++) {
      const rec = {}
      for (const f of fields) {
        rec[f.id] = makeValue(f)
      }
      rows.push(rec)
    }
    records.value = rows
    if (!silent) {
      toast.success(t('tools.mockDataGenerator.toastGenerated', { n: rows.length }))
    }
  } catch {
    records.value = []
    toast.error(t('toolsCommon.error'))
  }
}

/* ==================== 字段增删 ==================== */

function nextFieldId() {
  return config.value.fields.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1
}

function addField() {
  const id = nextFieldId()
  config.value.fields.push({
    id,
    name: `${t('tools.mockDataGenerator.newField')}${id}`,
    type: 'name',
    style: 'zh',
    min: 0,
    max: 100,
    decimals: 0,
  })
}

function removeField(idx) {
  if (config.value.fields.length <= 1) return
  config.value.fields.splice(idx, 1)
}

/* ==================== 导出 ==================== */

const jsonText = computed(() => {
  if (records.value.length === 0) return ''
  try {
    return JSON.stringify(
      records.value.map(rec => {
        const obj = {}
        config.value.fields.forEach((f, idx) => {
          obj[colName(f, idx)] = rec[f.id]
        })
        return obj
      }),
      null,
      2
    )
  } catch {
    return ''
  }
})

/** CSV 单元格转义：含逗号 / 引号 / 换行时加引号，内部引号翻倍 */
function csvCell(value) {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportJson() {
  try {
    if (!jsonText.value) return
    downloadText(jsonText.value, 'mock-data.json', 'application/json;charset=utf-8')
    toast.success(t('tools.mockDataGenerator.toastExported', { fmt: 'JSON' }))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

function exportCsv() {
  try {
    if (records.value.length === 0) return
    const header = config.value.fields.map((f, idx) => csvCell(colName(f, idx))).join(',')
    const lines = records.value.map(rec => config.value.fields.map(f => csvCell(rec[f.id])).join(','))
    // 加 BOM，保证 Excel 直接打开中文不乱码
    const content = '\uFEFF' + [header, ...lines].join('\r\n')
    downloadText(content, 'mock-data.csv', 'text/csv;charset=utf-8')
    toast.success(t('tools.mockDataGenerator.toastExported', { fmt: 'CSV' }))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}

generate(true)
</script>

<template>
  <ToolPage tool-id="mockDataGenerator">
    <!-- 字段配置 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">{{ t('tools.mockDataGenerator.fields') }}</h2>
        <button type="button" class="btn-ghost" @click="addField">
          + {{ t('tools.mockDataGenerator.addField') }}
        </button>
      </div>

      <div class="space-y-3">
        <div
          v-for="(f, idx) in config.fields"
          :key="f.id"
          class="rounded-xl border border-slate-100 bg-white/60 p-3"
        >
          <div class="flex flex-wrap items-start gap-2">
            <div class="min-w-[150px] flex-1">
              <label
                class="label-base"
                :for="`mock-name-${f.id}`"
              >
                {{ t('tools.mockDataGenerator.fieldName') }} {{ idx + 1 }}
              </label>
              <input
                :id="`mock-name-${f.id}`"
                v-model="f.name"
                type="text"
                class="input-base"
                :placeholder="t('tools.mockDataGenerator.fieldNamePlaceholder')"
                :aria-label="t('tools.mockDataGenerator.fieldName')"
              />
            </div>

            <div class="w-32">
              <label class="label-base" :for="`mock-type-${f.id}`">
                {{ t('tools.mockDataGenerator.fieldType') }}
              </label>
              <select
                :id="`mock-type-${f.id}`"
                v-model="f.type"
                class="input-base"
                :aria-label="t('tools.mockDataGenerator.fieldType')"
              >
                <option v-for="tp in TYPES" :key="tp.value" :value="tp.value">
                  {{ t(`tools.mockDataGenerator.${tp.labelKey}`) }}
                </option>
              </select>
            </div>

            <!-- 姓名库选择 -->
            <div v-if="f.type === 'name'" class="w-28">
              <label class="label-base" :for="`mock-style-${f.id}`">
                {{ t('tools.mockDataGenerator.nameStyle') }}
              </label>
              <select
                :id="`mock-style-${f.id}`"
                v-model="f.style"
                class="input-base"
                :aria-label="t('tools.mockDataGenerator.nameStyle')"
              >
                <option value="zh">{{ t('tools.mockDataGenerator.styleZh') }}</option>
                <option value="en">{{ t('tools.mockDataGenerator.styleEn') }}</option>
              </select>
            </div>

            <!-- 数字类型参数 -->
            <template v-if="f.type === 'number'">
              <div class="w-24">
                <label class="label-base" :for="`mock-min-${f.id}`">
                  {{ t('tools.mockDataGenerator.min') }}
                </label>
                <input
                  :id="`mock-min-${f.id}`"
                  v-model.number="f.min"
                  type="number"
                  class="input-base"
                  :aria-label="t('tools.mockDataGenerator.min')"
                />
              </div>
              <div class="w-24">
                <label class="label-base" :for="`mock-max-${f.id}`">
                  {{ t('tools.mockDataGenerator.max') }}
                </label>
                <input
                  :id="`mock-max-${f.id}`"
                  v-model.number="f.max"
                  type="number"
                  class="input-base"
                  :aria-label="t('tools.mockDataGenerator.max')"
                />
              </div>
              <div class="w-24">
                <label class="label-base" :for="`mock-dec-${f.id}`">
                  {{ t('tools.mockDataGenerator.decimals') }}
                </label>
                <select
                  :id="`mock-dec-${f.id}`"
                  v-model.number="f.decimals"
                  class="input-base"
                  :aria-label="t('tools.mockDataGenerator.decimals')"
                >
                  <option v-for="d in DECIMALS_MAX + 1" :key="d" :value="d - 1">{{ d - 1 }}</option>
                </select>
              </div>
            </template>

            <div class="flex shrink-0 items-end pt-1 sm:pt-5">
              <button
                type="button"
                class="btn-danger"
                :disabled="config.fields.length <= 1"
                :aria-label="t('tools.mockDataGenerator.deleteField')"
                @click="removeField(idx)"
              >
                {{ t('tools.mockDataGenerator.deleteField') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 生成数量 -->
      <div class="mt-5">
        <label class="label-base" for="mock-count">
          {{ t('tools.mockDataGenerator.count') }}: {{ config.count }}
        </label>
        <div class="flex items-center gap-3">
          <div class="w-20 shrink-0">
            <input
              id="mock-count"
              v-model.number="config.count"
              type="number"
              :min="COUNT_MIN"
              :max="COUNT_MAX"
              class="input-base text-center font-mono"
              :aria-label="t('tools.mockDataGenerator.count')"
            />
          </div>
          <input
            v-model.number="config.count"
            type="range"
            :min="COUNT_MIN"
            :max="COUNT_MAX"
            class="min-w-0 flex-1 accent-blue-600"
            :aria-label="t('tools.mockDataGenerator.count')"
          />
        </div>
      </div>

      <div class="mt-4">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="generate()">
          {{ t('tools.mockDataGenerator.generate') }}
        </button>
      </div>
    </section>

    <!-- 生成结果 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title mb-0">
          {{ t('tools.mockDataGenerator.results') }}
          <span class="text-sm font-normal text-slate-400">
            {{ t('toolsCommon.total') }} {{ records.length }}
          </span>
        </h2>
        <div class="flex flex-wrap items-center gap-2">
          <CopyButton
            :text="jsonText"
            :label="t('toolsCommon.copyAll')"
            :disabled="records.length === 0"
          />
          <button
            type="button"
            class="btn-ghost"
            :disabled="records.length === 0"
            @click="exportJson"
          >
            {{ t('tools.mockDataGenerator.exportJson') }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="records.length === 0"
            @click="exportCsv"
          >
            {{ t('tools.mockDataGenerator.exportCsv') }}
          </button>
        </div>
      </div>

      <p v-if="records.length === 0" class="text-sm text-slate-400">
        {{ t('toolsCommon.none') }}
      </p>
      <div v-else class="max-h-[480px] overflow-auto rounded-xl border border-slate-100">
        <table class="w-full min-w-max text-left text-sm">
          <thead class="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <tr>
              <th class="px-3 py-2 font-medium text-slate-400">#</th>
              <th
                v-for="(f, idx) in config.fields"
                :key="f.id"
                class="whitespace-nowrap px-3 py-2 font-medium text-slate-600"
              >
                {{ colName(f, idx) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(rec, i) in records"
              :key="i"
              class="border-t border-slate-100 odd:bg-white/70 even:bg-slate-50/50"
            >
              <td class="px-3 py-2 font-mono text-xs text-slate-400">{{ i + 1 }}</td>
              <td
                v-for="f in config.fields"
                :key="f.id"
                class="whitespace-nowrap px-3 py-2 font-mono text-slate-700"
              >
                {{ rec[f.id] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </ToolPage>
</template>

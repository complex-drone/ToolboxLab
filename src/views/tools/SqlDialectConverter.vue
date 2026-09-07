<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage, watchDebounced } from '@vueuse/core'
import { useToast } from '@/composables/useToast'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'

/**
 * SQL 方言转换器（纯规则引擎，不引入第三方解析器）
 * - MySQL / PostgreSQL / SQLite 六个方向逐条正则转换
 * - 每条规则命中记录：规则名 + 次数 + 原文片段；无法自动处理的差异以提示条目输出
 * - 覆盖：LIMIT、NOW()、自增主键、标识符引号、IFNULL/COALESCE、CONCAT/双竖线、类型映射、UNSIGNED、表选项、转义差异
 * - 方言选择持久化；输入防抖 500ms 自动转换
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-sql-dialect-converter-config', {
  source: 'mysql',
  target: 'postgresql',
})

const input = ref('')
const output = ref('')
const logs = ref([])
const errorMsg = ref('')

const DIALECTS = ['mysql', 'postgresql', 'sqlite']

/** 示例：MySQL 风味 SQL，覆盖多数转换规则 */
const EXAMPLE = [
  'CREATE TABLE `users` (',
  '  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
  '  `nickname` VARCHAR(50) NOT NULL,',
  '  `level` TINYINT DEFAULT 1,',
  '  `score` DOUBLE DEFAULT 0,',
  '  `bio` LONGTEXT,',
  '  `avatar` BLOB,',
  "  `created_at` DATETIME DEFAULT NOW(),",
  "  `role` ENUM('admin', 'user') DEFAULT 'user',",
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  '',
  "SELECT IFNULL(`nickname`, 'anon') AS name, CONCAT(`nickname`, ' ok') AS label",
  'FROM `users`',
  "WHERE `created_at` >= '2026-01-01' AND `level` >= 1",
  'ORDER BY `id`',
  'LIMIT 20, 10;',
].join('\n')

const isSameDialect = computed(() => config.value.source === config.value.target)

const totalHits = computed(() =>
  logs.value.filter(l => !l.isNote).reduce((sum, l) => sum + l.count, 0)
)

/** MySQL 自增主键列的两种目标写法 */
const AUTO_INC_COLUMN =
  /(`?)(\w+)\1\s+(TINYINT|SMALLINT|MEDIUMINT|BIGINT|INT|INTEGER)(\s*\(\d+\))?(\s+UNSIGNED)?(\s+NOT\s+NULL)?\s+AUTO_INCREMENT(\s+PRIMARY\s+KEY)?/gi
/** SERIAL / BIGSERIAL / SMALLSERIAL 列 */
const SERIAL_COLUMN = /(`?"?)(\w+)\1\s+(BIGSERIAL|SMALLSERIAL|SERIAL)(\s+PRIMARY\s+KEY)?/gi
/** SQLite 整型主键自增列 */
const SQLITE_AUTO_COLUMN = /(`?"?)(\w+)\1\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi

/** 各方向的类型映射表 */
const TYPE_MAPS = {
  'mysql-postgresql': {
    TINYINT: 'SMALLINT',
    MEDIUMINT: 'INTEGER',
    'DOUBLE PRECISION': 'DOUBLE PRECISION',
    DOUBLE: 'DOUBLE PRECISION',
    FLOAT: 'REAL',
    DATETIME: 'TIMESTAMP',
    TINYTEXT: 'TEXT',
    MEDIUMTEXT: 'TEXT',
    LONGTEXT: 'TEXT',
    TINYBLOB: 'BYTEA',
    MEDIUMBLOB: 'BYTEA',
    LONGBLOB: 'BYTEA',
    BLOB: 'BYTEA',
    JSON: 'JSONB',
  },
  'mysql-sqlite': {
    TINYINT: 'INTEGER',
    MEDIUMINT: 'INTEGER',
    'DOUBLE PRECISION': 'REAL',
    DOUBLE: 'REAL',
    FLOAT: 'REAL',
    DATETIME: 'TEXT',
    TINYTEXT: 'TEXT',
    MEDIUMTEXT: 'TEXT',
    LONGTEXT: 'TEXT',
    TINYBLOB: 'BLOB',
    MEDIUMBLOB: 'BLOB',
    LONGBLOB: 'BLOB',
    JSON: 'TEXT',
  },
  'postgresql-mysql': {
    SERIAL: 'INT',
    BIGSERIAL: 'BIGINT',
    SMALLSERIAL: 'SMALLINT',
    BYTEA: 'BLOB',
    'DOUBLE PRECISION': 'DOUBLE',
    JSONB: 'JSON',
    UUID: 'CHAR(36)',
  },
  'postgresql-sqlite': {
    SERIAL: 'INTEGER',
    BIGSERIAL: 'INTEGER',
    SMALLSERIAL: 'INTEGER',
    BYTEA: 'BLOB',
    'DOUBLE PRECISION': 'REAL',
    JSONB: 'TEXT',
    UUID: 'TEXT',
  },
  'sqlite-mysql': {},
  'sqlite-postgresql': {},
}

/** 按方向构建规则列表（顺序即执行顺序） */
function buildRules(source, target) {
  const rules = []
  const fromMysql = source === 'mysql'
  const toMysql = target === 'mysql'

  // 1. LIMIT 偏移语法
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleLimitComma',
      regex: /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi,
      replace: (m, offset, count) => `LIMIT ${count} OFFSET ${offset}`,
    })
  } else if (!fromMysql && toMysql) {
    rules.push({
      key: 'ruleLimitOffset',
      regex: /\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/gi,
      replace: (m, offset, count) => `LIMIT ${count}, ${offset}`,
    })
  }

  // 2. 自增主键列
  if (fromMysql && target === 'postgresql') {
    rules.push({
      key: 'ruleAutoIncrement',
      regex: AUTO_INC_COLUMN,
      replace: (m, q, name, type, len, unsigned, notNull, pk) => {
        const base = type.toUpperCase()
        const serial =
          base === 'TINYINT' || base === 'SMALLINT'
            ? 'SMALLSERIAL'
            : base === 'BIGINT' || base === 'MEDIUMINT'
              ? 'BIGSERIAL'
              : 'SERIAL'
        return `${q}${name}${q} ${serial}${pk ? ' PRIMARY KEY' : ''}`
      },
    })
  } else if (fromMysql && target === 'sqlite') {
    rules.push({
      key: 'ruleAutoIncrement',
      regex: AUTO_INC_COLUMN,
      replace: (m, q, name, type, len, unsigned, notNull, pk) =>
        `${q}${name}${q} INTEGER${pk ? ' PRIMARY KEY AUTOINCREMENT' : ''}`,
    })
  } else if (source === 'postgresql' && toMysql) {
    rules.push({
      key: 'ruleSerial',
      regex: SERIAL_COLUMN,
      replace: (m, q, name, type, pk) => `${q}${name}${q} INT AUTO_INCREMENT${pk ? ' PRIMARY KEY' : ''}`,
    })
  } else if (source === 'sqlite' && toMysql) {
    rules.push({
      key: 'ruleAutoIncrement',
      regex: SQLITE_AUTO_COLUMN,
      replace: (m, q, name) => `${q}${name}${q} INT AUTO_INCREMENT PRIMARY KEY`,
    })
  } else if (source === 'postgresql' && target === 'sqlite') {
    rules.push({
      key: 'ruleSerial',
      regex: SERIAL_COLUMN,
      replace: (m, q, name, type, pk) =>
        `${q}${name}${q} INTEGER${pk ? ' PRIMARY KEY AUTOINCREMENT' : ''}`,
    })
  } else if (source === 'sqlite' && target === 'postgresql') {
    rules.push({
      key: 'ruleAutoIncrement',
      regex: SQLITE_AUTO_COLUMN,
      replace: (m, q, name) => `${q}${name}${q} SERIAL PRIMARY KEY`,
    })
  }

  // 3. NOW() 与 CURRENT_TIMESTAMP
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleNowToCurrent',
      regex: /\bNOW\s*\(\s*\)/gi,
      replace: () => 'CURRENT_TIMESTAMP',
    })
  } else if (!fromMysql && toMysql) {
    rules.push({
      key: 'ruleCurrentToNow',
      regex: /\bCURRENT_TIMESTAMP\b(?:\s*\(\s*\))?/gi,
      replace: () => 'NOW()',
    })
  }

  // 4. 标识符引号
  if (!toMysql) {
    rules.push({
      key: 'ruleBacktickToQuote',
      regex: /`([^`]*)`/g,
      replace: (m, ident) => `"${ident}"`,
    })
  } else if (!fromMysql) {
    // 仅转换形如标识符的双引号串（含空格或特殊字符的按字符串字面量保留）
    rules.push({
      key: 'ruleQuoteToBacktick',
      regex: /"([A-Za-z_][\w$]*)"/g,
      replace: (m, ident) => `\`${ident}\``,
    })
  }

  // 5. IFNULL 与 COALESCE（两参数）
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleIfnullToCoalesce',
      regex: /\bIFNULL\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/gi,
      replace: (m, a, b) => `COALESCE(${a}, ${b})`,
    })
  } else if (!fromMysql && toMysql) {
    rules.push({
      key: 'ruleCoalesceToIfnull',
      regex: /\bCOALESCE\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/gi,
      replace: (m, a, b) => `IFNULL(${a}, ${b})`,
    })
  }

  // 6. CONCAT 与双竖线拼接（两参数）
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleConcatToPipe',
      regex: /\bCONCAT\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/gi,
      replace: (m, a, b) => `${a} || ${b}`,
    })
  } else if (!fromMysql && toMysql) {
    rules.push({
      key: 'rulePipeToConcat',
      regex: /([\w.'"`\]]+(?:\([^()]*\))?)\s*\|\|\s*([\w.'"`\]]+(?:\([^()]*\))?)/g,
      replace: (m, a, b) => `CONCAT(${a}, ${b})`,
    })
  }

  // 7. ENUM 类型（MySQL 专有）
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleEnum',
      regex: /\bENUM\s*\([^)]*\)/gi,
      replace: () => 'TEXT',
    })
  }

  // 8. 数据类型映射
  const typeMap = TYPE_MAPS[`${source}-${target}`]
  if (typeMap && Object.keys(typeMap).length > 0) {
    rules.push({
      key: 'ruleTypeMap',
      regex: /\b(DOUBLE\s+PRECISION|TINYINT|MEDIUMINT|DOUBLE|FLOAT|DATETIME|TINYTEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|MEDIUMBLOB|LONGBLOB|BLOB|JSONB|JSON|UUID|BYTEA)\b/gi,
      replace: m => {
        const key = m.toUpperCase().replace(/\s+/g, ' ')
        return typeMap[key] || m
      },
    })
  }

  // 9. UNSIGNED 关键字（PG / SQLite 无符号语义）
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleUnsigned',
      regex: /\bUNSIGNED\s+/gi,
      replace: () => '',
    })
  }

  // 10. 表选项（ENGINE / CHARSET / COLLATE 等）
  if (fromMysql && !toMysql) {
    rules.push({
      key: 'ruleTableOptions',
      regex: /\s*(?:ENGINE\s*=\s*\w+|DEFAULT\s+CHARSET\s*=\s*\w+|CHARSET\s*=\s*\w+|COLLATE\s+\w+|AUTO_INCREMENT\s*=\s*\d+)/gi,
      replace: () => '',
    })
  }

  return rules
}

/** 执行单条规则并记录命中 */
function applyRule(text, rule, logsOut) {
  let count = 0
  let sample = ''
  const next = text.replace(rule.regex, (...args) => {
    count += 1
    if (!sample) sample = String(args[0]).trim().slice(0, 80)
    try {
      return rule.replace(...args)
    } catch {
      return args[0]
    }
  })
  if (count > 0) logsOut.push({ key: rule.key, count, sample, isNote: false })
  return next
}

/** 完整转换：返回转换后文本与日志（含提示条目） */
function convertSql(sql, source, target) {
  const logsOut = []
  let text = sql
  for (const rule of buildRules(source, target)) {
    text = applyRule(text, rule, logsOut)
  }

  // 提示条目：无法自动处理的差异
  if (/\\[\\'"]/.test(text)) {
    logsOut.push({ key: 'noteEscape', count: 1, sample: '', isNote: true })
  }
  if (source === 'mysql' && target !== 'mysql' && /\bCONCAT\s*\(/i.test(text)) {
    logsOut.push({ key: 'noteConcat', count: 1, sample: '', isNote: true })
  }
  if (source === 'postgresql' && target === 'mysql' && /::|\bILIKE\b|\bRETURNING\b/.test(text)) {
    logsOut.push({ key: 'notePgOnly', count: 1, sample: '', isNote: true })
  }

  return { text, logs: logsOut }
}

/** 执行转换；manual 为 true 时给出 Toast 反馈 */
function convert(manual) {
  errorMsg.value = ''
  output.value = ''
  logs.value = []
  if (!input.value.trim() || isSameDialect.value) return
  try {
    const { text, logs: ruleLogs } = convertSql(input.value, config.value.source, config.value.target)
    output.value = text
    logs.value = ruleLogs
    if (manual) toast.success(t('toolsCommon.done'))
  } catch (e) {
    errorMsg.value = e && e.message ? e.message : t('toolsCommon.error')
    if (manual) toast.error(t('toolsCommon.error'))
  }
}

// 输入与方言变化后自动转换
watchDebounced(
  [input, () => config.value.source, () => config.value.target],
  () => convert(false),
  { debounce: 500 }
)

function swapDialects() {
  const tmp = config.value.source
  config.value.source = config.value.target
  config.value.target = tmp
  const tmpInput = input.value
  input.value = output.value
  output.value = tmpInput
  logs.value = []
  errorMsg.value = ''
}

function loadExample() {
  input.value = EXAMPLE
  errorMsg.value = ''
}

function clearAll() {
  input.value = ''
  output.value = ''
  logs.value = []
  errorMsg.value = ''
}

function downloadSql() {
  try {
    downloadText(output.value, 'converted.sql', 'text/plain;charset=utf-8')
    toast.success(t('toolsCommon.done'))
  } catch {
    toast.error(t('toolsCommon.error'))
  }
}
</script>

<template>
  <ToolPage tool-id="sqlDialectConverter">
    <!-- 方言选择 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="sql-source" class="label-base">{{ t('tools.sqlDialectConverter.sourceDialect') }}</label>
          <select id="sql-source" v-model="config.source" class="input-base">
            <option v-for="d in DIALECTS" :key="d" :value="d">
              {{ t(`tools.sqlDialectConverter.${d}`) }}
            </option>
          </select>
        </div>
        <div>
          <label for="sql-target" class="label-base">{{ t('tools.sqlDialectConverter.targetDialect') }}</label>
          <select id="sql-target" v-model="config.target" class="input-base">
            <option v-for="d in DIALECTS" :key="d" :value="d">
              {{ t(`tools.sqlDialectConverter.${d}`) }}
            </option>
          </select>
        </div>
      </div>

      <p v-if="isSameDialect" class="mt-3 text-xs text-amber-600">
        {{ t('tools.sqlDialectConverter.sameDialectHint') }}
      </p>

      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" class="btn-primary" :disabled="isSameDialect" @click="convert(true)">
          {{ t('toolsCommon.convert') }}
        </button>
        <button type="button" class="btn-ghost" @click="swapDialects">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {{ t('toolsCommon.swap') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearAll">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 输入 / 输出 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label for="sql-input" class="label-base">{{ t('tools.sqlDialectConverter.inputLabel') }}</label>
          <textarea
            id="sql-input"
            v-model="input"
            class="input-base w-full font-mono h-64 resize-y"
            :placeholder="t('tools.sqlDialectConverter.inputPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <label for="sql-output" class="label-base flex-1 mb-0">{{ t('tools.sqlDialectConverter.outputLabel') }}</label>
            <CopyButton :text="output" :label="t('toolsCommon.copy')" :disabled="!output" />
            <button type="button" class="btn-ghost !px-2 !py-1" :disabled="!output" :aria-label="t('toolsCommon.download')" @click="downloadSql">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
          <textarea
            id="sql-output"
            :value="output"
            readonly
            class="input-base w-full font-mono h-64 resize-y bg-slate-50/80 mt-1.5"
            :aria-label="t('tools.sqlDialectConverter.outputLabel')"
          ></textarea>
        </div>
      </div>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
      <p class="mt-3 text-xs text-slate-400">{{ t('tools.sqlDialectConverter.escapeHint') }}</p>
    </section>

    <!-- 转换日志 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="section-title mb-0 flex-1">{{ t('tools.sqlDialectConverter.logTitle') }}</h2>
        <span v-if="totalHits > 0" class="chip">
          {{ t('tools.sqlDialectConverter.statsLabel') }} {{ totalHits }}
        </span>
      </div>

      <p v-if="logs.length === 0" class="text-sm text-slate-400">{{ t('tools.sqlDialectConverter.logEmpty') }}</p>

      <ul v-else class="space-y-2">
        <li
          v-for="(log, idx) in logs"
          :key="idx"
          class="rounded-xl border px-3 py-2"
          :class="log.isNote ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white/70'"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium" :class="log.isNote ? 'text-amber-700' : 'text-slate-700'">
              {{ t(`tools.sqlDialectConverter.${log.key}`) }}
            </span>
            <span v-if="!log.isNote" class="chip">{{ log.count }}</span>
          </div>
          <p v-if="log.sample" class="font-mono text-xs text-slate-500 mt-1 break-all">{{ log.sample }}</p>
        </li>
      </ul>
    </section>
  </ToolPage>
</template>

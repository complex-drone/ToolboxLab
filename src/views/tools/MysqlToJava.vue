<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'
import { downloadText } from '@/utils/download'
import { useToast } from '@/composables/useToast'

/**
 * MySQL 转 JavaBean
 * - 正则 + 括号/引号配对自写解析 CREATE TABLE（支持多条语句）
 * - 表名/字段下划线转驼峰；类型映射（tinyint(1) 可选映射 Boolean）
 * - Lombok 开关：开 => 类上加 @Data；关 => 生成完整 Getter/Setter（Boolean 用 isXxx）
 * - 字段 Javadoc 取列 COMMENT，类注释含表名与表 COMMENT
 */
const { t } = useI18n()
const toast = useToast()

const config = useStorage('tool-mysql-to-java-config', {
  lombok: true,
  tinyintBool: true,
})

const input = ref('')
const errorMsg = ref('')
const tables = ref([])
const warnings = ref([])

/** 示例 SQL（多条 CREATE TABLE，覆盖常见类型） */
const EXAMPLE_SQL = [
  'CREATE TABLE `user_info` (',
  '  `id` bigint NOT NULL COMMENT \'主键ID\',',
  '  `user_name` varchar(64) NOT NULL COMMENT \'用户名\',',
  '  `age` int DEFAULT NULL COMMENT \'年龄\',',
  '  `deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT \'是否删除\',',
  '  `balance` decimal(10,2) DEFAULT \'0.00\' COMMENT \'账户余额\',',
  '  `score` double DEFAULT NULL COMMENT \'积分\',',
  '  `birthday` date DEFAULT NULL COMMENT \'出生日期\',',
  '  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT \'创建时间\',',
  '  `last_login` time DEFAULT NULL COMMENT \'最后登录时长\',',
  '  `ext_info` json DEFAULT NULL COMMENT \'扩展信息\',',
  '  `avatar` blob COMMENT \'头像\',',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'用户信息表\';',
  '',
  'CREATE TABLE `order_record` (',
  '  `order_id` bigint NOT NULL COMMENT \'订单ID\',',
  '  `user_id` bigint NOT NULL COMMENT \'用户ID\',',
  '  `amount` decimal(12,2) NOT NULL COMMENT \'订单金额\',',
  '  `status` tinyint NOT NULL DEFAULT 0 COMMENT \'订单状态\',',
  '  `remark` text COMMENT \'备注\',',
  '  `pay_time` timestamp NULL DEFAULT NULL COMMENT \'支付时间\',',
  '  PRIMARY KEY (`order_id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'订单记录表\';',
].join('\n')

/** 下划线转大驼峰：user_info => UserInfo */
function snakeToPascal(s) {
  const parts = String(s)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
  return parts.join('') || 'Bean'
}

/** 下划线转小驼峰：user_name => userName */
function snakeToCamel(s) {
  const pascal = snakeToPascal(s)
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1)
  return /^[0-9]/.test(camel) ? 'f' + camel : camel
}

/** 首字母大写（用于 Getter/Setter 方法名） */
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** SQL 字符串解除 '' 转义 */
function unescapeSql(s) {
  return s.replace(/''/g, "'")
}

/**
 * 提取全部 CREATE TABLE 语句块（表名、列定义区、表尾选项）
 * 用括号深度 + 引号状态扫描出与开头 ( 配对的 )，避免 decimal(10,2) 等干扰
 */
function extractCreateTables(sql) {
  const results = []
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([A-Za-z0-9_$]+)[`"\]]?\s*\(/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const bodyStart = m.index + m[0].length
    let depth = 1
    let i = bodyStart
    let quote = null
    while (i < sql.length && depth > 0) {
      const ch = sql[i]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
      } else if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
      }
      i++
    }
    const body = sql.slice(bodyStart, i - 1)
    let semi = sql.indexOf(';', i)
    if (semi === -1) semi = sql.length
    const tail = sql.slice(i, semi)
    results.push({ tableName: m[1], body, tail })
    re.lastIndex = semi
  }
  return results
}

/** 按顶层逗号切分列定义区（忽略括号与引号内的逗号） */
function splitDefinitions(body) {
  const parts = []
  let depth = 0
  let quote = null
  let cur = ''
  for (const ch of body) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}

/** 表 COMMENT */
function parseTableComment(tail) {
  const m = /comment\s*=\s*'((?:[^']|'')*)'/i.exec(tail)
  return m ? unescapeSql(m[1]) : ''
}

/** 类型映射：返回 Java 类型；无法识别返回 null（由调用方记录警告并回退 String） */
function mapJavaType(base, args, tinyintBool) {
  const ty = base.toLowerCase()
  const argDigits = /^\(\s*(\d+)/.exec(args || '')
  switch (ty) {
    case 'bigint':
      return 'Long'
    case 'int':
    case 'integer':
      return 'Integer'
    case 'tinyint':
      return tinyintBool && argDigits && argDigits[1] === '1' ? 'Boolean' : 'Integer'
    case 'smallint':
    case 'mediumint':
      return 'Integer'
    case 'decimal':
    case 'numeric':
      return 'BigDecimal'
    case 'double':
      return 'Double'
    case 'float':
      return 'Float'
    case 'varchar':
    case 'char':
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
      return 'String'
    case 'date':
      return 'LocalDate'
    case 'datetime':
    case 'timestamp':
      return 'LocalDateTime'
    case 'time':
      return 'LocalTime'
    case 'year':
      return 'Integer'
    case 'json':
      return 'String'
    case 'blob':
    case 'tinyblob':
    case 'mediumblob':
    case 'longblob':
    case 'binary':
    case 'varbinary':
      return 'byte[]'
    default:
      return null
  }
}

/** 非列定义的关键字前缀（PRIMARY KEY / KEY / INDEX / CONSTRAINT 等） */
const NON_COLUMN_RE = /^(primary|unique|key|index|constraint|foreign|fulltext|spatial|check)\b/i

/** 解析单条 CREATE TABLE 为表结构对象 */
function parseTable(block, tinyintBool, warnList) {
  const columns = []
  for (const def of splitDefinitions(block.body)) {
    if (NON_COLUMN_RE.test(def)) continue
    const m = /^[`"[]?([A-Za-z0-9_$]+)[`"\]]?\s+([A-Za-z][A-Za-z0-9_]*)\s*(\([^)]*\))?/.exec(def)
    if (!m) continue
    const columnName = m[1]
    const baseType = m[2]
    const typeArgs = m[3] || ''
    const rest = def.slice(m[0].length)
    let javaType = mapJavaType(baseType, typeArgs, tinyintBool)
    if (!javaType) {
      javaType = 'String'
      warnList.push(
        t('tools.mysqlToJava.unknownType')
          .replace('%1', block.tableName + '.' + columnName)
          .replace('%2', baseType.toLowerCase())
      )
    }
    const notNull = /not\s+null/i.test(rest)
    const cm = /comment\s+'((?:[^']|'')*)'/i.exec(rest)
    const comment = cm ? unescapeSql(cm[1]) : ''
    columns.push({
      columnName,
      baseType: baseType.toLowerCase(),
      typeArgs,
      notNull,
      comment,
      javaType,
      fieldName: snakeToCamel(columnName),
    })
  }
  return {
    tableName: block.tableName,
    className: snakeToPascal(block.tableName),
    comment: parseTableComment(block.tail),
    columns,
  }
}

/** 生成单个类的 Java 代码 */
function buildClassCode(table, lombok) {
  const lines = []
  lines.push('/**')
  lines.push(' * ' + (table.comment || table.className))
  lines.push(' * ' + t('tools.mysqlToJava.tableNameLabel') + ': ' + table.tableName)
  lines.push(' */')
  if (lombok) {
    lines.push('@Data')
  }
  lines.push('public class ' + table.className + ' {')
  for (const col of table.columns) {
    lines.push('')
    lines.push('    /**')
    lines.push('     * ' + (col.comment || col.columnName))
    lines.push('     */')
    lines.push('    private ' + col.javaType + ' ' + col.fieldName + ';')
  }
  if (!lombok) {
    for (const col of table.columns) {
      const cap = capitalize(col.fieldName)
      const getterPrefix = col.javaType === 'Boolean' ? 'is' : 'get'
      lines.push('')
      lines.push('    public ' + col.javaType + ' ' + getterPrefix + cap + '() {')
      lines.push('        return ' + col.fieldName + ';')
      lines.push('    }')
      lines.push('')
      lines.push('    public void set' + cap + '(' + col.javaType + ' ' + col.fieldName + ') {')
      lines.push('        this.' + col.fieldName + ' = ' + col.fieldName + ';')
      lines.push('    }')
    }
  }
  lines.push('}')
  return lines.join('\n')
}

/** 类代码顶部 import 区（按需引入时间/BigDecimal/Lombok 包） */
function buildImports(table, lombok) {
  const imports = []
  const types = new Set(table.columns.map(c => c.javaType))
  if (types.has('LocalDate') || types.has('LocalDateTime') || types.has('LocalTime')) {
    imports.push('import java.time.LocalDate;')
    imports.push('import java.time.LocalDateTime;')
    imports.push('import java.time.LocalTime;')
  }
  if (types.has('BigDecimal')) {
    imports.push('import java.math.BigDecimal;')
  }
  if (lombok) {
    imports.push('import lombok.Data;')
  }
  return imports
}

/** 执行转换 */
function convert() {
  errorMsg.value = ''
  tables.value = []
  warnings.value = []
  const sql = input.value
  if (!sql.trim()) {
    errorMsg.value = t('tools.mysqlToJava.emptyInput')
    toast.error(t('toolsCommon.invalidInput'))
    return
  }
  try {
    const warnList = []
    const blocks = extractCreateTables(sql)
    if (blocks.length === 0) {
      errorMsg.value = t('tools.mysqlToJava.noCreateTable')
      toast.error(t('toolsCommon.invalidInput'))
      return
    }
    const result = []
    for (const block of blocks) {
      const table = parseTable(block, config.value.tinyintBool, warnList)
      if (table.columns.length === 0) {
        warnList.push(
          t('tools.mysqlToJava.noColumns').replace('%1', table.tableName)
        )
        continue
      }
      const imports = buildImports(table, config.value.lombok)
      const code =
        (imports.length ? imports.join('\n') + '\n\n' : '') + buildClassCode(table, config.value.lombok)
      result.push({ ...table, code })
    }
    if (result.length === 0) {
      errorMsg.value = t('tools.mysqlToJava.noCreateTable')
      toast.error(t('toolsCommon.invalidInput'))
      return
    }
    warnings.value = warnList
    tables.value = result
    toast.success(
      t('tools.mysqlToJava.generated').replace('%1', String(result.length))
    )
  } catch (e) {
    tables.value = []
    errorMsg.value = e && e.message ? e.message : t('toolsCommon.error')
    toast.error(t('toolsCommon.error'))
  }
}

function loadExample() {
  input.value = EXAMPLE_SQL
  errorMsg.value = ''
}

function clearInput() {
  input.value = ''
  tables.value = []
  warnings.value = []
  errorMsg.value = ''
}

function downloadClass(table) {
  try {
    downloadText(table.code, table.className + '.java', 'text/plain;charset=utf-8')
    toast.success(t('toolsCommon.download') + ' - ' + table.className + '.java')
  } catch (e) {
    toast.error(t('toolsCommon.error'))
  }
}

const hasResult = computed(() => tables.value.length > 0)
</script>

<template>
  <ToolPage tool-id="mysqlToJava">
    <!-- 选项与操作 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.lombok" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.mysqlToJava.useLombok') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input v-model="config.tinyintBool" type="checkbox" class="w-4 h-4 accent-blue-600" />
          {{ t('tools.mysqlToJava.tinyintAsBoolean') }}
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" class="btn-primary" @click="convert">
          {{ t('tools.mysqlToJava.generate') }}
        </button>
        <button type="button" class="btn-ghost" @click="loadExample">
          {{ t('toolsCommon.example') }}
        </button>
        <button type="button" class="btn-danger ml-auto" @click="clearInput">
          {{ t('toolsCommon.clear') }}
        </button>
      </div>
    </section>

    <!-- 输入 -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label for="mysql-input" class="label-base">{{ t('tools.mysqlToJava.inputLabel') }}</label>
      <textarea
        id="mysql-input"
        v-model="input"
        class="input-base w-full font-mono h-64 resize-y"
        :placeholder="t('tools.mysqlToJava.inputPlaceholder')"
        spellcheck="false"
      ></textarea>
      <p v-if="errorMsg" class="text-red-600 text-sm mt-3 break-all">{{ errorMsg }}</p>
    </section>

    <!-- 输出：每个类一个代码块 -->
    <section v-if="hasResult" class="glass-card p-4 sm:p-6 mb-4">
      <div class="section-title">{{ t('toolsCommon.result') }}</div>

      <ul v-if="warnings.length" class="mb-4 space-y-1">
        <li v-for="(w, i) in warnings" :key="i" class="text-amber-600 text-xs break-all">
          {{ w }}
        </li>
      </ul>

      <div v-for="table in tables" :key="table.className" class="mb-6 last:mb-0">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span class="chip">{{ table.className }}</span>
          <span v-if="table.comment" class="text-xs text-slate-500">{{ table.comment }}</span>
          <div class="ml-auto flex items-center gap-2">
            <CopyButton :text="table.code" :label="t('toolsCommon.copy')" />
            <button type="button" class="btn-ghost" @click="downloadClass(table)">
              {{ t('toolsCommon.download') }} .java
            </button>
          </div>
        </div>
        <pre class="font-mono text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto text-slate-700">{{ table.code }}</pre>
      </div>
    </section>
  </ToolPage>
</template>

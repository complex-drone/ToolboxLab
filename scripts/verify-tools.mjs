// 工具完整性与 i18n 键结构校验
// 数据源：目录扫描 + toolsRegistry.js 解析（无硬编码清单）
// 运行：npm run verify:tools
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const root = path.resolve(process.cwd(), 'src')
const viewsDir = path.join(root, 'views/tools')
const zhDir = path.join(root, 'locales/tools/zh-CN')
const enDir = path.join(root, 'locales/tools/en-US')

// 1) 收集组件文件与语言包 id
const vueFiles = fs.readdirSync(viewsDir).filter(f => f.endsWith('.vue')).sort()
const zhIds = fs.readdirSync(zhDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort()
const enIds = fs.readdirSync(enDir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort()

const problems = []

// 2) 组件 ↔ 语言包一一对应（组件文件为 PascalCase，语言包 id 为 camelCase）
const pascalToCamel = name => name.charAt(0).toLowerCase() + name.slice(1)
for (const vf of vueFiles) {
  const id = pascalToCamel(vf.replace(/\.vue$/, ''))
  if (!zhIds.includes(id)) problems.push(`组件 ${vf} 缺少 zh-CN 语言包 ${id}.js`)
  if (!enIds.includes(id)) problems.push(`组件 ${vf} 缺少 en-US 语言包 ${id}.js`)
}
for (const id of zhIds) {
  if (!enIds.includes(id)) problems.push(`语言包 ${id}: zh-CN 有而 en-US 无`)
  const camel = id.charAt(0).toUpperCase() + id.slice(1)
  if (!vueFiles.includes(`${camel}.vue`)) problems.push(`语言包 ${id} 没有对应组件 ${camel}.vue`)
}
for (const id of enIds) {
  if (!zhIds.includes(id)) problems.push(`语言包 ${id}: en-US 有而 zh-CN 无`)
}

// 3) 注册表解析：每个 tool('id', '/path', 'File.vue') 都有实体文件
const registrySrc = fs.readFileSync(path.join(root, 'router/toolsRegistry.js'), 'utf8')
const toolRe = /tool\(\s*'([a-zA-Z0-9]+)'\s*,\s*'[^']+'\s*,\s*'([^']+\.vue)'\s*,/g
let m
const registryIds = new Set()
while ((m = toolRe.exec(registrySrc)) !== null) {
  const [, id, file] = m
  registryIds.add(id)
  if (!fs.existsSync(path.join(viewsDir, file))) problems.push(`注册表条目 ${id} 指向的 ${file} 不存在`)
  if (!zhIds.includes(id)) problems.push(`注册表条目 ${id} 缺少语言包`)
}
if (registrySrc.includes("path: '/password'")) registryIds.add('password')
const orphanComponents = vueFiles
  .map(f => pascalToCamel(f.replace(/\.vue$/, '')))
  .filter(id => !registryIds.has(id))
orphanComponents.forEach(id => problems.push(`组件 ${id}.vue 未在 toolsRegistry.js 注册`))

// 4) zh/en 键结构深度一致
function keysOf(obj, prefix = '') {
  const keys = []
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (obj[k] && typeof obj[k] === 'object') keys.push(...keysOf(obj[k], full))
    else keys.push(full)
  }
  return keys
}

let checked = 0
for (const id of zhIds) {
  if (!enIds.includes(id)) continue
  try {
    const zh = (await import(pathToFileURL(path.join(zhDir, `${id}.js`)))).default
    const en = (await import(pathToFileURL(path.join(enDir, `${id}.js`)))).default
    const zk = new Set(keysOf(zh))
    const ek = new Set(keysOf(en))
    for (const k of zk) if (!ek.has(k)) problems.push(`${id}: 键仅在 zh-CN 存在 → ${k}`)
    for (const k of ek) if (!zk.has(k)) problems.push(`${id}: 键仅在 en-US 存在 → ${k}`)
    if (!('title' in zh) || !('description' in zh)) problems.push(`${id}: 语言包缺少 title/description`)
    checked++
  } catch (e) {
    problems.push(`${id}: 语言包导入失败 ${String(e.message).slice(0, 80)}`)
  }
}

console.log(`组件: ${vueFiles.length} · 语言包对: ${checked} · 注册表条目: ${registryIds.size}`)
if (problems.length === 0) {
  console.log('✅ 全部校验通过')
} else {
  console.log(`❌ ${problems.length} 个问题:`)
  problems.forEach(p => console.log('  - ' + p))
  process.exitCode = 1
}

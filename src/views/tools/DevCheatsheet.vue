<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorage } from '@vueuse/core'
import ToolPage from '@/components/tools/ToolPage.vue'
import CopyButton from '@/components/tools/CopyButton.vue'

/**
 * 开发文档速查
 * - 条目数据（标签名 / 示例代码 / 中英关键词）为组件内常量，说明文字走 i18n
 * - 分类 Tab 状态持久化，顶部搜索框对名称、关键词、说明实时过滤
 */
const { t } = useI18n()

const config = useStorage('tool-dev-cheatsheet-config', {
  category: 'html',
})

/* ---------------- 条目数据（代码与关键词为常量，说明见语言包） ---------------- */

const HTML_ITEMS = [
  {
    id: 'htmlDiv',
    label: '<div>',
    keywords: ['div', 'block', 'container', 'box', '块级', '容器', '盒子', '布局'],
    code: '<div class="card">\n  <h2>Title</h2>\n  <p>Content here</p>\n</div>',
  },
  {
    id: 'htmlSpan',
    label: '<span>',
    keywords: ['span', 'inline', 'text', '行内', '文字', '片段'],
    code: '<p>Price: <span class="price">99</span> USD</p>',
  },
  {
    id: 'htmlA',
    label: '<a>',
    keywords: ['a', 'link', 'anchor', 'href', '链接', '锚点', '跳转'],
    code: '<a href="https://example.com" target="_blank" rel="noopener">\n  Visit site\n</a>',
  },
  {
    id: 'htmlImg',
    label: '<img>',
    keywords: ['img', 'image', 'picture', 'alt', '图片', '图像', '懒加载'],
    code: '<img\n  src="./photo.png"\n  alt="A photo"\n  width="320"\n  height="240"\n  loading="lazy"\n/>',
  },
  {
    id: 'htmlUl',
    label: '<ul> / <li>',
    keywords: ['ul', 'ol', 'li', 'list', 'dl', '列表', '无序', '有序'],
    code: '<ul>\n  <li>First</li>\n  <li>Second</li>\n  <li>Third</li>\n</ul>',
  },
  {
    id: 'htmlTable',
    label: '<table>',
    keywords: ['table', 'thead', 'tbody', 'tr', 'th', 'td', '表格', '表头'],
    code: '<table>\n  <thead>\n    <tr><th>Name</th><th>Age</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>Tom</td><td>18</td></tr>\n  </tbody>\n</table>',
  },
  {
    id: 'htmlForm',
    label: '<form>',
    keywords: ['form', 'submit', 'post', 'get', '表单', '提交'],
    code: '<form action="/api/save" method="post">\n  <input name="email" type="email" required />\n  <button type="submit">Submit</button>\n</form>',
  },
  {
    id: 'htmlInput',
    label: '<input>',
    keywords: ['input', 'text', 'password', 'email', 'checkbox', 'radio', '输入框', '单选', '多选'],
    code: '<input\n  type="password"\n  name="pwd"\n  placeholder="At least 8 chars"\n  minlength="8"\n  required\n/>',
  },
  {
    id: 'htmlSelect',
    label: '<select>',
    keywords: ['select', 'option', 'dropdown', 'combobox', '下拉', '选择框'],
    code: '<select name="city">\n  <option value="">Please choose</option>\n  <option value="bj" selected>Beijing</option>\n  <option value="sh">Shanghai</option>\n</select>',
  },
  {
    id: 'htmlTextarea',
    label: '<textarea>',
    keywords: ['textarea', 'multiline', 'rows', '多行', '文本域', '留言'],
    code: '<textarea\n  name="bio"\n  rows="4"\n  cols="30"\n  maxlength="200"\n  placeholder="Tell us about you"\n></textarea>',
  },
  {
    id: 'htmlButton',
    label: '<button>',
    keywords: ['button', 'submit', 'reset', 'click', '按钮', '点击'],
    code: '<button type="button" class="btn" disabled>\n  Save draft\n</button>',
  },
  {
    id: 'htmlIframe',
    label: '<iframe>',
    keywords: ['iframe', 'embed', 'frame', '嵌套', '内嵌', '框架', '嵌入页面'],
    code: '<iframe\n  src="https://example.com"\n  width="600"\n  height="400"\n  loading="lazy"\n  title="Embedded page"\n></iframe>',
  },
  {
    id: 'htmlVideo',
    label: '<video>',
    keywords: ['video', 'audio', 'media', 'player', 'poster', '视频', '播放器', '封面'],
    code: '<video\n  src="./demo.mp4"\n  controls\n  width="480"\n  poster="./cover.jpg"\n></video>',
  },
  {
    id: 'htmlMeta',
    label: '<meta>',
    keywords: ['meta', 'charset', 'viewport', 'head', '编码', '视口', '移动端适配', '元信息'],
    code: '<meta charset="UTF-8" />\n<meta\n  name="viewport"\n  content="width=device-width, initial-scale=1.0"\n/>',
  },
  {
    id: 'htmlSemantic',
    label: 'Semantic Tags',
    keywords: ['header', 'nav', 'main', 'article', 'aside', 'footer', 'section', '语义化', '结构标签'],
    code: '<header>Site header</header>\n<nav>Menu</nav>\n<main>\n  <article>Post</article>\n  <aside>Sidebar</aside>\n</main>\n<footer>Footer</footer>',
  },
  {
    id: 'htmlLabel',
    label: '<label>',
    keywords: ['label', 'for', 'accessibility', 'a11y', '标签', '无障碍', '表单关联'],
    code: '<label for="email">Email</label>\n<input id="email" name="email" type="email" />',
  },
]

const CSS_ITEMS = [
  {
    id: 'cssFlexCenter',
    label: 'Flex Center',
    keywords: ['flex', 'center', 'justify-content', 'align-items', '居中', '弹性布局', '垂直居中'],
    code: '.container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}',
  },
  {
    id: 'cssFlexBetween',
    label: 'Flex Between',
    keywords: ['flex', 'space-between', 'navbar', 'gap', '导航栏', '两端对齐', '间距'],
    code: '.navbar {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n}',
  },
  {
    id: 'cssGridCols',
    label: 'Grid Columns',
    keywords: ['grid', 'grid-template-columns', 'repeat', 'fr', '网格', '三栏', '等分'],
    code: '.grid {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 16px;\n}',
  },
  {
    id: 'cssGridAuto',
    label: 'Grid Auto Fill',
    keywords: ['grid', 'auto-fill', 'minmax', 'responsive', '响应式', '自适应', '网格'],
    code: '.list {\n  display: grid;\n  grid-template-columns:\n    repeat(auto-fill, minmax(180px, 1fr));\n}',
  },
  {
    id: 'cssPosition',
    label: 'Absolute Position',
    keywords: ['position', 'absolute', 'relative', 'top', 'right', '定位', '绝对定位', '相对定位', '角标'],
    code: '.parent { position: relative; }\n.badge {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n}',
  },
  {
    id: 'cssSticky',
    label: 'Sticky Header',
    keywords: ['position', 'sticky', 'top', 'z-index', '粘性', '吸顶', '固定头部'],
    code: '.header {\n  position: sticky;\n  top: 0;\n  z-index: 10;\n  backdrop-filter: blur(6px);\n}',
  },
  {
    id: 'cssHover',
    label: ':hover / :active',
    keywords: ['hover', 'active', 'focus-visible', 'pseudo', '伪类', '悬停', '交互'],
    code: '.btn:hover { background: #2563eb; }\n.btn:active { transform: scale(0.98); }\n.btn:focus-visible {\n  outline: 2px solid #60a5fa;\n}',
  },
  {
    id: 'cssNth',
    label: ':nth-child()',
    keywords: ['nth-child', 'first-child', 'last-child', 'even', 'odd', '伪类', '奇偶', '隔行'],
    code: 'li:nth-child(2n) { background: #f1f5f9; }\nli:first-child { font-weight: 700; }\nli:last-child { border-bottom: none; }',
  },
  {
    id: 'cssBefore',
    label: '::before / ::after',
    keywords: ['before', 'after', 'pseudo-element', 'content', '伪元素', '装饰', '清除浮动'],
    code: '.tag::before { content: "#"; color: #64748b; }\n.clearfix::after {\n  content: "";\n  display: block;\n  clear: both;\n}',
  },
  {
    id: 'cssTransition',
    label: 'Transition',
    keywords: ['transition', 'animation', 'transform', 'ease', '过渡', '动画', '缓动'],
    code: '.card {\n  transition: transform 0.2s ease,\n    box-shadow 0.2s ease;\n}\n.card:hover { transform: translateY(-4px); }',
  },
  {
    id: 'cssMedia',
    label: 'Media Query',
    keywords: ['media', 'max-width', 'responsive', 'breakpoint', '媒体查询', '响应式', '断点', '屏幕宽度'],
    code: '@media (max-width: 768px) {\n  .sidebar { display: none; }\n  .main { width: 100%; }\n}',
  },
  {
    id: 'cssEllipsis',
    label: 'Text Ellipsis',
    keywords: ['ellipsis', 'overflow', 'white-space', 'text-overflow', '省略号', '溢出', '截断'],
    code: '.title {\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}',
  },
  {
    id: 'cssGradient',
    label: 'Linear Gradient',
    keywords: ['gradient', 'background', 'linear-gradient', '渐变', '背景色', '过渡色'],
    code: '.banner {\n  background: linear-gradient(\n    135deg, #6366f1, #ec4899\n  );\n}',
  },
  {
    id: 'cssVars',
    label: 'CSS Variables',
    keywords: ['custom properties', 'var', 'root', 'theme', '变量', '自定义属性', '主题'],
    code: ':root {\n  --primary: #2563eb;\n  --radius: 12px;\n}\n.btn {\n  color: var(--primary);\n  border-radius: var(--radius);\n}',
  },
  {
    id: 'cssRadiusShadow',
    label: 'Radius + Shadow',
    keywords: ['border-radius', 'box-shadow', 'card', '圆角', '投影', '阴影', '卡片'],
    code: '.card {\n  border-radius: 16px;\n  box-shadow: 0 8px 24px\n    rgba(15, 23, 42, 0.12);\n}',
  },
  {
    id: 'cssCenterAbs',
    label: 'Fixed Center',
    keywords: ['fixed', 'translate', 'center', 'modal', '居中', '弹窗', '固定定位'],
    code: '.modal {\n  position: fixed;\n  left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);\n}',
  },
]

const JS_ITEMS = [
  {
    id: 'jsMap',
    label: 'Array.map',
    keywords: ['map', 'array', 'transform', '数组', '映射', '遍历'],
    code: 'const nums = [1, 2, 3];\nconst doubled = nums.map((n) => n * 2);\n// [2, 4, 6]',
  },
  {
    id: 'jsFilter',
    label: 'Array.filter',
    keywords: ['filter', 'array', '数组', '过滤', '筛选'],
    code: 'const nums = [1, 2, 3, 4];\nconst evens = nums.filter((n) => n % 2 === 0);\n// [2, 4]',
  },
  {
    id: 'jsReduce',
    label: 'Array.reduce',
    keywords: ['reduce', 'array', 'sum', 'accumulate', '数组', '累加', '归并', '求和'],
    code: 'const nums = [1, 2, 3, 4];\nconst sum = nums.reduce(\n  (acc, n) => acc + n, 0,\n);\n// 10',
  },
  {
    id: 'jsFind',
    label: 'find / findIndex',
    keywords: ['find', 'findIndex', 'search', 'array', '查找', '搜索', '下标'],
    code: 'const users = [{ id: 1 }, { id: 2 }];\nconst user = users.find((u) => u.id === 2);\nconst index = users.findIndex(\n  (u) => u.id === 2,\n);',
  },
  {
    id: 'jsSomeEvery',
    label: 'some / every',
    keywords: ['some', 'every', 'array', 'check', '数组', '判断', '校验'],
    code: '[1, 2, 3].some((n) => n > 2); // true\n[1, 2, 3].every((n) => n > 0); // true',
  },
  {
    id: 'jsIncludes',
    label: 'includes / indexOf',
    keywords: ['includes', 'indexOf', 'contains', 'string', 'array', '包含', '查找', '位置'],
    code: "'hello'.includes('ell'); // true\n[1, 2].includes(2); // true\n'hello'.indexOf('l'); // 2",
  },
  {
    id: 'jsSplit',
    label: 'split / join',
    keywords: ['split', 'join', 'string', 'array', '字符串', '数组', '拆分', '拼接'],
    code: "'a,b,c'.split(',');\n// ['a', 'b', 'c']\n['a', 'b'].join('-'); // 'a-b'",
  },
  {
    id: 'jsTrim',
    label: 'trim / slice',
    keywords: ['trim', 'toUpperCase', 'toLowerCase', 'slice', 'string', '字符串', '空格', '大小写', '截取'],
    code: "'  hi  '.trim(); // 'hi'\n'hi'.toUpperCase(); // 'HI'\n'HI'.toLowerCase(); // 'hi'\n'hi'.slice(0, 1); // 'h'",
  },
  {
    id: 'jsSpread',
    label: 'Spread ...',
    keywords: ['spread', 'rest', 'merge', 'clone', '展开', '合并', '浅拷贝', '剩余参数'],
    code: 'const a = [1, 2];\nconst b = [...a, 3]; // [1, 2, 3]\nconst obj = { name: "Tom" };\nconst merged = { ...obj, age: 18 };',
  },
  {
    id: 'jsDestructure',
    label: 'Destructuring',
    keywords: ['destructure', 'assign', 'default', '解构', '赋值', '默认值'],
    code: 'const { name, age = 18 } = user;\nconst [first, ...rest] = list;\nfunction fn(config) {\n  const { title } = config;\n}',
  },
  {
    id: 'jsTemplate',
    label: 'Template Literal',
    keywords: ['template', 'literal', 'backtick', 'string', '模板字符串', '反引号', '插值'],
    code: 'const name = "Tom";\nconst msg = `Hello, ${name}!`;\nconst html = `<div>${msg}</div>`;',
  },
  {
    id: 'jsOptional',
    label: 'Optional Chaining',
    keywords: ['optional', 'chaining', 'null', 'safe', '可选链', '空值', '安全访问'],
    code: 'const city = user?.address?.city;\ndocument\n  .querySelector(".btn")\n  ?.click();',
  },
  {
    id: 'jsNullish',
    label: 'Nullish ??',
    keywords: ['nullish', 'coalescing', 'default', 'or', '空值合并', '默认值', '短路'],
    code: 'const port = config.port ?? 3000;\nconst n = 0 || 10; // 10\nconst m = 0 ?? 10; // 0',
  },
  {
    id: 'jsJson',
    label: 'JSON',
    keywords: ['json', 'parse', 'stringify', '序列化', '反序列化', '格式化'],
    code: 'const data = JSON.parse(raw);\nconst text = JSON.stringify(\n  { a: 1 }, null, 2,\n);',
  },
  {
    id: 'jsDate',
    label: 'Date',
    keywords: ['date', 'time', 'timestamp', 'iso', '日期', '时间', '时间戳', '格式化'],
    code: 'const now = new Date();\nnow.getFullYear(); // 2026\nnow.toISOString().slice(0, 10);\nDate.now(); // ms timestamp',
  },
  {
    id: 'jsAsync',
    label: 'async / await',
    keywords: ['async', 'await', 'promise', 'fetch', 'try', 'catch', '异步', '请求', '错误处理'],
    code: 'async function load() {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error(res.status);\n    return await res.json();\n  } catch (err) {\n    console.error(err);\n  }\n}',
  },
  {
    id: 'jsTimer',
    label: 'setTimeout',
    keywords: ['setTimeout', 'setInterval', 'timer', 'clearTimeout', '定时器', '延时', '轮询'],
    code: 'const timer = setTimeout(fn, 1000);\nclearTimeout(timer);\nconst loop = setInterval(fn, 5000);\nclearInterval(loop);',
  },
  {
    id: 'jsStorage',
    label: 'localStorage',
    keywords: ['localstorage', 'storage', 'session', 'persist', '本地存储', '缓存', '持久化'],
    code: "localStorage.setItem('key', JSON.stringify(data));\nconst raw = localStorage.getItem('key');\nconst data = raw ? JSON.parse(raw) : null;\nlocalStorage.removeItem('key');",
  },
]

const CATEGORIES = [
  { id: 'html', items: HTML_ITEMS },
  { id: 'css', items: CSS_ITEMS },
  { id: 'js', items: JS_ITEMS },
]

/* ---------------- 分类切换 / 搜索过滤 ---------------- */

const query = ref('')

const activeCategory = computed(() => {
  return CATEGORIES.find((c) => c.id === config.value.category) || CATEGORIES[0]
})

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  const items = activeCategory.value.items
  if (!q) return items
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true
    if (item.keywords.some((k) => k.toLowerCase().includes(q))) return true
    let desc = ''
    try {
      desc = t(`tools.devCheatsheet.items.${item.id}.desc`)
    } catch {
      desc = ''
    }
    return desc.toLowerCase().includes(q)
  })
})

function itemDesc(id) {
  return t(`tools.devCheatsheet.items.${id}.desc`)
}
</script>

<template>
  <ToolPage tool-id="devCheatsheet">
    <!-- 搜索 + 分类 Tab -->
    <section class="glass-card p-4 sm:p-6 mb-4">
      <label class="label-base" for="dev-cheatsheet-search">
        {{ t('tools.devCheatsheet.searchLabel') }}
      </label>
      <div class="relative">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          id="dev-cheatsheet-search"
          v-model="query"
          type="search"
          class="input-base pl-9"
          :placeholder="t('tools.devCheatsheet.searchPlaceholder')"
          :aria-label="t('tools.devCheatsheet.searchLabel')"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-4" role="tablist" :aria-label="t('tools.devCheatsheet.title')">
        <button
          v-for="cat in CATEGORIES"
          :key="cat.id"
          type="button"
          role="tab"
          class="px-4 py-1.5 rounded-full text-sm font-medium transition select-none"
          :class="
            activeCategory.id === cat.id
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white/70 text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'
          "
          :aria-selected="activeCategory.id === cat.id"
          @click="config.category = cat.id"
        >
          {{ t(`tools.devCheatsheet.tabs.${cat.id}`) }}
          <span class="text-xs opacity-70">{{ cat.items.length }}</span>
        </button>
        <span class="ml-auto text-xs text-slate-400">
          {{ filteredItems.length }} / {{ activeCategory.items.length }} {{ t('toolsCommon.items') }}
        </span>
      </div>
    </section>

    <!-- 条目卡片网格 -->
    <section v-if="filteredItems.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <article
        v-for="item in filteredItems"
        :key="item.id"
        class="glass-card p-4 flex flex-col"
      >
        <div class="flex items-center justify-between gap-2 mb-2">
          <h3 class="text-sm font-semibold text-blue-600 font-mono truncate" :title="item.label">
            {{ item.label }}
          </h3>
          <CopyButton :text="item.code" compact :label="t('tools.devCheatsheet.copyCode')" />
        </div>
        <pre class="mb-2 px-3 py-2.5 rounded-lg bg-slate-800 text-slate-100 text-xs font-mono leading-relaxed overflow-x-auto" tabindex="0">{{ item.code }}</pre>
        <p class="text-xs text-slate-500 leading-relaxed mt-auto">{{ itemDesc(item.id) }}</p>
      </article>
    </section>

    <!-- 空状态 -->
    <section v-else class="glass-card p-8 text-center">
      <p class="text-sm text-slate-400">{{ t('tools.devCheatsheet.empty') }}</p>
    </section>
  </ToolPage>
</template>

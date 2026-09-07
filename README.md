# ToolboxLab

![Vue 3](https://img.shields.io/badge/Vue-3.5+-4FC08D?logo=vue.js)
![Vite](https://img.shields.io/badge/Vite-5.4+-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38BDF8?logo=tailwindcss)
![Tests](https://img.shields.io/badge/tests-148%20passed-22C55E)
![License](https://img.shields.io/badge/License-MIT-blue)

AI 辅助生成。一个基于 **Vue 3 + Vite** 的纯前端在线工具站，内置 **139 个工具**，所有功能均在本地浏览器运行，无需后端服务，数据不上传，保护您的隐私。支持中英双语。

- **在线访问**：<https://toolboxlab.pages.dev/>
- **问题反馈**：<https://github.com/complex-drone/ToolboxLab/issues>

## ✨ 工具列表（139 个）

### 🧰 格式校验与数据转换
JSON 格式化校验 · 时间戳转换 · URL 编解码与 Base64 · 正则表达式测试 · UUID/NanoID 生成 · 哈希生成（MD5/SHA）· JWT 解码 · Cron 表达式解析 · 代码/文本统计 · 命名风格转换 · 文本差异对比 · 文本去重排序 · JSON/YAML/XML 互转 · Markdown 实时预览 · 转义/反转义

### ✍️ 文本处理与开发辅助
进制转换（BigInt）· 假数据生成 · Lorem Ipsum · 二维码生成 · 图片格式转换/压缩 · 图片裁剪 · 图片与 Base64 互转 · EXIF 查看 · 颜色转换/取色器 · CSS 渐变生成 · Box Shadow 生成 · Flexbox/Grid 生成 · IP 查询 · HTTP 状态码 · User-Agent 解析 · DNS 记录查询 · 单位换算 · 摩斯密码（可播放）· 抽签决策 · SQL 格式化

### 💻 代码辅助与文档
开发文档速查 · 代码截图生成 · 代码行数统计（CLOC）· .gitignore 生成 · 开源许可证生成 · Commit 规范生成 · OpenAPI 预览 · cURL 转代码 · 空白字符显示 · MySQL 转 JavaBean · JSON 转 Go Struct · TOML 格式化 · YAML 格式化 · Emoji 搜索 · 科学/程序员计算器

### 🌐 网络与站长
Ping 检测 · Whois（RDAP）· HTTP Header 查看 · SSL 证书检测 · robots.txt 生成 · MIME 类型参考 · 子网计算器 · URL 解析器 · 端口参考 · .htaccess 转 Nginx · RSS 阅读器 · 货币汇率 · 全球时区时钟 · 短链接生成 · 网页截图

### 📀 文档与媒体
PDF 工具箱（合并/拆分/压缩）· PDF 转长图 · Word/Excel 转换 · Excel 转 JSON/CSV · 数学公式（KaTeX）· 思维导图 · 绘图画布 · 表格格式互转 · 视频比例转换 · 视频转 GIF · SVG 优化 · Favicon 生成 · 地理坐标转换 · 音频格式转换（WAV/PCM）· 繁简体转换（OpenCC）

### 🛡️ 安全、效率与杂项
密码生成器 · 密码强度分析 · AES/RSA 加解密（Web Crypto）· Bcrypt · SSH 密钥生成 · 文件校验和（流式）· 番茄钟 · 简历生成器 · MBTI 测试 · EVM 挣值计算 · 条形码生成 · 手持弹幕 · 人民币大写

### 📅 日期时间与计算器
日期计算器（差值/加减）· 年龄计算器（生肖/星座）· 工作日计算器（节假日/调休）

### 🔁 正则与文本可视化
正则铁路图（SVG 导出）· 正则构建器 · 文本结构分析

### 📊 图表与数据可视化
Mermaid 图表编辑器 · 甘特图生成器 · JSON 树形可视化 · 数据透视表 · 流程图编辑器

### ⚙️ DevOps 与配置生成
K8s YAML 生成器 · Nginx 配置生成 · Dockerfile 分析 · .env 管理 · Helm 模板 Playground

### 🧬 数据格式与 Schema
JSON Schema 生成 · JSON Schema 校验（ajv）· SQL 方言转换 · OpenAPI 转 Postman · 设计 Token 转换

### 🎨 设计与字体
Google 字体预览 · 图片调色板提取 · 字体对比

### 🕸️ 浏览器与网络高级
WebSocket 客户端 · CORS 检测 · 浏览器指纹 · 书签链接检查 · 页面性能分析

### 🧱 代码处理与安全
JS 混淆/美化（terser）· JSONPath 测试 · XPath 测试 · GraphQL/REST 转换

### 🔌 硬件与设备交互
设备信息 · 键盘测试 · 麦克风可视化

### 🧩 杂项增强
文本转语音 · Identicon 生成 · 十六进制文件查看 · 剪贴板历史 · CSV 编辑器 · 密码短语生成（EFF 词库）· 批量重命名 · Markdown 转 HTML · HTML 转 Markdown · JSON 差异对比

> 共性约定：配置经 `useStorage` 持久化；随机源统一使用 `crypto.getRandomValues` + 拒绝采样；所有输入均有错误边界（非法输入行内提示 + Toast，不白屏）；重依赖（PDF/视频/公式/图表等）按需懒加载；移动端优先响应式。全部 139 个工具均通过 `npm run verify:tools` 完整性校验与 Vitest 回归。

## 🛠 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| **Vue** | ^3.5.13 | Composition API + `<script setup>` |
| **Vite** | ^5.4.11 | 构建工具（构建目标 es2022，支持 pdfjs 的 top-level await） |
| **Vue Router** | ^4.6.4 | 语言前缀路由 + 工具注册表驱动 |
| **vue-i18n** | ^9.13.1 | 双语支持（Composition API 模式，`legacy: false`） |
| **@vueuse/core** | ^10.11.1 | `useStorage` 等组合式函数 |
| **Tailwind CSS** | ^3.4.17 | 毛玻璃风格 UI（关闭 preflight 保护存量样式） |
| **Vitest** | ^2.1.9 | 单元/组件/集成测试（148 个用例） |
| 功能库 | 按需 | mermaid（图表）/ frappe-gantt（甘特图）/ ajv（Schema 校验）/ turndown（HTML→MD）/ terser（混淆）/ regexp-tree + railroad-diagrams（铁路图）/ jsonpath-plus（JSONPath），重依赖一律函数内 `await import()` 懒加载 |

## 📁 项目结构

```
toolboxlab/
├── index.html                  # 入口 HTML（Cloudflare Analytics 动态注入）
├── vite.config.js / vitest.config.js
├── tailwind.config.js / postcss.config.js
├── scripts/
│   ├── generate-sitemap.js     # sitemap 生成（路由清单从工具注册表解析派生）
│   ├── verify-tools.mjs        # 工具/语言包完整性校验（npm run verify:tools）
│   └── validate-analytics.js
├── docs/
│   ├── TEST-PLAN.md            # 测试计划
│   ├── TEST-REPORT.md          # 测试报告（148 用例）
│   └── TEST-REPORT-SUPPLEMENT.md  # 补充测试报告（真实浏览器验收）
├── tests/                      # Vitest 测试（unit / component / integration）
├── public/                     # 静态资源（_headers、_redirects、robots.txt 等）
└── src/
    ├── main.js                 # 应用入口（含全局错误兜底）
    ├── App.vue                 # 根组件（布局 + SEO 元数据 + 页脚反馈入口）
    ├── router/
    │   ├── index.js            # 路由（由注册表生成 /:locale?/<tool-path>）
    │   └── toolsRegistry.js    # ★ 工具注册表：全部工具的单一数据源
    ├── views/
    │   ├── HomeView.vue        # 首页（分类 + 搜索）
    │   ├── AboutView.vue
    │   └── tools/              # ★ 138 个工具页面组件（139 个工具，密码生成器复用共享组件）
    ├── components/
    │   ├── PasswordGenerator.vue
    │   ├── LocaleSwitcher.vue
    │   ├── Toast.vue
    │   └── tools/              # 工具页共享组件（ToolPage / CopyButton / FileDropZone）
    ├── composables/
    │   └── useToast.js         # 全局 Toast
    ├── locales/
    │   ├── index.js            # i18n 实例（自动合并工具语言包片段）
    │   ├── zh-CN.js / en-US.js # 全局语言包（含 toolsCommon 公共文案）
    │   └── tools/
    │       ├── zh-CN/          # ★ 每个工具一个语言包片段（<toolId>.js）
    │       └── en-US/
    ├── styles/tailwind.css     # Tailwind 入口 + 毛玻璃组件类
    └── utils/                  # 共享纯函数
        ├── random.js           # 加密级随机（拒绝采样）
        ├── clipboard.js / download.js / format.js
        ├── rmb.js / html.js / number.js / url.js
        ├── effWordlist.js      # EFF Large Wordlist（密码短语生成器词库）
        └── password.js
```

## 🚀 快速开始

环境要求：Node.js >= 18（开发环境使用 Node 24）。

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器 http://localhost:5173
npm test           # 运行 148 个测试用例
npm run build      # 生产构建 + 生成 sitemap
npm run preview    # 预览生产构建
```

### npm 脚本一览

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（HMR，默认端口 5173） |
| `npm test` / `npm run test:watch` | 运行测试 / 监听模式 |
| `npm run build` | 生产构建并生成 sitemap |
| `npm run build:prod` | 以 production 模式构建 |
| `npm run preview` | 本地预览构建产物 |
| `npm run verify:tools` | 校验工具组件、语言包与注册表的一致性 |
| `npm run validate:analytics` | 校验 Cloudflare Analytics 配置 |

## 🧩 添加新工具

工具站采用**注册表驱动**架构，新增工具只需三步：

1. **创建组件** `src/views/tools/MyTool.vue`（页面外壳用共享组件 `ToolPage`，UI 用 Tailwind + 毛玻璃组件类 `.glass-card` / `.btn-primary` / `.input-base`）
2. **创建语言包** `src/locales/tools/zh-CN/myTool.js` 与 `src/locales/tools/en-US/myTool.js`（必须包含 `title` 与 `description`，中英键结构一致）
3. **注册路由** 在 `src/router/toolsRegistry.js` 的对应分类中添加一行：

```js
tool('myTool', '/my-tool', 'MyTool.vue', '🔧'),
```

组件与语言包均通过 `import.meta.glob` 自动加载，随后运行 `npm run verify:tools` 校验一致性。sitemap 在构建时从注册表自动派生，无需单独维护。

## 🌍 国际化

- **语言**：简体中文（`zh-CN`，默认）/ English（`en-US`）
- **URL 结构**：SEO 友好的语言前缀格式（`/zh-CN/json-formatter`、`/en-US/about`）
- **优先级**：URL 语言前缀 > localStorage 偏好 > 浏览器语言 > 默认中文
- **结构**：全局文案在 `locales/<lang>.js`，各工具文案独立成片段（`locales/tools/<lang>/<toolId>.js`），自动挂载到 `tools.<toolId>` 命名空间
- **SEO**：hreflang / canonical / 每页独立 title 与 description / 多语言 sitemap（构建时生成）

## 🔒 隐私与安全

- **所有数据处理均在本地浏览器完成**，不收集、不存储、不传输任何用户数据
- 少量网络类工具（IP/Whois/RSS/汇率等）调用第三方公共 API 时，仅发送待查询的目标值，不含任何个人数据，页面内均有说明
- 密码强度分析等敏感输入**不写入 localStorage**
- 部署于 Cloudflare Pages：`public/_headers` 配置 CSP、HSTS 等安全头；`_redirects` 处理重定向
- Cloudflare Web Analytics 通过 `VITE_CLOUDFLARE_ANALYTICS_TOKEN` 环境变量注入（无 token 时不加载），详见 [CLOUDFLARE_ANALYTICS.md](./CLOUDFLARE_ANALYTICS.md)

## 🐛 反馈问题

发现 bug 或有功能建议，欢迎 [提交 Issue](https://github.com/complex-drone/ToolboxLab/issues)，也可直接访问[项目仓库](https://github.com/complex-drone/ToolboxLab)。站点页脚同样有反馈入口。

## 📄 许可证

[MIT](https://github.com/complex-drone/ToolboxLab/blob/main/LICENSE)

---

**ToolboxLab** - 纯前端本地工具集，让工具更简单、更安全、更快速。

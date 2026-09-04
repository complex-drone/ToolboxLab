# ToolboxLab

![Vue 3](https://img.shields.io/badge/Vue-3.5+-4FC08D?logo=vue.js)
![Vite](https://img.shields.io/badge/Vite-5.4+-646CFF?logo=vite)
![License](https://img.shields.io/badge/License-MIT-blue)

AI辅助生成。一个基于 **Vue 3 + Vite** 的纯前端工具站，所有功能均在本地浏览器运行，无需后端服务，保护您的隐私安全。支持多语言国际化。

## 🌐 在线访问

- **生产环境**：[https://toolboxlab.pages.dev/](https://toolboxlab.pages.dev/)

## 📖 项目简介

**ToolboxLab**是一个现代化的纯前端工具集合网站，采用最新的 Vue 3 Composition API 和 Vite 构建工具开发。所有数据处理和计算均在用户的本地浏览器中完成，不会上传至任何服务器，确保您的隐私和安全。

## ✨ 功能列表

### 🌐 多语言国际化

- **简体中文 / English**：支持中文和英文两种语言
- **语言偏好持久化**：用户选择的语言自动保存到 localStorage
- **智能回退**：用户偏好 > 浏览器语言检测 > 默认简体中文
- **全局覆盖**：所有界面文本、Toast 提示、占位符均支持多语言切换

### 🔐 密码生成器

功能强大的本地密码生成工具，支持以下特性：

#### 核心功能
- **长度控制**：支持 4-64 位密码长度，自由拖动滑块或点击预设快捷长度（12/16/24/32/64）
- **字符选项**：可自由选择大写字母、小写字母、数字、特殊符号四类字符
- **排除符号**：可排除特定特殊符号，支持批量排除 HTML 符号（`< > { }`）和 URL 符号（`/ ? & =`）
- **排除易混淆字符**：自动过滤 0/O、1/l 等易混淆字符，避免输入错误
- **密码强度指示**：实时显示密码强度（弱/中等/强），基于熵值计算（bits）
- **密码可见性切换**：一键切换密码显示/隐藏状态
- **一键复制**：快速复制生成的密码到剪贴板
- **生成动画**：流畅的密码生成滚动动画效果

#### 技术特性
- **配置持久化**：使用 `@vueuse/core` 的 `useStorage`，所有设置自动保存到 localStorage
- **加密级随机源**：优先使用 `crypto.getRandomValues`，降级使用 `Math.random`
- **防取模偏差**：使用拒绝采样算法确保随机数均匀分布
- **每类至少一个字符**：保证每种选中的字符类型至少出现一次
- **Fisher-Yates 洗牌**：打散字符顺序，避免头部聚集
- **页面隐藏自动隐藏密码**：切换标签页时自动隐藏密码，保护隐私

### 🎨 工具站框架

- **毛玻璃效果**：现代化的磨砂玻璃设计，半透明背景搭配柔和阴影
- **响应式设计**：完美适配桌面、平板和手机等不同设备
- **工具卡片列表**：首页展示所有可用工具，卡片式布局美观易用
- **关于页面**：详细介绍工具站的特性、技术栈和隐私保护
- **Toast 通知**：优雅的全局提示系统，支持成功、信息、错误三种类型
- **路由导航**：基于 Vue Router 的前端路由，支持页面切换

## 🛠 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| **Vue** | ^3.5.13 | 渐进式 JavaScript 框架，使用 Composition API |
| **Vite** | ^5.4.11 | 下一代前端构建工具，极速热更新 |
| **Vue Router** | ^4.6.4 | Vue.js 官方路由管理器 |
| **vue-i18n** | ^9.13.1 | 国际化多语言支持（Composition API 模式，legacy: false） |
| **@vueuse/core** | ^10.11.1 | Vue 3 组合式函数集合，用于状态持久化 |

## 📁 项目结构

```
toolboxlab/
├── index.html                 # 入口 HTML（含 Cloudflare Analytics 动态注入）
├── package.json               # 项目配置与依赖
├── vite.config.js             # Vite 配置（别名、构建、环境变量注入）
├── .env.example               # 环境变量模板（提交到 Git）
├── .env.local                 # 本地环境变量（不提交，含真实 token）
├── .gitignore                 # Git 忽略配置
├── README.md                  # 项目说明文档
├── CLOUDFLARE_ANALYTICS.md    # Cloudflare Analytics 配置说明
├── scripts/                   # 构建与校验脚本
│   ├── generate-sitemap.js    # sitemap 生成脚本（构建时执行）
│   └── validate-analytics.js # Analytics 配置校验脚本
├── public/                    # 静态资源目录（构建时复制到 dist/）
│   ├── _headers               # Cloudflare Pages 安全头配置
│   ├── _redirects             # Cloudflare Pages 重定向规则
│   ├── robots.txt             # 搜索引擎爬虫规则
│   └── google*.html           # Google Search Console 站点验证文件
└── src/
    ├── main.js                # 应用入口（导出 createApp 工厂函数，兼容 vite-ssg）
    ├── App.vue                # 根组件（全局布局 + 语言切换器 + SEO 元数据）
    ├── router/
    │   └── index.js           # 路由配置（含语言前缀路由）
    ├── views/
    │   ├── HomeView.vue       # 首页视图（工具卡片列表，多语言）
    │   └── AboutView.vue      # 关于页面（多语言）
    ├── components/
    │   ├── PasswordGenerator.vue  # 密码生成器组件（多语言）
    │   ├── LocaleSwitcher.vue     # 语言切换下拉组件
    │   └── Toast.vue              # Toast 通知组件
    ├── composables/
    │   ├── useToast.js        # Toast 状态管理逻辑
    │   ├── useLocalePath.js   # 语言路径处理 composable
    │   └── useLocale.js       # 语言切换 composable
    ├── locales/
    │   ├── index.js           # i18n 实例创建与语言回退策略（legacy: false）
    │   ├── zh-CN.js           # 简体中文语言包
    │   └── en-US.js           # 英文语言包
    └── utils/
        ├── password.js        # 密码生成核心函数
        └── i18n.js            # i18n 实例重导出（兼容入口）
```

## 🌐 环境要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **浏览器**: 现代浏览器（Chrome 90+、Firefox 88+、Safari 14+、Edge 90+）

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动，支持热模块替换（HMR）。

### 3. 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

### 4. 预览生产构建

```bash
npm run preview
```

在本地预览生产构建效果。

### npm 脚本一览

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（HMR，默认端口 5173） |
| `npm run build` | 生产构建并生成 sitemap |
| `npm run build:prod` | 以 `production` 模式构建并生成 sitemap |
| `npm run preview` | 本地预览生产构建产物 |
| `npm run validate:analytics` | 校验 Cloudflare Analytics 配置是否正确 |

## 🌍 国际化

项目使用 **vue-i18n** 实现多语言支持，采用 Composition API 模式（已配置 `legacy: false`）。

### 支持的语言

| 语言 | 代码 | 本地名称 | URL 结构 |
|------|------|----------|----------|
| 简体中文 | `zh-CN` | 简体中文 | `https://toolboxlab.pages.dev/zh-CN/` |
| English | `en-US` | English | `https://toolboxlab.pages.dev/en-US/` |

### 语言切换流程

1. 用户通过顶栏的语言切换器选择语言
2. 语言偏好自动保存到 `localStorage`
3. 下次访问时按以下优先级确定语言：
   - 用户的 localStorage 偏好
   - 浏览器语言（`navigator.language`）
   - 默认简体中文（`zh-CN`）
4. 切换语言时同步更新 `document.documentElement.lang`
5. 应用内的所有文本实时更新（无需页面刷新）
6. URL 结构已优化为 SEO 友好格式，包含语言前缀

### SEO 优化

项目包含完整的 SEO 优化：

- **URL 结构**：采用 SEO 友好格式，包含语言前缀（如 `/zh-CN/about`、`/en-US/password`）
- **hreflang 标签**：支持多语言搜索引擎识别，包含 `x-default` 指向默认语言
- **canonical 标签**：防止重复内容，指向当前页面的标准化 URL
- **元数据优化**：每个页面有独特的 title、description 和 keywords
- **SSG 兼容**：`main.js` 导出工厂函数，可配合 vite-ssg 进行静态预渲染（需自行集成）
- **sitemap 生成**：构建时自动生成 `sitemap.xml` 和多语言 sitemap
- **Cloudflare 配置**：通过 `_headers` 和 `_redirects` 配置安全头和重定向（域名需替换为实际地址）

### 扩展新语言

在 `src/locales/` 目录下新增语言包文件：

```js
// src/locales/ja-JP.js
export default {
  app: { name: 'マイツールボックス', ... },
  nav: { home: 'ホーム', ... },
  // ... 与 zh-CN.js 相同的键结构
}
```

然后在 `src/locales/index.js` 中注册：

```js
import jaJP from './ja-JP.js'
// ...
messages: {
  'zh-CN': zhCN,
  'en-US': enUS,
}
```

## 🔒 安全加固

### 安全特性

**内容安全策略 (CSP)**
- 限制脚本、样式和资源的来源
- 防止 XSS 攻击
- 控制 iframe 嵌入

**HTTP 严格传输安全 (HSTS)**
- 强制 HTTPS 连接
- 防止中间人攻击

**X-Frame-Options**
- 防止点击劫持
- 禁止页面嵌入 iframe

**X-Content-Type-Options**
- 防止 MIME 嗅探攻击

**X-XSS-Protection**
- 启用 XSS 过滤

**Referrer-Policy**
- 控制引用页面的信息传递

**Permissions-Policy**
- 限制浏览器功能访问（摄像头、麦克风、地理位置等）

### 部署配置

**Cloudflare Pages 部署**

项目配置了 Cloudflare Pages 部署支持：

- `_headers` 文件：配置安全头（CSP、HSTS、XSS Protection 等）
- `_redirects` 文件：配置 URL 重定向规则
- 响应式设计，支持移动端和桌面端
- 静态资源优化，CDN 加速

**Cloudflare Web Analytics 集成**

项目已集成 Cloudflare Web Analytics，支持通过环境变量安全配置：

- **环境变量配置**: 使用 `VITE_CLOUDFLARE_ANALYTICS_TOKEN` 环境变量
- **动态脚本注入**: 仅在有有效 token 时加载分析脚本
- **安全隔离**: 实际 token 不存储在代码仓库中
- **构建时替换**: token 在构建时注入，确保安全性

详细配置说明请参考 [CLOUDFLARE_ANALYTICS.md](./CLOUDFLARE_ANALYTICS.md)。

### 隐私说明

**所有数据仅在本地处理，不会上传至任何服务器**

- 密码生成完全在浏览器本地完成
- 用户配置通过 localStorage 保存在本地
- 不收集、不存储、不传输任何用户数据
- 无需网络连接即可使用所有功能

## 📄 许可证

本项目采用 MIT 许可证。


**ToolboxLab** - 纯前端本地工具集，让工具更简单、更安全、更快速。


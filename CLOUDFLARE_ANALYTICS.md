# Cloudflare Web Analytics 配置说明

## 概述

项目已集成 Cloudflare Web Analytics，支持通过环境变量安全配置分析脚本。

## 配置方式

### 1. 环境变量配置

项目使用 Vite 的环境变量系统来安全地管理 Cloudflare Analytics Token。

#### 环境变量文件

- `.env.example` - 模板文件（提交到 Git）
- `.env.local` - 本地开发配置（不提交到 Git）

#### 配置步骤

1. **创建本地环境变量文件**：
   ```bash
   cp .env.example .env.local
   ```

2. **编辑 `.env.local`**，填入真实的 Cloudflare Analytics Token：
   ```
   VITE_CLOUDFLARE_ANALYTICS_TOKEN=your_actual_cloudflare_token
   ```

### 2. 部署环境配置

#### Cloudflare Pages

在 Cloudflare Pages 的部署配置中设置环境变量：

1. 进入 Cloudflare Pages 项目设置
2. 找到 "Environment variables" 或 "环境变量"
3. 添加以下环境变量：
   - **变量名**: `VITE_CLOUDFLARE_ANALYTICS_TOKEN`
   - **值**: 你的 Cloudflare Analytics Token
   - **环境**: Production（生产环境）

#### 其他部署平台

在部署平台的 CI/CD 配置中设置相同的环境变量。

## 技术实现

### 动态脚本注入

项目使用动态脚本注入方式，具有以下优势：

1. **条件加载**: 只有当 token 存在时才加载分析脚本
2. **错误处理**: 没有 token 时不会加载脚本，避免错误
3. **灵活配置**: 可以通过环境变量控制是否启用分析

### 脚本位置

Cloudflare Analytics 脚本会自动插入到每个 HTML 页面的 `</body>` 标签之前。

### 构建时替换

- 开发环境：使用 `.env.local` 中的 token（如果有）
- 生产构建：使用部署平台设置的环境变量

## 安全性

1. **Token 隔离**: 实际 token 不存储在代码仓库中
2. **环境分离**: 开发和生产环境可以使用不同的 token
3. **构建时注入**: token 只在构建时注入到产物中

## 使用说明

### 开发环境

1. 确保 `.env.local` 文件存在并包含有效的 token
2. 运行 `npm run dev`
3. 分析脚本会在开发环境中加载

### 生产环境

1. 在部署平台设置 `VITE_CLOUDFLARE_ANALYTICS_TOKEN` 环境变量
2. 运行 `npm run build:prod` 进行生产构建
3. 部署构建产物

### 调试

可以通过浏览器开发者工具检查：

1. Network 标签：查看是否加载了 `beacon.min.js`
2. Console 标签：检查是否有相关错误信息

## 注意事项

1. **Token 格式**: 确保使用正确格式的 Cloudflare Analytics Token
2. **环境变量命名**: 必须使用 `VITE_` 前缀才能在 Vite 中使用
3. **构建刷新**: 修改环境变量后需要重新构建项目
4. **隐私合规**: 确保遵守相关隐私法规和用户同意政策

## 故障排除

### 脚本未加载

1. 检查环境变量是否正确设置
2. 确认 token 格式是否正确
3. 查看浏览器控制台错误信息

### 构建错误

1. 确保 `.env.local` 文件格式正确
2. 检查 Vite 配置是否正确
3. 验证环境变量命名规范

## 相关文件

- `.env.example` - 环境变量模板
- `vite.config.js` - Vite 配置文件
- `index.html` - HTML 模板文件
- `package.json` - 项目配置文件
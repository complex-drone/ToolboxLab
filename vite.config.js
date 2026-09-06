import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    // pdfjs-dist 4.x 含 top-level await，依赖预构建同样需要 es2022 目标
    esbuildOptions: {
      target: 'es2022',
    },
  },
  build: {
    // pdfjs-dist 4.x 使用 top-level await，需要 es2022 目标
    target: 'es2022',
    // 重量级第三方库（opencc 词典/官方 mammoth 浏览器构建/pdf.worker 等均为
    // 按需懒加载的独立 chunk 或 asset，只在用户打开对应工具时下载），
    // 无法也不应继续拆分，故上调体积告警阈值
    chunkSizeWarningLimit: 800,
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
  },
  // 环境变量配置
  define: {
    // 确保 Cloudflare Analytics token 在构建时可用
    __VITE_CLOUDFLARE_ANALYTICS_TOKEN__: JSON.stringify(process.env.VITE_CLOUDFLARE_ANALYTICS_TOKEN || ''),
  },
})
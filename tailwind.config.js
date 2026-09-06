/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  // 关闭 preflight，避免破坏现有页面的手写样式
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563eb',
          light: '#60a5fa',
          dark: '#1d4ed8',
        },
      },
      boxShadow: {
        soft: '0 6px 20px rgba(96, 125, 169, 0.12)',
        lift: '0 10px 28px rgba(96, 125, 169, 0.2)',
      },
    },
  },
  plugins: [],
}

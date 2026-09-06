export default {
  title: '.gitignore 生成器',
  description: '勾选项目类型，自动合并去重生成 .gitignore，支持复制与下载',
  templatesTitle: '项目类型',
  selectedCount: '已选',
  selectAll: '全选',
  clearAll: '清空',
  tplNode: {
    name: 'Node.js',
    desc: '依赖目录、构建产物与调试日志',
  },
  tplVue: {
    name: 'Vue',
    desc: 'Nuxt、Vite 与 VuePress 构建产物',
  },
  tplPython: {
    name: 'Python',
    desc: '字节码缓存、虚拟环境与打包产物',
  },
  tplJava: {
    name: 'Java',
    desc: 'class 与 jar 产物、构建目录',
  },
  tplGo: {
    name: 'Go',
    desc: '编译产物与 vendor 目录',
  },
  tplRust: {
    name: 'Rust',
    desc: 'target 目录与备份文件',
  },
  tplCpp: {
    name: 'C / C++',
    desc: '目标文件、静态库与构建目录',
  },
  tplMacos: {
    name: 'macOS',
    desc: 'DS_Store 等系统文件',
  },
  tplWindows: {
    name: 'Windows',
    desc: '缩略图缓存与系统文件',
  },
  tplLinux: {
    name: 'Linux',
    desc: '编辑器备份与桌面残留文件',
  },
  tplVscode: {
    name: 'VS Code',
    desc: '忽略本地改动，保留共享配置',
  },
  tplJetbrains: {
    name: 'JetBrains',
    desc: 'IDEA 工程目录与模块文件',
  },
  previewTitle: '生成结果',
  emptyPreview: '请先勾选至少一种项目类型，将自动合并生成 .gitignore',
  downloadName: '下载 .gitignore',
  downloadDone: '.gitignore 已开始下载',
}

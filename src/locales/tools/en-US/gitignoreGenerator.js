export default {
  title: '.gitignore Generator',
  description: 'Pick project types, merge and dedupe them into a .gitignore you can copy or download',
  templatesTitle: 'Project types',
  selectedCount: 'Selected',
  selectAll: 'Select all',
  clearAll: 'Clear',
  tplNode: {
    name: 'Node.js',
    desc: 'Dependency folders, build output and debug logs',
  },
  tplVue: {
    name: 'Vue',
    desc: 'Nuxt, Vite and VuePress build output',
  },
  tplPython: {
    name: 'Python',
    desc: 'Bytecode caches, virtual envs and packaging output',
  },
  tplJava: {
    name: 'Java',
    desc: 'Class and jar artifacts, build folders',
  },
  tplGo: {
    name: 'Go',
    desc: 'Compiled binaries and the vendor folder',
  },
  tplRust: {
    name: 'Rust',
    desc: 'Target folder and backup files',
  },
  tplCpp: {
    name: 'C / C++',
    desc: 'Object files, static libs and build folders',
  },
  tplMacos: {
    name: 'macOS',
    desc: 'DS_Store and other system files',
  },
  tplWindows: {
    name: 'Windows',
    desc: 'Thumbnail caches and system files',
  },
  tplLinux: {
    name: 'Linux',
    desc: 'Editor backups and leftover desktop files',
  },
  tplVscode: {
    name: 'VS Code',
    desc: 'Ignore local changes, keep shared settings',
  },
  tplJetbrains: {
    name: 'JetBrains',
    desc: 'IDEA project folders and module files',
  },
  previewTitle: 'Generated result',
  emptyPreview: 'Select at least one project type and the .gitignore will be generated here',
  downloadName: 'Download .gitignore',
  downloadDone: '.gitignore download started',
}

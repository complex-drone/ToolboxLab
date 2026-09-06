/**
 * 下载工具：统一处理 Blob / 文本 / DataURL / Canvas 导出
 */

/**
 * 触发浏览器下载 Blob
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 下载文本内容
 * @param {string} text
 * @param {string} filename
 * @param {string} mime
 */
export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/**
 * 下载数据 URL（如 canvas.toDataURL 的结果）
 * @param {string} dataUrl
 * @param {string} filename
 */
export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * 将 Canvas 导出为 PNG 并下载
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
export function downloadCanvasAsPng(canvas, filename) {
  downloadDataUrl(canvas.toDataURL('image/png'), filename)
}

/**
 * 读取文件为文本
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsText(file)
  })
}

/**
 * 读取文件为 ArrayBuffer
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 读取文件为 DataURL
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

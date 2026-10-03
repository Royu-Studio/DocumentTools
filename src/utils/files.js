export const FILE_LIMITS = {
  pdf: 200 * 1024 * 1024,
  image: 100 * 1024 * 1024,
  ocr: 200 * 1024 * 1024,
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']

export function getFileKind(file) {
  const extension = file?.name?.split('.').pop()?.toLowerCase() || ''
  if (file?.type === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (file?.type?.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension)) return 'image'
  return 'unknown'
}

export function validateFile(file, { allow = ['pdf', 'image'], maxSize } = {}) {
  if (!file) return { valid: false, message: '没有读取到文件，请重新选择。' }
  const kind = getFileKind(file)
  if (!allow.includes(kind)) return { valid: false, message: `不支持“${file.name}”的文件类型。` }
  const limit = maxSize || (kind === 'pdf' ? FILE_LIMITS.pdf : FILE_LIMITS.image)
  if (file.size > limit) return { valid: false, message: `文件过大，当前上限为 ${formatFileSize(limit)}。` }
  return { valid: true, kind }
}

export function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function safeDownloadName(name, suffix, extension) {
  const base = (name || '文件').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim() || '文件'
  return `${base}-${suffix}.${extension}`
}

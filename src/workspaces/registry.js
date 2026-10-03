// One registration drives routes, the toolbox and workspace creation.
// Tools receive { workspaceId, active, initialMode }; expose hasContent() and,
// optionally, canDeactivate(). Keep document state inside the component instance.
const loadStudio = () => import('../views/StudioView.vue')
const loadFormatter = () => import('../views/FormatterView.vue')
export const toolRegistry = [
  { id: 'document', path: '/pdf', load: loadStudio, icon: 'file', tag: 'DOCUMENT', name: 'PDF / 图片', text: 'PDF 与图片统一编辑、盖章、文字识别与 Word 导出', foot: 'PDF / PNG / JPG / WEBP' },
  { id: 'json', path: '/json', load: loadFormatter, props: { kind: 'json' }, icon: 'json', tag: 'STRUCTURED DATA', name: 'JSON 格式化', text: '格式化、压缩与语法校验', foot: 'JSON' },
  { id: 'xml', path: '/xml', load: loadFormatter, props: { kind: 'xml' }, icon: 'xml', tag: 'MARKUP', name: 'XML 格式化', text: '整理缩进、压缩与语法校验', foot: 'XML' },
]
export const toolForPath = path => toolRegistry.find(tool => tool.path === path)

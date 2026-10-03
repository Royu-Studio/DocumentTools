import { createRouter, createWebHistory } from 'vue-router'
const loadHome = () => import('../views/ToolboxView.vue')
const loadStudio = () => import('../views/StudioView.vue')
const loadFormatter = () => import('../views/FormatterView.vue')
export const routeComponentLoaders = { '/': loadHome, '/pdf': loadStudio, '/json': loadFormatter, '/xml': loadFormatter, '/image_tool': loadStudio, '/ocr': loadStudio }
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: loadHome, meta: { title: '文档工具箱' }, beforeEnter: to => to.query.tool === 'ocr' ? '/pdf?tool=ocr' : true },
    { path: '/pdf', component: loadStudio, meta: { title: 'PDF 工具' } },
    { path: '/json', component: loadFormatter, props: { kind: 'json' }, meta: { title: 'JSON 格式化' } },
    { path: '/xml', component: loadFormatter, props: { kind: 'xml' }, meta: { title: 'XML 格式化' } },
    { path: '/image_tool', redirect: '/pdf' },
    { path: '/ocr', redirect: '/pdf?tool=ocr' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
router.beforeEach(to => { document.title = `${to.meta.title || '文档工具箱'} · ROYU` })
export default router

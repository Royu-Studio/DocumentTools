import { toolRegistry } from '../workspaces/registry.js'
const loadHome = () => import('../views/ToolboxView.vue')
export const routeComponentLoaders = Object.fromEntries([['/', loadHome], ...toolRegistry.map(tool => [tool.path, tool.load])])
export function createToolRoutes() {
  return [
    { path: '/', component: loadHome, meta: { title: '文档工具箱' } },
    ...toolRegistry.map(tool => ({ path: tool.path, component: tool.load, props: tool.props, meta: { title: tool.name } })),
    { path: '/image_tool', redirect: '/pdf' },
    { path: '/ocr', redirect: '/pdf?tool=ocr' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ]
}

export function configureToolRouter(router) {
  router.beforeEach(to => to.path === '/' && to.query.tool === 'ocr' ? '/pdf?tool=ocr' : true)
  router.afterEach((to, from, failure) => { if (!failure) document.title = `${to.meta.title || '文档工具箱'} · ROYU` })
  return router
}

import { createRouter, createWebHistory } from 'vue-router'
import { createToolRoutes, configureToolRouter } from './routes.js'
export { routeComponentLoaders } from './routes.js'
const router = configureToolRouter(createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: createToolRoutes() }))
export default router

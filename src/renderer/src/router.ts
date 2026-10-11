import { createRouter, createWebHashHistory } from 'vue-router'
import AppLayout from './layouts/AppLayout.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/switcher', component: () => import('./pages/SwitcherPage.vue'), meta: { bare: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', meta: { title: 'Brands' }, component: () => import('./pages/HomePage.vue') },
        { path: 'brands/new', meta: { title: 'New brand' }, component: () => import('./pages/NewBrandPage.vue') },
        { path: 'brands/:id', meta: { title: 'Brand', key: 'brand' }, component: () => import('./pages/BrandDetailPage.vue') },
        { path: 'compose', meta: { title: 'Compose' }, component: () => import('./pages/ComposePage.vue') },
        { path: 'calendar', meta: { title: 'Calendar' }, component: () => import('./pages/CalendarPage.vue') },
        { path: 'approvals', meta: { title: 'Approvals' }, component: () => import('./pages/ApprovalsPage.vue') },
        { path: 'media', meta: { title: 'Media' }, component: () => import('./pages/MediaPage.vue') },
        { path: 'flows', meta: { title: 'Flows' }, component: () => import('./pages/FlowsPage.vue') },
        { path: 'flows/:id', meta: { title: 'Flow' }, component: () => import('./pages/FlowEditorPage.vue') },
        { path: 'runs/:id', meta: { title: 'Run' }, component: () => import('./pages/RunPage.vue') },
        { path: 'activity', meta: { title: 'Activity' }, component: () => import('./pages/ActivityPage.vue') },
        { path: 'claude', meta: { title: 'Claude' }, component: () => import('./pages/ClaudePage.vue') },
        { path: 'settings', meta: { title: 'Settings' }, component: () => import('./pages/SettingsPage.vue') },
        { path: 'recycle', meta: { title: 'Recycle bin' }, component: () => import('./pages/RecyclePage.vue') },
        { path: ':rest(.*)*', redirect: '/' }
      ]
    }
  ]
})

// Window / taskbar title follows the page (pages with a record name may refine it via document.title)
router.afterEach((to) => {
  const t = to.meta.title as string | undefined
  document.title = to.path === '/switcher' ? 'Cubby — Quick switch' : t ? `${t} — Cubby` : 'Cubby'
})

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
        { path: '', component: () => import('./pages/HomePage.vue') },
        { path: 'brands/new', component: () => import('./pages/NewBrandPage.vue') },
        { path: 'brands/:id', component: () => import('./pages/BrandDetailPage.vue'), meta: { key: 'brand' } },
        { path: 'compose', component: () => import('./pages/ComposePage.vue') },
        { path: 'calendar', component: () => import('./pages/CalendarPage.vue') },
        { path: 'approvals', component: () => import('./pages/ApprovalsPage.vue') },
        { path: 'media', component: () => import('./pages/MediaPage.vue') },
        { path: 'flows', component: () => import('./pages/FlowsPage.vue') },
        { path: 'flows/:id', component: () => import('./pages/FlowEditorPage.vue') },
        { path: 'runs/:id', component: () => import('./pages/RunPage.vue') },
        { path: 'activity', component: () => import('./pages/ActivityPage.vue') },
        { path: 'claude', component: () => import('./pages/ClaudePage.vue') },
        { path: 'settings', component: () => import('./pages/SettingsPage.vue') },
        { path: 'recycle', component: () => import('./pages/RecyclePage.vue') },
        { path: ':rest(.*)*', redirect: '/' }
      ]
    }
  ]
})

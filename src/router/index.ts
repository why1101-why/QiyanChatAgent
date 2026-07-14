import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('@/views/HomeView.vue') },
    { path: '/chat', component: () => import('@/views/ChatView.vue') },
    { path: '/notes', component: () => import('@/views/NotesView.vue') },
    { path: '/game', component: () => import('@/views/GameView.vue') },
    { path: '/service', redirect: '/notes' },
    { path: '/pdf', component: () => import('@/views/PdfView.vue') },
    { path: '/settings', component: () => import('@/views/SettingsView.vue') }
  ]
})

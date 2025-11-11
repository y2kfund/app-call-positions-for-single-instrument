import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

import Positions from '../views/Positions.vue'
// Use the correct type for the routes array
const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    name: 'Positions',
    component: Positions
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
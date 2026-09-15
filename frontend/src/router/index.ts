import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/store/auth';

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue') },
  {
    path: '/forgot',
    name: 'forgot',
    component: () => import('@/views/ForgotPasswordView.vue'),
  },
  // 学生端
  { path: '/student/face-login', name: 'face-login', component: () => import('@/views/FaceLoginView.vue') },
  { path: '/student/dashboard', name: 'student-dashboard', component: () => import('@/views/StudentDashboardView.vue'), meta: { student: true } },
  { path: '/student/comfort', name: 'student-comfort', component: () => import('@/views/ComfortChatView.vue'), meta: { student: true } },
  // 家长/教师端
  { path: '/students', name: 'students', component: () => import('@/views/StudentListView.vue'), meta: { auth: true } },
  { path: '/students/associate', name: 'student-associate', component: () => import('@/views/StudentAssociateView.vue'), meta: { auth: true } },
  { path: '/students/:id/profile', name: 'student-profile', component: () => import('@/views/StudentProfileView.vue'), meta: { auth: true } },
  { path: '/parent/dashboard', name: 'parent-dashboard', component: () => import('@/views/ParentDashboardView.vue'), meta: { auth: true } },
  { path: '/parent/advice', name: 'parent-advice', component: () => import('@/views/AdviceView.vue'), meta: { auth: true } },
  { path: '/consent/:studentId', name: 'consent-manage', component: () => import('@/views/ConsentManageView.vue'), meta: { auth: true } },
  { path: '/deskpet', name: 'deskpet', component: () => import('@/views/DeskPetView.vue'), meta: { auth: true } },
  { path: '/students/new', name: 'student-new', component: () => import('@/views/StudentCreateView.vue'), meta: { auth: true } },
  { path: '/students/:id/face-register', name: 'face-register', component: () => import('@/views/FaceRegisterView.vue'), meta: { auth: true } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/AdultDashboardView.vue'), meta: { auth: true } },
  { path: '/:pathMatch(.*)*', redirect: '/login' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.auth && !auth.isLoggedIn) return { name: 'login' };
  if (to.meta.student && !auth.studentId) return { name: 'face-login' };
  return true;
});

export default router;

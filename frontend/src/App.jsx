import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards.jsx';
import { LandingPage } from './pages/LandingPage.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { ResumeListPage } from './features/resumes/ResumeListPage.jsx';
import { ResumeEditorPage } from './features/resumes/ResumeEditorPage.jsx';
import { AnalysisPage } from './features/analysis/AnalysisPage.jsx';
import { AnalysisDetailPage } from './features/analysis/AnalysisDetailPage.jsx';
import { InterviewsPage } from './features/interview/InterviewsPage.jsx';
import { InterviewLivePage } from './features/interview/InterviewLivePage.jsx';
import { InterviewReportPage } from './features/interview/InterviewReportPage.jsx';
import { GuidedInterviewPage } from './features/interview/GuidedInterviewPage.jsx';

export const routes = [
  { path: '/', element: <LandingPage /> },
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'resumes', element: <ResumeListPage /> },
          { path: 'resumes/:id', element: <ResumeEditorPage /> },
          { path: 'analyses', element: <AnalysisPage /> },
          { path: 'analyses/:id', element: <AnalysisDetailPage /> },
          { path: 'interviews', element: <InterviewsPage /> },
          { path: 'interviews/:id', element: <InterviewReportPage /> },
          { path: 'interviews/:id/live', element: <InterviewLivePage /> },
          { path: 'interviews/:id/guided', element: <GuidedInterviewPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFoundPage inApp /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

export function Providers({ children }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}

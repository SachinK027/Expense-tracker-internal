import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/auth/Login'
import { Signup } from '@/pages/auth/Signup'
import { Dashboard } from '@/pages/Dashboard'
import { PersonalExpenses } from '@/pages/expenses/PersonalExpenses'
import { GroupsList } from '@/pages/groups/GroupsList'
import { GroupDetail } from '@/pages/groups/GroupDetail'
import { TiffinList } from '@/pages/tiffin/TiffinList'
import { TiffinDetail } from '@/pages/tiffin/TiffinDetail'
import { Reports } from '@/pages/Reports'
import { Notifications } from '@/pages/Notifications'
import { Settings } from '@/pages/Settings'
import { Join } from '@/pages/Join'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              className: '!bg-white dark:!bg-slate-800 !text-slate-900 dark:!text-slate-100 !shadow-card !rounded-xl',
            }}
          />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/join/:type/:code" element={<Join />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/expenses" element={<PersonalExpenses />} />
              <Route path="/groups" element={<GroupsList />} />
              <Route path="/groups/:id" element={<GroupDetail />} />
              <Route path="/tiffin" element={<TiffinList />} />
              <Route path="/tiffin/:id" element={<TiffinDetail />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

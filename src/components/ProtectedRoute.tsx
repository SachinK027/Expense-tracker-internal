import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PageLoader } from '@/components/ui/Loading'
import { isSupabaseConfigured } from '@/lib/supabase'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-lg p-8 space-y-3">
          <h1 className="font-display text-2xl font-semibold">Configure Supabase</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Copy <code className="text-brand-700">.env.example</code> to{' '}
            <code className="text-brand-700">.env</code>, add your project URL and anon key, then run the SQL
            migration in <code className="text-brand-700">supabase/migrations/001_initial_schema.sql</code>.
          </p>
        </div>
      </div>
    )
  }

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <>{children}</>
}

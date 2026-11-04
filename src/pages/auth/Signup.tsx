import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Loading'

export function Signup() {
  const { signUp, user, loading } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isSupabaseConfigured) {
      toast.error('Configure Supabase env vars first')
      return
    }
    setSubmitting(true)
    const { error } = await signUp(email.trim(), password, fullName.trim())
    setSubmitting(false)
    if (error) toast.error(error)
    else {
      toast.success('Account created — you can sign in now')
      navigate('/login')
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_#d5f0e1_0%,_transparent_50%),radial-gradient(ellipse_at_bottom_right,_#e0f2fe_0%,_transparent_45%)] dark:bg-[radial-gradient(ellipse_at_top_left,_#143e2e_0%,_transparent_50%),radial-gradient(ellipse_at_bottom_right,_#0f172a_0%,_transparent_45%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white font-display text-2xl font-bold">
            H
          </div>
          <h1 className="font-display text-3xl font-semibold">Create account</h1>
          <p className="mt-2 text-slate-500">Start tracking personal, group & tiffin expenses</p>
        </div>
        <form onSubmit={onSubmit} className="card p-6 sm:p-8 space-y-4">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create account'}
          </button>
          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-700 dark:text-brand-400 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

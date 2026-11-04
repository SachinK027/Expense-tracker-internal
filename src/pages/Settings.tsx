import { useEffect, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Loading'
import type { Theme } from '@/types/database'

export function Settings() {
  const { profile, updateProfile, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [currency, setCurrency] = useState(profile?.currency || 'INR')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setCurrency(profile.currency || 'INR')
    }
  }, [profile])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await updateProfile({
      full_name: fullName.trim(),
      currency,
      theme: theme as Theme,
    })
    setSaving(false)
    if (error) toast.error(error)
    else toast.success('Profile updated')
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="page-title">Profile & Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your account preferences</p>
      </div>

      <div className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile?.full_name} email={profile?.email} url={profile?.avatar_url} size="lg" />
          <div>
            <p className="font-medium">{profile?.email}</p>
            <p className="text-xs text-slate-500">Account email</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
          <div>
            <label className="label">Theme</label>
            <select
              className="input"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Save changes'}
          </button>
        </form>
      </div>

      <button type="button" className="btn-danger" onClick={() => signOut()}>
        Sign out
      </button>
    </div>
  )
}

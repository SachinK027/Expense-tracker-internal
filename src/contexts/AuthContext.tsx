import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/database'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (data: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'currency' | 'theme'>>) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function ensureProfile(user: User) {
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (data) return data as Profile

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ||
    user.email?.split('@')[0] ||
    'User'

  const { data: created, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      email: user.email || '',
      full_name: fullName,
    })
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('ensureProfile', error)
    return null
  }
  return created as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (user: User) => {
    const p = await ensureProfile(user)
    setProfile(p)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session?.user) fetchProfile(data.session.user).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.user) void fetchProfile(s.user)
      else setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) {
      if (/database error saving new user/i.test(error.message)) {
        return {
          error:
            'Signup failed: database trigger/grants not fixed yet. Run supabase/migrations/002_fix_grants_and_signup_trigger.sql in Supabase SQL Editor.',
        }
      }
      return { error: error.message }
    }
    // If email confirmations are off, session may already exist
    if (data.user && !data.session) {
      return {
        error: null,
      }
    }
    return { error: null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const refreshProfile = async () => {
    if (session?.user) await fetchProfile(session.user)
  }

  const updateProfile = async (data: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'currency' | 'theme'>>) => {
    if (!session?.user) return { error: 'Not authenticated' }
    const { error } = await supabase.from('profiles').update(data).eq('id', session.user.id)
    if (!error) await fetchProfile(session.user)
    return { error: error?.message ?? null }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

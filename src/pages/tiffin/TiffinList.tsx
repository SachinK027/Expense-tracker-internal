import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, UtensilsCrossed, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { TiffinGroup } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Loading'
import { Modal } from '@/components/ui/Modal'
import { CreateTiffinForm } from './CreateTiffinForm'
import { JoinTiffinForm } from './JoinTiffinForm'

export function TiffinList() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<TiffinGroup[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('tiffin_members')
      .select('tiffin_group_id, tiffin_groups(*)')
      .eq('user_id', user.id)
      .eq('is_active', true)
    if (error) toast.error(error.message)
    else {
      setGroups(
        (data || [])
          .map((m) => m.tiffin_groups as unknown as TiffinGroup)
          .filter(Boolean)
      )
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Tiffin Manager</h1>
          <p className="mt-1 text-sm text-slate-500">Daily lunch & dinner attendance and cost splits</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setJoinOpen(true)}>
            <Link2 className="h-4 w-4" /> Join
          </button>
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={UtensilsCrossed}
            title="No tiffin groups"
            description="Create a household tiffin group or join with a code"
            action={
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setJoinOpen(true)}>Join</button>
                <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>Create</button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Link key={g.id} to={`/tiffin/${g.id}`} className="card p-5 transition hover:border-brand-300 dark:hover:border-brand-700">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                <UtensilsCrossed className="h-6 w-6" />
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold">{g.name}</h2>
              <p className="mt-1 text-sm text-slate-500 line-clamp-2">{g.description || 'Lunch & dinner tracking'}</p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                Code {g.invite_code}
              </p>
            </Link>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create tiffin group">
        <CreateTiffinForm onDone={() => { setCreateOpen(false); load() }} />
      </Modal>
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join tiffin group">
        <JoinTiffinForm onDone={() => { setJoinOpen(false); load() }} />
      </Modal>
    </div>
  )
}

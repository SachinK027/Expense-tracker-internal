import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Users, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { ExpenseGroup } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Loading'
import { Modal } from '@/components/ui/Modal'
import { CreateGroupForm } from './CreateGroupForm'
import { JoinGroupForm } from './JoinGroupForm'

export function GroupsList() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<(ExpenseGroup & { member_count?: number })[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: memberships, error } = await supabase
      .from('group_members')
      .select('group_id, expense_groups(*)')
      .eq('user_id', user.id)
    if (error) toast.error(error.message)
    else {
      const list = (memberships || [])
        .map((m) => m.expense_groups as unknown as ExpenseGroup)
        .filter(Boolean)
      setGroups(list)
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
          <h1 className="page-title">Group Expenses</h1>
          <p className="mt-1 text-sm text-slate-500">Splitwise-style shared expenses & settlements</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setJoinOpen(true)}>
            <Link2 className="h-4 w-4" /> Join
          </button>
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create group
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title="No groups yet"
            description="Create a group or join with an invite code"
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
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="card p-5 transition hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-soft"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-display text-xl font-bold">
                {g.name.slice(0, 1).toUpperCase()}
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold">{g.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{g.description || 'No description'}</p>
              <p className="mt-3 text-xs text-slate-400">Code: {g.invite_code}</p>
            </Link>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create group">
        <CreateGroupForm
          onDone={() => {
            setCreateOpen(false)
            load()
          }}
        />
      </Modal>
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with invite code">
        <JoinGroupForm
          onDone={() => {
            setJoinOpen(false)
            load()
          }}
        />
      </Modal>
    </div>
  )
}

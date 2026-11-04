import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Copy, Users, Scale } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { computeGroupBalances, suggestSettlements } from '@/lib/calculations'
import { formatCurrency, formatDate, inviteLink, cn } from '@/lib/utils'
import type { ExpenseGroup, GroupExpense, GroupMember, Settlement } from '@/types/database'
import { PageLoader } from '@/components/ui/Loading'
import { EmptyState } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { StatCard } from '@/components/ui/StatCard'
import { GroupExpenseForm } from './GroupExpenseForm'
import { SettlementForm } from './SettlementForm'

export function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<ExpenseGroup | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [expenses, setExpenses] = useState<GroupExpense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [tab, setTab] = useState<'expenses' | 'balances' | 'settle'>('expenses')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [{ data: g }, { data: mem }, { data: exp }, { data: set }] = await Promise.all([
      supabase.from('expense_groups').select('*').eq('id', id).single(),
      supabase.from('group_members').select('*, profiles(*)').eq('group_id', id),
      supabase
        .from('group_expenses')
        .select('*, expense_payments(*), expense_participants(*)')
        .eq('group_id', id)
        .order('expense_date', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', id).order('settlement_date', { ascending: false }),
    ])
    setGroup(g as ExpenseGroup | null)
    setMembers((mem as GroupMember[]) || [])
    setExpenses((exp as GroupExpense[]) || [])
    setSettlements((set as Settlement[]) || [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`group-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_expenses', filter: `group_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const balances = useMemo(() => {
    const memberList = members.map((m) => ({
      user_id: m.user_id,
      name: m.profiles?.full_name || m.profiles?.email || 'Member',
    }))
    return computeGroupBalances(memberList, expenses, settlements)
  }, [members, expenses, settlements])

  const suggestions = useMemo(() => suggestSettlements(balances), [balances])
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const nameOf = (uid: string) => balances.find((b) => b.userId === uid)?.name || 'Someone'
  const myBalance = balances.find((b) => b.userId === user?.id)

  const copyInvite = async () => {
    if (!group) return
    const text = `Join my Hisaab group "${group.name}"\nCode: ${group.invite_code}\n${inviteLink(group.invite_code, 'group')}`
    await navigator.clipboard.writeText(text)
    toast.success('Invite copied')
  }

  if (loading) return <PageLoader />
  if (!group) {
    return (
      <div className="card p-8 text-center">
        <p>Group not found</p>
        <Link to="/groups" className="btn-primary mt-4 inline-flex">Back</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700 mb-2">
            <ArrowLeft className="h-4 w-4" /> Groups
          </Link>
          <h1 className="page-title">{group.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{group.description || 'Shared expenses'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={copyInvite}>
            <Copy className="h-4 w-4" /> Invite
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSettleOpen(true)}>
            <Scale className="h-4 w-4" /> Record settlement
          </button>
          <button type="button" className="btn-primary" onClick={() => setExpenseOpen(true)}>
            <Plus className="h-4 w-4" /> Add expense
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total expenses" value={formatCurrency(totalExpenses)} icon={Users} />
        <StatCard
          label="You are owed"
          value={formatCurrency(myBalance && myBalance.net > 0 ? myBalance.net : 0)}
          icon={Scale}
          tone="positive"
        />
        <StatCard
          label="You owe"
          value={formatCurrency(myBalance && myBalance.net < 0 ? Math.abs(myBalance.net) : 0)}
          icon={Scale}
          tone="negative"
        />
      </div>

      <div className="card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">Members</p>
        <div className="flex flex-wrap gap-3">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
              <Avatar name={m.profiles?.full_name} email={m.profiles?.email} size="sm" />
              <div>
                <p className="text-sm font-medium leading-tight">{m.profiles?.full_name || m.profiles?.email}</p>
                <p className="text-[10px] uppercase text-slate-400">{m.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {([
          ['expenses', 'Expenses'],
          ['balances', 'Balances'],
          ['settle', 'Settle up'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === k ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'
            )}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'expenses' && (
        <div className="card overflow-hidden">
          {expenses.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No expenses yet"
              action={<button type="button" className="btn-primary" onClick={() => setExpenseOpen(true)}>Add expense</button>}
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.map((e) => {
                const payers = (e.expense_payments || [])
                  .map((p) => nameOf(p.user_id))
                  .join(', ')
                return (
                  <div key={e.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{e.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(e.expense_date)} · {e.category} · Paid by {payers || '—'}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 capitalize">Split: {e.split_type}</p>
                      </div>
                      <p className="font-semibold tabular-nums">{formatCurrency(Number(e.amount))}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'balances' && (
        <div className="card overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {balances.map((b) => (
              <div key={b.userId} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-slate-500">
                    Paid {formatCurrency(b.paid)} · Share {formatCurrency(b.owed)}
                  </p>
                </div>
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    b.net > 0.01 ? 'text-emerald-600' : b.net < -0.01 ? 'text-rose-600' : 'text-slate-500'
                  )}
                >
                  {b.net > 0.01 ? `+${formatCurrency(b.net)}` : b.net < -0.01 ? `−${formatCurrency(Math.abs(b.net))}` : 'Settled'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'settle' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="font-display text-lg font-semibold mb-3">Suggested settlements</h2>
            {suggestions.length === 0 ? (
              <p className="text-sm text-slate-500">Everyone is settled up.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm">
                    <span>
                      <strong>{nameOf(s.from)}</strong> pays <strong>{nameOf(s.to)}</strong>
                    </span>
                    <span className="font-semibold">{formatCurrency(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display font-semibold">Settlement history</h2>
            </div>
            {settlements.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No settlements recorded</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {settlements.map((s) => (
                  <div key={s.id} className="px-5 py-3 text-sm flex justify-between gap-3">
                    <span>
                      {nameOf(s.from_user_id)} → {nameOf(s.to_user_id)}
                      <span className="block text-xs text-slate-400">{formatDate(s.settlement_date)}</span>
                    </span>
                    <span className="font-semibold">{formatCurrency(Number(s.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={expenseOpen} onClose={() => setExpenseOpen(false)} title="Add group expense" size="lg">
        <GroupExpenseForm
          groupId={group.id}
          members={members}
          onDone={() => {
            setExpenseOpen(false)
            load()
          }}
        />
      </Modal>
      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="Record settlement">
        <SettlementForm
          groupId={group.id}
          members={members}
          onDone={() => {
            setSettleOpen(false)
            load()
          }}
        />
      </Modal>
    </div>
  )
}

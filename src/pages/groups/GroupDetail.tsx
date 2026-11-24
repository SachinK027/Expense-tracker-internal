import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Copy, MessageSquare, History, Users, Plus, HandCoins, CheckCircle2, IndianRupee, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format, parseISO, isSameDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  computeGroupBalances,
  computeMyPairBalances,
  expenseStatusForUser,
  participantRemaining,
  suggestSettlements,
} from '@/lib/calculations'
import { formatCurrency, inviteLink, cn } from '@/lib/utils'
import type { ExpenseGroup, GroupExpense, GroupMember, PersonPairBalance, Settlement } from '@/types/database'
import { PageLoader } from '@/components/ui/Loading'
import { EmptyState } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { GroupExpenseForm } from './GroupExpenseForm'
import { SettlementForm } from './SettlementForm'
import { MarkPaidForm } from './MarkPaidForm'

type MainTab = 'balances' | 'requests' | 'history'

export function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<ExpenseGroup | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [expenses, setExpenses] = useState<GroupExpense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [tab, setTab] = useState<MainTab>('balances')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<GroupExpense | null>(null)
  const [settleOpen, setSettleOpen] = useState(false)
  const [markPaidExpense, setMarkPaidExpense] = useState<GroupExpense | null>(null)
  const [person, setPerson] = useState<PersonPairBalance | null>(null)
  const [settlePrefill, setSettlePrefill] = useState<{ fromId?: string; toId?: string; amount?: number } | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [{ data: g }, { data: mem }, expRes, { data: set }] = await Promise.all([
      supabase.from('expense_groups').select('*').eq('id', id).single(),
      supabase.from('group_members').select('*, profiles(*)').eq('group_id', id),
      supabase
        .from('group_expenses')
        .select('*, expense_payments(*), expense_participants(*), expense_repayments(*)')
        .eq('group_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', id).order('created_at', { ascending: false }),
    ])
    setGroup(g as ExpenseGroup | null)
    setMembers((mem as GroupMember[]) || [])

    let expRows = expRes.data as GroupExpense[] | null
    if (expRes.error) {
      const { data: exp2 } = await supabase
        .from('group_expenses')
        .select('*, expense_payments(*), expense_participants(*)')
        .eq('group_id', id)
        .order('created_at', { ascending: false })
      expRows = exp2 as GroupExpense[] | null
    }
    setExpenses((expRows || []).map((e) => ({ ...e, expense_repayments: e.expense_repayments || [] })))
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_repayments', filter: `group_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const memberMeta = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        name: m.profiles?.full_name || m.profiles?.email || 'Member',
        avatarUrl: m.profiles?.avatar_url,
      })),
    [members]
  )

  const balances = useMemo(
    () => computeGroupBalances(memberMeta, expenses, settlements),
    [memberMeta, expenses, settlements]
  )

  const pairs = useMemo(() => {
    if (!user) return []
    return computeMyPairBalances(user.id, memberMeta, expenses, settlements)
  }, [user, memberMeta, expenses, settlements])

  const owedByYou = pairs.filter((p) => p.net < -0.01)
  const owedToYou = pairs.filter((p) => p.net > 0.01)
  const settledPeople = pairs.filter((p) => Math.abs(p.net) <= 0.01)
  const totalOwedByYou = owedByYou.reduce((s, p) => s + Math.abs(p.net), 0)
  const totalOwedToYou = owedToYou.reduce((s, p) => s + p.net, 0)
  const nameOf = (uid: string) => memberMeta.find((m) => m.user_id === uid)?.name || 'Someone'
  const suggestions = useMemo(() => suggestSettlements(balances), [balances])

  const requestFeed = useMemo(
    () => [...expenses].sort((a, b) => +parseISO(b.created_at || b.expense_date) - +parseISO(a.created_at || a.expense_date)),
    [expenses]
  )

  const copyInvite = async () => {
    if (!group) return
    await navigator.clipboard.writeText(
      `Join my Hisaab group "${group.name}"\nCode: ${group.invite_code}\n${inviteLink(group.invite_code, 'group')}`
    )
    toast.success('Invite copied')
  }

  const openSettleFor = (p: PersonPairBalance) => {
    if (!user) return
    if (p.net < -0.01) setSettlePrefill({ fromId: user.id, toId: p.userId, amount: Math.abs(p.net) })
    else if (p.net > 0.01) setSettlePrefill({ fromId: p.userId, toId: user.id, amount: p.net })
    else setSettlePrefill(null)
    setSettleOpen(true)
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
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-brand-200/60 dark:border-brand-900 bg-gradient-to-br from-brand-50 via-white to-teal-50 dark:from-brand-950 dark:via-surface-dark-muted dark:to-slate-900 p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link to="/groups" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline mb-3">
              <ArrowLeft className="h-3.5 w-3.5" /> All groups
            </Link>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {group.name}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
              {group.description || 'Shared expenses for this group'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex -space-x-2">
                {members.slice(0, 5).map((m) => (
                  <Avatar
                    key={m.id}
                    name={m.profiles?.full_name}
                    email={m.profiles?.email}
                    url={m.profiles?.avatar_url}
                    size="sm"
                    className="ring-2 ring-white dark:ring-surface-dark-muted"
                  />
                ))}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                <Users className="h-3.5 w-3.5" /> {members.length} members
              </span>
              <button type="button" onClick={copyInvite} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700">
                <Copy className="h-3.5 w-3.5" /> Invite
              </button>
            </div>
          </div>

          <div className="flex sm:flex-col gap-2 shrink-0">
            <button type="button" className="btn-primary !rounded-2xl shadow-md shadow-brand-600/20" onClick={() => setExpenseOpen(true)}>
              <Plus className="h-4 w-4" /> New split
            </button>
            <button type="button" className="btn-secondary !rounded-2xl" onClick={() => { setSettlePrefill(null); setSettleOpen(true) }}>
              <HandCoins className="h-4 w-4" /> Settle up
            </button>
          </div>
        </div>

        {/* Balance strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/90 dark:bg-slate-900/60 border border-rose-100 dark:border-rose-900/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">You owe</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-rose-600">{formatCurrency(totalOwedByYou)}</p>
          </div>
          <div className="rounded-2xl bg-white/90 dark:bg-slate-900/60 border border-emerald-100 dark:border-emerald-900/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Owed to you</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-emerald-600">{formatCurrency(totalOwedToYou)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 p-1.5">
        {([
          ['balances', 'Balances', IndianRupee],
          ['requests', 'Requests', MessageSquare],
          ['history', 'History', History],
        ] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
              tab === k
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label}</span>
          </button>
        ))}
      </div>

      {/* BALANCES */}
      {tab === 'balances' && (
        <div className="space-y-6">
          {pairs.length === 0 ? (
            <div className="card"><EmptyState icon={Users} title="Invite members" description="Balances appear once people join and split" /></div>
          ) : (
            <>
              {owedByYou.length > 0 && (
                <BalanceBlock title="You need to pay" hint="Outstanding to these members" tone="owe">
                  {owedByYou.map((p) => (
                    <PersonRow key={p.userId} person={p} tone="owe" onClick={() => setPerson(p)} />
                  ))}
                </BalanceBlock>
              )}
              {owedToYou.length > 0 && (
                <BalanceBlock title="Waiting to receive" hint="These members owe you" tone="owed">
                  {owedToYou.map((p) => (
                    <PersonRow key={p.userId} person={p} tone="owed" onClick={() => setPerson(p)} />
                  ))}
                </BalanceBlock>
              )}
              {settledPeople.length > 0 && (
                <BalanceBlock title="Settled" hint="No open balance" tone="settled">
                  {settledPeople.map((p) => (
                    <PersonRow key={p.userId} person={p} tone="settled" onClick={() => setPerson(p)} />
                  ))}
                </BalanceBlock>
              )}
              {!owedByYou.length && !owedToYou.length && (
                <div className="card p-8 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-3 font-display text-lg font-semibold">All clear</p>
                  <p className="text-sm text-slate-500 mt-1">No open balances in this group</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* REQUESTS (feed — not a chat clone) */}
      {tab === 'requests' && (
        <div className="space-y-4">
          {requestFeed.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={MessageSquare}
                title="No splits yet"
                description="Add a note like “movie tickets” or “lunch” when you split"
                action={
                  <button type="button" className="btn-primary" onClick={() => setExpenseOpen(true)}>
                    <Plus className="h-4 w-4" /> Create first split
                  </button>
                }
              />
            </div>
          ) : (
            requestFeed.map((expense, idx) => {
              const at = expense.created_at || expense.expense_date
              const prev = requestFeed[idx - 1]
              const showDate = !prev || !isSameDay(parseISO(at), parseISO(prev.created_at || prev.expense_date))
              return (
                <div key={expense.id} className="space-y-3">
                  {showDate && (
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {format(parseISO(at), 'EEE, d MMM · h:mm a')}
                      </span>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    </div>
                  )}
                  <RequestCard
                    expense={expense}
                    myId={user!.id}
                    nameOf={nameOf}
                    members={memberMeta}
                    onMarkPaid={() => setMarkPaidExpense(expense)}
                    onEdit={() => setEditingExpense(expense)}
                  />
                </div>
              )
            })
          )}
        </div>
      )}

      {/* HISTORY */}
      {tab === 'history' && (
        <div className="space-y-5">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <div>
                <h2 className="font-display font-semibold">Split ledger</h2>
                <p className="text-xs text-slate-500 mt-0.5">Every request with your live status</p>
              </div>
              <span className="text-xs font-medium text-slate-400">{expenses.length} rows</span>
            </div>
            {expenses.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Nothing recorded yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-3 py-3 font-medium">By</th>
                      <th className="px-3 py-3 font-medium">Note</th>
                      <th className="px-3 py-3 font-medium text-right">Amount</th>
                      <th className="px-5 py-3 font-medium">You</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => {
                      const involved = isInvolvedInExpense(e, user!.id)
                      const st = expenseStatusForUser(e, user!.id)
                      return (
                        <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                            {format(parseISO(e.expense_date), 'dd MMM yyyy')}
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-2">
                              <Avatar name={nameOf(e.created_by)} size="sm" />
                              <span className="truncate max-w-[100px]">{nameOf(e.created_by)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3.5 font-medium">{e.title}</td>
                          <td className="px-3 py-3.5 text-right tabular-nums font-semibold">
                            {involved ? formatCurrency(Number(e.amount)) : '—'}
                          </td>
                          <td className="px-5 py-3.5">
                            {involved ? (
                              <StatusChip kind={st.kind} amount={st.amount} label={st.label} />
                            ) : (
                              <span className="text-xs text-slate-400">Not in split</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <h2 className="font-display font-semibold">Settle-up log</h2>
              <p className="text-xs text-slate-500 mt-0.5">Person-to-person payments (not new splits)</p>
            </div>
            {settlements.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No settle-up payments yet</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {settlements.map((s) => {
                  const mine = user?.id === s.from_user_id || user?.id === s.to_user_id
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex -space-x-2 shrink-0">
                          <Avatar name={nameOf(s.from_user_id)} size="sm" className="ring-2 ring-white dark:ring-surface-dark-muted" />
                          <Avatar name={nameOf(s.to_user_id)} size="sm" className="ring-2 ring-white dark:ring-surface-dark-muted" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm truncate">
                            <span className="font-semibold">{nameOf(s.from_user_id)}</span>
                            <span className="text-slate-400"> paid </span>
                            <span className="font-semibold">{nameOf(s.to_user_id)}</span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {format(parseISO(s.settlement_date), 'dd MMM yyyy')}
                            {s.notes ? ` · ${s.notes}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums text-emerald-600 shrink-0">
                        {mine ? formatCurrency(Number(s.amount)) : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal
        open={expenseOpen || !!editingExpense}
        onClose={() => { setExpenseOpen(false); setEditingExpense(null) }}
        title={editingExpense ? 'Edit split' : 'New split'}
        size="lg"
      >
        <GroupExpenseForm
          key={editingExpense?.id || 'new'}
          groupId={group.id}
          groupName={group.name}
          members={members}
          initial={editingExpense}
          onDone={() => { setExpenseOpen(false); setEditingExpense(null); setTab('requests'); load() }}
        />
      </Modal>

      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="Settle up">
        {suggestions.length > 0 && !settlePrefill && (
          <div className="mb-4 rounded-2xl border border-brand-100 dark:border-brand-900 bg-brand-50/50 dark:bg-brand-950/30 p-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-2">Suggested</p>
            {suggestions.slice(0, 4).map((s, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-white dark:hover:bg-slate-800"
                onClick={() => setSettlePrefill({ fromId: s.from, toId: s.to, amount: s.amount })}
              >
                <span>{nameOf(s.from)} → {nameOf(s.to)}</span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </button>
            ))}
          </div>
        )}
        <SettlementForm
          groupId={group.id}
          groupName={group.name}
          members={members}
          prefill={settlePrefill || undefined}
          onDone={() => { setSettleOpen(false); setSettlePrefill(null); load() }}
        />
      </Modal>

      <Modal open={!!markPaidExpense} onClose={() => setMarkPaidExpense(null)} title={`Mark paid · ${markPaidExpense?.title || ''}`}>
        {markPaidExpense && (
          <MarkPaidForm
            expense={markPaidExpense}
            members={members}
            groupName={group.name}
            onDone={() => { setMarkPaidExpense(null); load() }}
          />
        )}
      </Modal>

      <Modal open={!!person} onClose={() => setPerson(null)} title={person?.name || 'Member'}>
        {person && user && (
          <PersonSheet
            person={person}
            expenses={expenses.filter((e) => person.relatedExpenseIds.includes(e.id))}
            myId={user.id}
            onSettle={() => { openSettleFor(person); setPerson(null) }}
            onMarkPaid={(e) => { setPerson(null); setMarkPaidExpense(e) }}
          />
        )}
      </Modal>
    </div>
  )
}

function BalanceBlock({
  title, hint, tone, children,
}: {
  title: string
  hint: string
  tone: 'owe' | 'owed' | 'settled'
  children: React.ReactNode
}) {
  const accent =
    tone === 'owe' ? 'border-l-rose-500' : tone === 'owed' ? 'border-l-emerald-500' : 'border-l-slate-300 dark:border-l-slate-600'
  return (
    <section className={cn('card overflow-hidden border-l-4', accent)}>
      <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
        <h2 className="font-display font-semibold">{title}</h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">{children}</div>
    </section>
  )
}

function PersonRow({
  person, tone, onClick,
}: {
  person: PersonPairBalance
  tone: 'owe' | 'owed' | 'settled'
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
      <Avatar name={person.name} url={person.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{person.name}</p>
        <p className="text-xs text-slate-500">
          {person.unpaidExpenseCount > 0
            ? `${person.unpaidExpenseCount} open split${person.unpaidExpenseCount === 1 ? '' : 's'}`
            : tone === 'settled' ? 'Cleared' : 'Balance open'}
        </p>
      </div>
      <p className={cn(
        'font-display text-lg font-semibold tabular-nums',
        tone === 'owe' && 'text-rose-600',
        tone === 'owed' && 'text-emerald-600',
        tone === 'settled' && 'text-slate-400'
      )}>
        {formatCurrency(Math.abs(person.net))}
      </p>
    </button>
  )
}

function isInvolvedInExpense(expense: GroupExpense, userId: string) {
  return (
    (expense.expense_participants || []).some((p) => p.user_id === userId) ||
    (expense.expense_payments || []).some((p) => p.user_id === userId)
  )
}

function StatusChip({ kind, amount, label }: { kind: 'owe' | 'owed' | 'none' | 'settled'; amount: number; label: string }) {
  if (kind === 'owe') {
    return <span className="inline-flex rounded-full bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300">{formatCurrency(amount)} left</span>
  }
  if (kind === 'owed') {
    return <span className="inline-flex rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Get {formatCurrency(amount)}</span>
  }
  return <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-500">{kind === 'settled' ? 'Settled' : label}</span>
}

function RequestCard({
  expense, myId, nameOf, members, onMarkPaid, onEdit,
}: {
  expense: GroupExpense
  myId: string
  nameOf: (id: string) => string
  members: { user_id: string; name: string; avatarUrl?: string | null }[]
  onMarkPaid: () => void
  onEdit: () => void
}) {
  const status = expenseStatusForUser(expense, myId)
  const parts = expense.expense_participants || []
  const involvedIds = [...new Set([...(expense.expense_payments || []).map((p) => p.user_id), ...parts.map((p) => p.user_id)])]
  const iAmIn = involvedIds.includes(myId)
  const canEdit = iAmIn || expense.created_by === myId
  const unpaidPeople = parts.filter((p) => participantRemaining(expense, p.user_id) > 0.01).length
  const totalPeople = parts.length || 1
  const paidPeople = Math.max(0, totalPeople - unpaidPeople)
  const progress = (paidPeople / totalPeople) * 100
  const creator = expense.created_by

  return (
    <article className="group relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-surface-dark-muted shadow-soft transition hover:shadow-card hover:border-brand-200 dark:hover:border-brand-800">
      <div className={cn(
        'absolute left-0 top-0 bottom-0 w-1',
        !iAmIn && 'bg-slate-300 dark:bg-slate-600',
        iAmIn && status.kind === 'owe' && 'bg-rose-500',
        iAmIn && status.kind === 'owed' && 'bg-emerald-500',
        iAmIn && (status.kind === 'settled' || status.kind === 'none') && 'bg-slate-300 dark:bg-slate-600'
      )} />

      <div className="p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <Avatar name={nameOf(creator)} size="sm" url={members.find((m) => m.user_id === creator)?.avatarUrl} />
              <span>{creator === myId ? 'You' : nameOf(creator)} created</span>
              <span>·</span>
              <span>{format(parseISO(expense.expense_date), 'd MMM')}</span>
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Requested for</p>
            <h3 className="mt-0.5 font-display text-xl font-semibold text-slate-900 dark:text-white truncate">
              {expense.title}
            </h3>
            {!iAmIn && (
              <p className="mt-1 text-xs text-slate-400">You are not in this split · {totalPeople} people</p>
            )}
          </div>
          {iAmIn ? (
            <p className="font-display text-2xl font-semibold tabular-nums shrink-0">{formatCurrency(Number(expense.amount))}</p>
          ) : (
            <p className="text-sm font-medium text-slate-400 shrink-0">Hidden</p>
          )}
        </div>

        {iAmIn && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-500">{paidPeople}/{totalPeople} paid</span>
              <StatusChip kind={status.kind} amount={status.amount} label={status.label} />
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', unpaidPeople === 0 ? 'bg-emerald-500' : 'bg-brand-500')}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex -space-x-2">
            {involvedIds.slice(0, 7).map((uid) => (
              <Avatar
                key={uid}
                name={nameOf(uid)}
                url={members.find((m) => m.user_id === uid)?.avatarUrl}
                size="sm"
                className="ring-2 ring-white dark:ring-surface-dark-muted"
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button type="button" onClick={onEdit} className="btn-secondary !rounded-full !py-2 !px-3 !text-xs">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            {iAmIn && unpaidPeople > 0 ? (
              <button type="button" onClick={onMarkPaid} className="btn-primary !rounded-full !py-2 !px-4 !text-xs">
                Mark paid
              </button>
            ) : iAmIn ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function PersonSheet({
  person, expenses, myId, onSettle, onMarkPaid,
}: {
  person: PersonPairBalance
  expenses: GroupExpense[]
  myId: string
  onSettle: () => void
  onMarkPaid: (e: GroupExpense) => void
}) {
  return (
    <div className="space-y-5">
      <div className="text-center rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-5">
        <Avatar name={person.name} url={person.avatarUrl} size="lg" className="mx-auto" />
        <p className="mt-3 font-display text-xl font-semibold">{person.name}</p>
        <p className={cn(
          'mt-1 text-sm font-semibold',
          person.net > 0.01 ? 'text-emerald-600' : person.net < -0.01 ? 'text-rose-600' : 'text-slate-400'
        )}>
          {person.net > 0.01
            ? `Owes you ${formatCurrency(person.net)}`
            : person.net < -0.01
              ? `You owe ${formatCurrency(Math.abs(person.net))}`
              : 'Settled up'}
        </p>
      </div>

      {Math.abs(person.net) > 0.01 && (
        <button type="button" className="btn-primary w-full !rounded-2xl" onClick={onSettle}>
          <HandCoins className="h-4 w-4" /> Settle up with {person.name.split(' ')[0]}
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Open splits together</h3>
        {expenses.length === 0 ? (
          <p className="text-sm text-slate-500">No open shared splits</p>
        ) : (
          <ul className="space-y-2">
            {expenses.map((e) => {
              const st = expenseStatusForUser(e, myId)
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-800 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{e.title}</p>
                    <StatusChip kind={st.kind} amount={st.amount} label={st.label} />
                  </div>
                  <button type="button" className="btn-secondary !rounded-full !py-1.5 !px-3 !text-xs shrink-0" onClick={() => onMarkPaid(e)}>
                    Mark paid
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, MoreVertical, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import { format, parseISO, isSameDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  computeGroupBalances,
  computeMyPairBalances,
  expenseStatusForUser,
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

type MainTab = 'chat' | 'expenses'

export function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<ExpenseGroup | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [expenses, setExpenses] = useState<GroupExpense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [tab, setTab] = useState<MainTab>('expenses')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [person, setPerson] = useState<PersonPairBalance | null>(null)
  const [settlePrefill, setSettlePrefill] = useState<{ fromId?: string; toId?: string; amount?: number } | null>(null)

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
        .order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', id).order('created_at', { ascending: false }),
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

  const feed = useMemo(() => {
    type Item =
      | { kind: 'expense'; at: string; expense: GroupExpense }
      | { kind: 'settlement'; at: string; settlement: Settlement }
    const items: Item[] = [
      ...expenses.map((e) => ({ kind: 'expense' as const, at: e.created_at || e.expense_date, expense: e })),
      ...settlements.map((s) => ({ kind: 'settlement' as const, at: s.created_at || s.settlement_date, settlement: s })),
    ]
    return items.sort((a, b) => +parseISO(b.at) - +parseISO(a.at))
  }, [expenses, settlements])

  const copyInvite = async () => {
    if (!group) return
    await navigator.clipboard.writeText(
      `Join my Hisaab group "${group.name}"\nCode: ${group.invite_code}\n${inviteLink(group.invite_code, 'group')}`
    )
    toast.success('Invite copied')
  }

  const openSettleFor = (p: PersonPairBalance) => {
    if (!user) return
    if (p.net < -0.01) {
      setSettlePrefill({ fromId: user.id, toId: p.userId, amount: Math.abs(p.net) })
    } else if (p.net > 0.01) {
      setSettlePrefill({ fromId: p.userId, toId: user.id, amount: p.net })
    } else {
      setSettlePrefill(null)
    }
    setSettleOpen(true)
  }

  if (loading) return <PageLoader />
  if (!group) {
    return (
      <div className="card p-8 text-center">
        <p>Group not found</p>
        <Link to="/groups" className="btn-primary mt-4 inline-flex">
          Back
        </Link>
      </div>
    )
  }

  return (
    <div className="relative mx-auto max-w-lg -mx-4 sm:mx-auto sm:px-0 min-h-[70vh] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-surface-dark/95 backdrop-blur px-4 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Link to="/groups" className="btn-ghost !p-2 -ml-2">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-semibold leading-tight">{group.name}</h1>
            <p className="text-xs text-slate-500">{members.length} members</p>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={copyInvite} title="Copy invite">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost !p-2" title="More">
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>

        <div className="flex">
          {([
            ['chat', 'Chat'],
            ['expenses', 'Expenses'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={cn(
                'flex-1 py-3 text-sm font-semibold border-b-2 transition',
                tab === k
                  ? 'border-sky-600 text-sky-700 dark:text-sky-400'
                  : 'border-transparent text-slate-500'
              )}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'expenses' && (
        <div className="px-4 pt-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
            <div>
              <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(totalOwedByYou)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Owed by you</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-emerald-600">
                {formatCurrency(totalOwedToYou)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Owed to you</p>
            </div>
          </div>

          {pairs.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No members yet"
              description="Invite people with the group code"
            />
          ) : (
            <>
              {owedByYou.length > 0 && (
                <PersonSection
                  title="Owed by you"
                  people={owedByYou}
                  tone="owe"
                  onSelect={setPerson}
                />
              )}
              {owedToYou.length > 0 && (
                <PersonSection
                  title={`${owedToYou.length} ${owedToYou.length === 1 ? 'person' : 'people'} owe${owedToYou.length === 1 ? 's' : ''} you`}
                  people={owedToYou}
                  tone="owed"
                  onSelect={setPerson}
                />
              )}
              {settledPeople.length > 0 && (
                <PersonSection title="Settled" people={settledPeople} tone="settled" onSelect={setPerson} />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'chat' && (
        <div className="px-4 pt-3 space-y-3">
          {feed.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No activity yet"
              description="Split an expense to start the group history"
              action={
                <button type="button" className="btn-primary" onClick={() => setExpenseOpen(true)}>
                  Split expense
                </button>
              }
            />
          ) : (
            feed.map((item, idx) => {
              const prev = feed[idx - 1]
              const showDate =
                !prev || !isSameDay(parseISO(item.at), parseISO(prev.at))
              return (
                <div key={item.kind === 'expense' ? item.expense.id : item.settlement.id}>
                  {showDate && (
                    <p className="text-center text-[11px] text-slate-400 my-3">
                      {format(parseISO(item.at), "EEEE, h:mma").replace(':00', '')}
                    </p>
                  )}
                  {item.kind === 'expense' ? (
                    <ExpenseChatCard
                      expense={item.expense}
                      myId={user!.id}
                      nameOf={nameOf}
                      members={memberMeta}
                    />
                  ) : (
                    <SettlementChatCard settlement={item.settlement} nameOf={nameOf} />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Sticky GPay-style actions */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-surface-dark/95 backdrop-blur px-4 py-3 sm:static sm:mt-6 sm:rounded-2xl sm:border sm:mx-4">
        <div className="mx-auto max-w-lg flex gap-3">
          <button
            type="button"
            className="flex-1 rounded-full border-2 border-sky-600 text-sky-700 dark:text-sky-400 font-semibold py-3 text-sm hover:bg-sky-50 dark:hover:bg-sky-950/40 transition"
            onClick={() => setExpenseOpen(true)}
          >
            Split expense
          </button>
          <button
            type="button"
            className="flex-1 rounded-full bg-sky-600 text-white font-semibold py-3 text-sm hover:bg-sky-700 transition"
            onClick={() => {
              setSettlePrefill(null)
              setSettleOpen(true)
            }}
          >
            Settle up
          </button>
        </div>
      </div>

      <Modal open={expenseOpen} onClose={() => setExpenseOpen(false)} title="Split expense" size="lg">
        <GroupExpenseForm
          groupId={group.id}
          members={members}
          onDone={() => {
            setExpenseOpen(false)
            setTab('chat')
            load()
          }}
        />
      </Modal>

      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="Settle up">
        {suggestions.length > 0 && !settlePrefill && (
          <div className="mb-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-sm space-y-1">
            <p className="font-medium text-slate-700 dark:text-slate-200 mb-1">Suggested</p>
            {suggestions.slice(0, 4).map((s, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full justify-between rounded-lg px-2 py-1.5 hover:bg-white dark:hover:bg-slate-700"
                onClick={() =>
                  setSettlePrefill({ fromId: s.from, toId: s.to, amount: s.amount })
                }
              >
                <span>
                  {nameOf(s.from)} → {nameOf(s.to)}
                </span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </button>
            ))}
          </div>
        )}
        <SettlementForm
          groupId={group.id}
          members={members}
          prefill={settlePrefill || undefined}
          onDone={() => {
            setSettleOpen(false)
            setSettlePrefill(null)
            load()
          }}
        />
      </Modal>

      <Modal
        open={!!person}
        onClose={() => setPerson(null)}
        title={person?.name || 'Member'}
      >
        {person && user && (
          <PersonSheet
            person={person}
            expenses={expenses.filter((e) => person.relatedExpenseIds.includes(e.id))}
            myId={user.id}
            onSettle={() => {
              openSettleFor(person)
              setPerson(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function PersonSection({
  title,
  people,
  tone,
  onSelect,
}: {
  title: string
  people: PersonPairBalance[]
  tone: 'owe' | 'owed' | 'settled'
  onSelect: (p: PersonPairBalance) => void
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">{title}</h2>
      <div className="space-y-1">
        {people.map((p) => (
          <button
            key={p.userId}
            type="button"
            onClick={() => onSelect(p)}
            className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left"
          >
            <Avatar name={p.name} url={p.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.unpaidExpenseCount > 0
                  ? `${p.unpaidExpenseCount} unpaid expense${p.unpaidExpenseCount === 1 ? '' : 's'}`
                  : tone === 'settled'
                    ? 'All settled'
                    : 'Open balance'}
              </p>
            </div>
            <p
              className={cn(
                'font-semibold tabular-nums',
                tone === 'owed' && 'text-emerald-600',
                tone === 'settled' && 'text-slate-400'
              )}
            >
              {formatCurrency(Math.abs(p.net))}
            </p>
          </button>
        ))}
      </div>
    </section>
  )
}

function ExpenseChatCard({
  expense,
  myId,
  nameOf,
  members,
}: {
  expense: GroupExpense
  myId: string
  nameOf: (id: string) => string
  members: { user_id: string; name: string; avatarUrl?: string | null }[]
}) {
  const status = expenseStatusForUser(expense, myId)
  const creator = expense.created_by
  const payers = expense.expense_payments || []
  const parts = expense.expense_participants || []
  const involved = [...new Set([...payers.map((p) => p.user_id), ...parts.map((p) => p.user_id)])]
  const paidCount = payers.length
  const left =
    status.kind === 'owe' ? status.amount : status.kind === 'owed' ? 0 : Number(expense.amount)

  return (
    <div className="space-y-1">
      {creator !== myId && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Avatar name={nameOf(creator)} size="sm" url={members.find((m) => m.user_id === creator)?.avatarUrl} />
          <span>{nameOf(creator)}</span>
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark-muted p-4 shadow-sm">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Requested for <span className="font-medium text-slate-900 dark:text-white">&apos;{expense.title}&apos;</span>
        </p>
        {status.kind === 'owe' && (
          <>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(Number(expense.amount))}</p>
            <div className="mt-3 h-1.5 rounded-full bg-sky-100 dark:bg-sky-950 overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, ((Number(expense.amount) - left) / Math.max(Number(expense.amount), 1)) * 100)
                  )}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {formatCurrency(status.amount)} left · {paidCount} of {involved.length} paid ·{' '}
              {format(parseISO(expense.expense_date), 'd MMM')}
            </p>
          </>
        )}
        {status.kind === 'owed' && (
          <>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(Number(expense.amount))}</p>
            <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">{status.label}</p>
          </>
        )}
        {(status.kind === 'none' || status.kind === 'settled') && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs">
              ✓
            </span>
            {status.label}
          </div>
        )}
        <div className="mt-3 flex -space-x-2">
          {involved.slice(0, 6).map((uid) => (
            <Avatar
              key={uid}
              name={nameOf(uid)}
              url={members.find((m) => m.user_id === uid)?.avatarUrl}
              size="sm"
              className="ring-2 ring-white dark:ring-surface-dark-muted"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SettlementChatCard({
  settlement,
  nameOf,
}: {
  settlement: Settlement
  nameOf: (id: string) => string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-dark-muted p-4 shadow-sm">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Requested for <span className="font-medium text-slate-900 dark:text-white">&apos;settlement&apos;</span>
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(Number(settlement.amount))}</p>
      <p className="mt-2 text-xs text-slate-500">
        {nameOf(settlement.from_user_id)} paid {nameOf(settlement.to_user_id)} ·{' '}
        {format(parseISO(settlement.settlement_date), 'd MMM')}
      </p>
    </div>
  )
}

function PersonSheet({
  person,
  expenses,
  myId,
  onSettle,
}: {
  person: PersonPairBalance
  expenses: GroupExpense[]
  myId: string
  onSettle: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <Avatar name={person.name} url={person.avatarUrl} size="lg" className="mx-auto" />
        <p className="mt-3 font-display text-lg font-semibold">{person.name}</p>
        <p
          className={cn(
            'mt-1 text-sm font-semibold',
            person.net > 0.01 ? 'text-emerald-600' : person.net < -0.01 ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'
          )}
        >
          {person.net > 0.01
            ? `Owes you ${formatCurrency(person.net)}`
            : person.net < -0.01
              ? `You owe ${formatCurrency(Math.abs(person.net))}`
              : 'Settled up'}
        </p>
      </div>

      {Math.abs(person.net) > 0.01 && (
        <button type="button" className="btn-primary w-full !rounded-full" onClick={onSettle}>
          Settle up
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Related expenses</h3>
        {expenses.length === 0 ? (
          <p className="text-sm text-slate-500">No open shared expenses</p>
        ) : (
          <ul className="space-y-2">
            {expenses.map((e) => {
              const st = expenseStatusForUser(e, myId)
              return (
                <li key={e.id} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm flex justify-between gap-2">
                  <div>
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-slate-500">{st.label}</p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatCurrency(Number(e.amount))}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

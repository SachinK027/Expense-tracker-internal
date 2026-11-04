import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Copy, UtensilsCrossed, Scale } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { computeTiffinBalances, suggestSettlements } from '@/lib/calculations'
import { formatCurrency, formatDate, inviteLink, todayISO, cn } from '@/lib/utils'
import type { TiffinGroup, TiffinMeal, TiffinMember, TiffinSettlement } from '@/types/database'
import { PageLoader } from '@/components/ui/Loading'
import { EmptyState } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { StatCard } from '@/components/ui/StatCard'
import { MealForm } from './MealForm'
import { TiffinSettlementForm } from './TiffinSettlementForm'

export function TiffinDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<TiffinGroup | null>(null)
  const [members, setMembers] = useState<TiffinMember[]>([])
  const [meals, setMeals] = useState<TiffinMeal[]>([])
  const [settlements, setSettlements] = useState<TiffinSettlement[]>([])
  const [tab, setTab] = useState<'today' | 'history' | 'balances' | 'settle'>('today')
  const [mealOpen, setMealOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [mealType, setMealType] = useState<'lunch' | 'dinner'>('lunch')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [{ data: g }, { data: mem }, { data: mealData }, { data: set }] = await Promise.all([
      supabase.from('tiffin_groups').select('*').eq('id', id).single(),
      supabase.from('tiffin_members').select('*, profiles(*)').eq('tiffin_group_id', id).eq('is_active', true),
      supabase
        .from('tiffin_meals')
        .select('*, tiffin_attendance(*), tiffin_contributions(*)')
        .eq('tiffin_group_id', id)
        .order('meal_date', { ascending: false })
        .limit(90),
      supabase.from('tiffin_settlements').select('*').eq('tiffin_group_id', id).order('settlement_date', { ascending: false }),
    ])
    setGroup(g as TiffinGroup | null)
    setMembers((mem as TiffinMember[]) || [])
    setMeals((mealData as TiffinMeal[]) || [])
    setSettlements((set as TiffinSettlement[]) || [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`tiffin-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiffin_meals', filter: `tiffin_group_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiffin_attendance' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiffin_contributions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiffin_settlements', filter: `tiffin_group_id=eq.${id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load])

  const balances = useMemo(() => {
    const list = members.map((m) => ({
      user_id: m.user_id,
      name: m.profiles?.full_name || m.profiles?.email || 'Member',
    }))
    return computeTiffinBalances(list, meals, settlements)
  }, [members, meals, settlements])

  const suggestions = useMemo(() => suggestSettlements(balances), [balances])
  const today = todayISO()
  const todayMeals = meals.filter((m) => m.meal_date === today)
  const nameOf = (uid: string) => balances.find((b) => b.userId === uid)?.name || 'Someone'
  const myBalance = balances.find((b) => b.userId === user?.id)

  const monthlyStats = useMemo(() => {
    const ym = format(new Date(), 'yyyy-MM')
    const monthMeals = meals.filter((m) => m.meal_date.startsWith(ym))
    const consumed: Record<string, number> = {}
    const contributed: Record<string, number> = {}
    for (const meal of monthMeals) {
      for (const a of meal.tiffin_attendance || []) {
        if (a.consumed) consumed[a.user_id] = (consumed[a.user_id] || 0) + 1 + (a.guest_count || 0)
        if (a.brought_food) contributed[a.user_id] = (contributed[a.user_id] || 0) + 1
      }
    }
    return { consumed, contributed, totalCost: monthMeals.reduce((s, m) => s + Number(m.total_cost), 0) }
  }, [meals])

  const copyInvite = async () => {
    if (!group) return
    await navigator.clipboard.writeText(
      `Join tiffin group "${group.name}"\nCode: ${group.invite_code}\n${inviteLink(group.invite_code, 'tiffin')}`
    )
    toast.success('Invite copied')
  }

  if (loading) return <PageLoader />
  if (!group) {
    return (
      <div className="card p-8 text-center">
        <p>Group not found</p>
        <Link to="/tiffin" className="btn-primary mt-4 inline-flex">Back</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/tiffin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700 mb-2">
            <ArrowLeft className="h-4 w-4" /> Tiffin
          </Link>
          <h1 className="page-title">{group.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{group.description || 'Daily meal tracking'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={copyInvite}>
            <Copy className="h-4 w-4" /> Invite
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSettleOpen(true)}>
            <Scale className="h-4 w-4" /> Settle
          </button>
          {group.track_lunch && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setMealType('lunch')
                setMealOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> Lunch
            </button>
          )}
          {group.track_dinner && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setMealType('dinner')
                setMealOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> Dinner
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="This month meals cost" value={formatCurrency(monthlyStats.totalCost)} icon={UtensilsCrossed} />
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
                <p className="text-[10px] text-slate-400">
                  Ate {monthlyStats.consumed[m.user_id] || 0} · Brought {monthlyStats.contributed[m.user_id] || 0}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 w-fit flex-wrap">
        {([
          ['today', "Today"],
          ['history', 'History'],
          ['balances', 'Balances'],
          ['settle', 'Settle'],
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

      {tab === 'today' && (
        <div className="grid gap-4 md:grid-cols-2">
          {(['lunch', 'dinner'] as const)
            .filter((t) => (t === 'lunch' ? group.track_lunch : group.track_dinner))
            .map((type) => {
              const meal = todayMeals.find((m) => m.meal_type === type)
              return (
                <div key={type} className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-display text-lg font-semibold capitalize">{type}</h2>
                    {!meal && (
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 !text-xs"
                        onClick={() => {
                          setMealType(type)
                          setMealOpen(true)
                        }}
                      >
                        Record
                      </button>
                    )}
                  </div>
                  {!meal ? (
                    <p className="text-sm text-slate-500">Not recorded yet</p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <p>
                        Cost: <strong>{formatCurrency(Number(meal.total_cost))}</strong>
                      </p>
                      <p>
                        Consumed:{' '}
                        {(meal.tiffin_attendance || [])
                          .filter((a) => a.consumed)
                          .map((a) => nameOf(a.user_id))
                          .join(', ') || 'None'}
                      </p>
                      <p>
                        Brought by:{' '}
                        {(meal.tiffin_attendance || [])
                          .filter((a) => a.brought_food)
                          .map((a) => nameOf(a.user_id))
                          .join(', ') || '—'}
                      </p>
                      <p>
                        Paid:{' '}
                        {(meal.tiffin_contributions || [])
                          .map((c) => `${nameOf(c.user_id)} ${formatCurrency(Number(c.amount))}`)
                          .join(', ') || '—'}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {tab === 'history' && (
        <div className="card overflow-hidden">
          {meals.length === 0 ? (
            <EmptyState icon={UtensilsCrossed} title="No meals yet" />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {meals.map((m) => {
                const consumers = (m.tiffin_attendance || []).filter((a) => a.consumed).length
                return (
                  <div key={m.id} className="px-5 py-3.5 flex justify-between gap-3">
                    <div>
                      <p className="font-medium capitalize">
                        {m.meal_type} · {formatDate(m.meal_date)}
                      </p>
                      <p className="text-xs text-slate-500">{consumers} consumer(s)</p>
                    </div>
                    <p className="font-semibold">{formatCurrency(Number(m.total_cost))}</p>
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
                    Paid {formatCurrency(b.paid)} · Consumed share {formatCurrency(b.owed)}
                  </p>
                </div>
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    b.net > 0.01 ? 'text-emerald-600' : b.net < -0.01 ? 'text-rose-600' : 'text-slate-500'
                  )}
                >
                  {Math.abs(b.net) < 0.01 ? 'Settled' : b.net > 0 ? `+${formatCurrency(b.net)}` : `−${formatCurrency(Math.abs(b.net))}`}
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
              <p className="text-sm text-slate-500">All settled</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm">
                    <span>
                      <strong>{nameOf(s.from)}</strong> → <strong>{nameOf(s.to)}</strong>
                    </span>
                    <span className="font-semibold">{formatCurrency(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 font-display font-semibold">
              Settlement history
            </div>
            {settlements.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">None yet</p>
            ) : (
              settlements.map((s) => (
                <div key={s.id} className="px-5 py-3 text-sm flex justify-between border-t border-slate-100 dark:border-slate-800">
                  <span>
                    {nameOf(s.from_user_id)} → {nameOf(s.to_user_id)}
                    <span className="block text-xs text-slate-400">{formatDate(s.settlement_date)}</span>
                  </span>
                  <span className="font-semibold">{formatCurrency(Number(s.amount))}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <Modal open={mealOpen} onClose={() => setMealOpen(false)} title={`Record ${mealType}`} size="lg">
        <MealForm
          group={group}
          members={members}
          mealType={mealType}
          onDone={() => {
            setMealOpen(false)
            load()
          }}
        />
      </Modal>
      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="Record settlement">
        <TiffinSettlementForm
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

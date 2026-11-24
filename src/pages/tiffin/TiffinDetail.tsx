import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Copy, Plus, Users, HandCoins, UtensilsCrossed, History, IndianRupee, CheckCircle2, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { computeTiffinBalances, suggestSettlements, sumIOwe, sumOwedToMe } from '@/lib/calculations'
import { formatCurrency, formatDate, inviteLink, todayISO, cn } from '@/lib/utils'
import type { TiffinGroup, TiffinMeal, TiffinMember, TiffinSettlement } from '@/types/database'
import { PageLoader } from '@/components/ui/Loading'
import { EmptyState } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { MealForm } from './MealForm'
import { TiffinSettlementForm } from './TiffinSettlementForm'

type Tab = 'balances' | 'meals' | 'history'

export function TiffinDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState<TiffinGroup | null>(null)
  const [members, setMembers] = useState<TiffinMember[]>([])
  const [meals, setMeals] = useState<TiffinMeal[]>([])
  const [settlements, setSettlements] = useState<TiffinSettlement[]>([])
  const [tab, setTab] = useState<Tab>('balances')
  const [mealOpen, setMealOpen] = useState(false)
  const [editingMeal, setEditingMeal] = useState<TiffinMeal | null>(null)
  const [settleOpen, setSettleOpen] = useState(false)
  const [mealType, setMealType] = useState<'lunch' | 'dinner'>('lunch')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))

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
        .limit(120),
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
  const nameOf = (uid: string) => balances.find((b) => b.userId === uid)?.name || 'Someone'
  const myId = user?.id || ''
  const youOwe = sumIOwe(balances, myId)
  const owedToYou = sumOwedToMe(balances, myId)
  const mySuggestions = useMemo(
    () => suggestions.filter((s) => s.from === myId || s.to === myId),
    [suggestions, myId]
  )

  const isInvolvedInMeal = (meal: TiffinMeal) => {
    if (!myId) return false
    if (meal.created_by === myId) return true
    if ((meal.tiffin_attendance || []).some((a) => a.user_id === myId && a.consumed)) return true
    if ((meal.tiffin_contributions || []).some((c) => c.user_id === myId)) return true
    return false
  }

  const canEditMeal = (meal: TiffinMeal) => isInvolvedInMeal(meal) || meal.created_by === myId

  const monthMeals = useMemo(() => meals.filter((m) => m.meal_date.startsWith(month)), [meals, month])

  const memberMonthStats = useMemo(() => {
    return members.map((m) => {
      let ate = 0
      let bought = 0
      let paid = 0
      for (const meal of monthMeals) {
        const att = (meal.tiffin_attendance || []).find((a) => a.user_id === m.user_id)
        if (att?.consumed) ate += 1 + (att.guest_count || 0)
        if (att?.brought_food) bought += 1
        for (const c of meal.tiffin_contributions || []) {
          if (c.user_id === m.user_id) paid += Number(c.amount)
        }
      }
      const bal = balances.find((b) => b.userId === m.user_id)
      return {
        userId: m.user_id,
        name: m.profiles?.full_name || m.profiles?.email || 'Member',
        avatarUrl: m.profiles?.avatar_url,
        ate,
        bought,
        paid,
        net: bal?.net || 0,
      }
    })
  }, [members, monthMeals, balances])

  const today = todayISO()
  const todayMeals = meals.filter((m) => m.meal_date === today)

  const copyInvite = async () => {
    if (!group) return
    await navigator.clipboard.writeText(
      `Join tiffin "${group.name}"\nCode: ${group.invite_code}\n${inviteLink(group.invite_code, 'tiffin')}`
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
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div className="relative overflow-hidden rounded-3xl border border-orange-200/50 dark:border-orange-900/40 bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-orange-950/40 dark:via-surface-dark-muted dark:to-slate-900 p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link to="/tiffin" className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-300 hover:underline mb-3">
              <ArrowLeft className="h-3.5 w-3.5" /> All tiffin groups
            </Link>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{group.name}</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              {group.description || 'Daily lunch & dinner tracking'}
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-slate-800/80 px-3 py-1 text-xs font-medium border border-slate-200/80 dark:border-slate-700">
                <Users className="h-3.5 w-3.5" /> {members.length} members
              </span>
              <button type="button" onClick={copyInvite} className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700">
                <Copy className="h-3.5 w-3.5" /> Invite
              </button>
            </div>
          </div>
          <div className="flex sm:flex-col gap-2 shrink-0">
            <button
              type="button"
              className="btn-primary !rounded-2xl !bg-orange-600 hover:!bg-orange-700"
              onClick={() => { setMealType('lunch'); setMealOpen(true) }}
            >
              <Plus className="h-4 w-4" /> Add meal
            </button>
            <button type="button" className="btn-secondary !rounded-2xl" onClick={() => setSettleOpen(true)}>
              <HandCoins className="h-4 w-4" /> Settle up
            </button>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/90 dark:bg-slate-900/60 border border-rose-100 dark:border-rose-900/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">You owe</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-rose-600">{formatCurrency(youOwe)}</p>
          </div>
          <div className="rounded-2xl bg-white/90 dark:bg-slate-900/60 border border-emerald-100 dark:border-emerald-900/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Owed to you</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-emerald-600">{formatCurrency(owedToYou)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 p-1.5">
        {([
          ['balances', 'Balances', IndianRupee],
          ['meals', 'Meals', UtensilsCrossed],
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
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'balances' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-semibold">Member balances</h2>
                <p className="text-xs text-slate-500">Based on meals eaten vs amount paid</p>
              </div>
              <input type="month" className="input !w-auto !py-1.5 !text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {memberMonthStats.map((m) => {
                const mine = m.userId === myId
                return (
                  <div key={m.userId} className="flex items-center gap-3 px-5 py-3.5">
                    <Avatar name={m.name} url={m.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{m.name}{mine ? ' (you)' : ''}</p>
                      <p className="text-xs text-slate-500">
                        Ate {m.ate} · Bought {m.bought}
                        {mine ? ` · Paid ${formatCurrency(m.paid)}` : ''}
                      </p>
                    </div>
                    {mine ? (
                      <p className={cn(
                        'font-display text-lg font-semibold tabular-nums',
                        m.net > 0.01 ? 'text-emerald-600' : m.net < -0.01 ? 'text-rose-600' : 'text-slate-400'
                      )}>
                        {Math.abs(m.net) < 0.01 ? '₹0' : m.net > 0 ? `+${formatCurrency(m.net)}` : `−${formatCurrency(Math.abs(m.net))}`}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">—</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {mySuggestions.length > 0 && (
            <div className="card p-5">
              <h2 className="font-display font-semibold mb-3">Suggested settle-up</h2>
              <ul className="space-y-2">
                {mySuggestions.map((s, i) => (
                  <li key={i} className="flex justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm">
                    <span><strong>{nameOf(s.from)}</strong> → <strong>{nameOf(s.to)}</strong></span>
                    <span className="font-semibold">{formatCurrency(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'meals' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(['lunch', 'dinner'] as const).map((type) => {
              const meal = todayMeals.find((m) => m.meal_type === type)
              return (
                <div key={type} className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-semibold capitalize">{type} today</h3>
                    {!meal && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-orange-700 dark:text-orange-300"
                        onClick={() => { setMealType(type); setMealOpen(true) }}
                      >
                        Record
                      </button>
                    )}
                  </div>
                  {!meal ? (
                    <p className="text-sm text-slate-500">Not recorded</p>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <p>
                        Cost{' '}
                        <strong>
                          {isInvolvedInMeal(meal) ? formatCurrency(Number(meal.total_cost)) : 'Hidden'}
                        </strong>
                      </p>
                      <p className="text-slate-500">
                        Ate: {(meal.tiffin_attendance || []).filter((a) => a.consumed).map((a) => nameOf(a.user_id)).join(', ') || '—'}
                      </p>
                      <p className="text-slate-500">
                        Bought/paid: {(meal.tiffin_contributions || []).map((c) => nameOf(c.user_id)).join(', ') || '—'}
                      </p>
                      {canEditMeal(meal) && (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-700 dark:text-orange-300"
                          onClick={() => setEditingMeal(meal)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {meals.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={UtensilsCrossed}
                title="No meals yet"
                description="When you buy tiffin, add the amount and who ate"
                action={
                  <button type="button" className="btn-primary !bg-orange-600 hover:!bg-orange-700" onClick={() => setMealOpen(true)}>
                    Add meal
                  </button>
                }
              />
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="font-display font-semibold px-1">Recent meals</h2>
              {meals.slice(0, 15).map((m) => {
                const ate = (m.tiffin_attendance || []).filter((a) => a.consumed)
                const paidBy = (m.tiffin_contributions || []).map((c) => nameOf(c.user_id)).join(', ')
                const involved = isInvolvedInMeal(m)
                return (
                  <article key={m.id} className="card p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{formatDate(m.meal_date)} · <span className="capitalize">{m.meal_type}</span></p>
                      <p className="mt-1 font-semibold">
                        {involved ? formatCurrency(Number(m.total_cost)) : 'Amount hidden'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">Paid by {paidBy || '—'}</p>
                      <p className="text-xs text-slate-500">Ate: {ate.map((a) => nameOf(a.user_id)).join(', ') || '—'}</p>
                      {canEditMeal(m) && (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-700 dark:text-orange-300"
                          onClick={() => setEditingMeal(m)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      )}
                    </div>
                    <span className="text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-1 shrink-0">{ate.length} people</span>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold">Month ledger</h2>
              <p className="text-xs text-slate-500">Who bought, who ate, who paid</p>
            </div>
            <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-3 py-3 font-medium">Meal</th>
                    <th className="px-3 py-3 font-medium">Bought / paid</th>
                    <th className="px-3 py-3 font-medium">Who ate</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {monthMeals.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No meals this month</td>
                    </tr>
                  ) : (
                    monthMeals.map((m) => {
                      const ate = (m.tiffin_attendance || []).filter((a) => a.consumed)
                      const paid = (m.tiffin_contributions || []).map((c) => nameOf(c.user_id)).join(', ')
                      const involved = isInvolvedInMeal(m)
                      return (
                        <tr key={m.id} className="border-b border-slate-50 dark:border-slate-800/80">
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                            {format(parseISO(m.meal_date), 'dd MMM')}
                          </td>
                          <td className="px-3 py-3 capitalize font-medium">{m.meal_type}</td>
                          <td className="px-3 py-3">{paid || '—'}</td>
                          <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-[180px]">
                            {ate.map((a) => nameOf(a.user_id)).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {involved ? formatCurrency(Number(m.total_cost)) : '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display font-semibold">Monthly summary per person</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-3 py-3 font-medium text-center">Ate</th>
                    <th className="px-3 py-3 font-medium text-center">Bought</th>
                    <th className="px-3 py-3 font-medium text-right">Paid</th>
                    <th className="px-5 py-3 font-medium text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {memberMonthStats.map((m) => {
                    const mine = m.userId === myId
                    return (
                      <tr key={m.userId} className="border-b border-slate-50 dark:border-slate-800/80">
                        <td className="px-5 py-3 font-medium">{m.name}{mine ? ' (you)' : ''}</td>
                        <td className="px-3 py-3 text-center">{m.ate}</td>
                        <td className="px-3 py-3 text-center">{m.bought}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{mine ? formatCurrency(m.paid) : '—'}</td>
                        <td className={cn(
                          'px-5 py-3 text-right font-semibold tabular-nums',
                          mine && m.net > 0.01 && 'text-emerald-600',
                          mine && m.net < -0.01 && 'text-rose-600',
                          (!mine || Math.abs(m.net) < 0.01) && 'text-slate-400'
                        )}>
                          {!mine ? '—' : Math.abs(m.net) < 0.01 ? (
                            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> 0</span>
                          ) : m.net > 0 ? `+${formatCurrency(m.net)}` : `−${formatCurrency(Math.abs(m.net))}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display font-semibold">Settle-up log</h2>
            </div>
            {settlements.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No settlements yet</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {settlements.map((s) => {
                  const mine = myId === s.from_user_id || myId === s.to_user_id
                  return (
                    <li key={s.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p><strong>{nameOf(s.from_user_id)}</strong> → <strong>{nameOf(s.to_user_id)}</strong></p>
                        <p className="text-xs text-slate-500">{formatDate(s.settlement_date)}</p>
                      </div>
                      <span className="font-semibold text-emerald-600">
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
        open={mealOpen || !!editingMeal}
        onClose={() => { setMealOpen(false); setEditingMeal(null) }}
        title={editingMeal ? 'Edit meal' : 'Add meal'}
        size="lg"
      >
        <MealForm
          key={editingMeal?.id || 'new'}
          group={group}
          members={members}
          mealType={mealType}
          initial={editingMeal}
          onDone={() => { setMealOpen(false); setEditingMeal(null); setTab('meals'); load() }}
        />
      </Modal>

      <Modal open={settleOpen} onClose={() => setSettleOpen(false)} title="Settle up">
        {mySuggestions.length > 0 && (
          <div className="mb-4 rounded-2xl border border-orange-100 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20 p-3 text-sm space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 mb-2">Suggested</p>
            {mySuggestions.slice(0, 4).map((s, i) => (
              <div key={i} className="flex justify-between px-2 py-1">
                <span>{nameOf(s.from)} → {nameOf(s.to)}</span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <TiffinSettlementForm
          groupId={group.id}
          members={members}
          onDone={() => { setSettleOpen(false); load() }}
        />
      </Modal>
    </div>
  )
}

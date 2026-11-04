import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet, TrendingUp, TrendingDown, Users, UtensilsCrossed, ArrowRightLeft, Scale,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { format, parseISO, startOfMonth, eachDayOfInterval, endOfMonth, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { computeGroupBalances, computeTiffinBalances, sumIOwe, sumOwedToMe } from '@/lib/calculations'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { GroupExpense, PersonalTransaction, Settlement, TiffinMeal, TiffinSettlement } from '@/types/database'
import { StatCard } from '@/components/ui/StatCard'
import { PageLoader } from '@/components/ui/Loading'

export function Dashboard() {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [txs, setTxs] = useState<PersonalTransaction[]>([])
  const [groupOwed, setGroupOwed] = useState(0)
  const [groupOwe, setGroupOwe] = useState(0)
  const [tiffinOwed, setTiffinOwed] = useState(0)
  const [tiffinOwe, setTiffinOwe] = useState(0)
  const [reminders, setReminders] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

    const { data: txData } = await supabase
      .from('personal_transactions')
      .select('*, expense_categories(*)')
      .eq('user_id', user.id)
      .gte('transaction_date', format(subDays(new Date(), 60), 'yyyy-MM-dd'))
      .order('transaction_date', { ascending: false })

    setTxs((txData as PersonalTransaction[]) || [])

    // Group balances across all memberships
    const { data: gMem } = await supabase.from('group_members').select('group_id').eq('user_id', user.id)
    let gOwed = 0
    let gOwe = 0
    const remind: string[] = []
    for (const gm of gMem || []) {
      const [{ data: members }, { data: expenses }, { data: settlements }, { data: group }] = await Promise.all([
        supabase.from('group_members').select('user_id, profiles(full_name, email)').eq('group_id', gm.group_id),
        supabase.from('group_expenses').select('*, expense_payments(*), expense_participants(*)').eq('group_id', gm.group_id),
        supabase.from('settlements').select('*').eq('group_id', gm.group_id),
        supabase.from('expense_groups').select('name').eq('id', gm.group_id).single(),
      ])
      const list = (members || []).map((m) => ({
        user_id: m.user_id,
        name: (m.profiles as { full_name?: string; email?: string } | null)?.full_name
          || (m.profiles as { email?: string } | null)?.email
          || 'Member',
      }))
      const bals = computeGroupBalances(list, (expenses as GroupExpense[]) || [], (settlements as Settlement[]) || [])
      gOwed += sumOwedToMe(bals, user.id)
      gOwe += sumIOwe(bals, user.id)
      const mine = bals.find((b) => b.userId === user.id)
      if (mine && mine.net < -1) remind.push(`Settle ${formatCurrency(Math.abs(mine.net))} in ${group?.name || 'group'}`)
    }
    setGroupOwed(gOwed)
    setGroupOwe(gOwe)

    // Tiffin
    const { data: tMem } = await supabase
      .from('tiffin_members')
      .select('tiffin_group_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
    let tOwed = 0
    let tOwe = 0
    for (const tm of tMem || []) {
      const [{ data: members }, { data: meals }, { data: settlements }, { data: tg }] = await Promise.all([
        supabase.from('tiffin_members').select('user_id, profiles(full_name, email)').eq('tiffin_group_id', tm.tiffin_group_id).eq('is_active', true),
        supabase.from('tiffin_meals').select('*, tiffin_attendance(*), tiffin_contributions(*)').eq('tiffin_group_id', tm.tiffin_group_id),
        supabase.from('tiffin_settlements').select('*').eq('tiffin_group_id', tm.tiffin_group_id),
        supabase.from('tiffin_groups').select('name').eq('id', tm.tiffin_group_id).single(),
      ])
      const list = (members || []).map((m) => ({
        user_id: m.user_id,
        name: (m.profiles as { full_name?: string; email?: string } | null)?.full_name
          || (m.profiles as { email?: string } | null)?.email
          || 'Member',
      }))
      const bals = computeTiffinBalances(
        list,
        (meals as TiffinMeal[]) || [],
        (settlements as TiffinSettlement[]) || []
      )
      tOwed += sumOwedToMe(bals, user.id)
      tOwe += sumIOwe(bals, user.id)
      const mine = bals.find((b) => b.userId === user.id)
      if (mine && mine.net < -1) remind.push(`Settle tiffin ${formatCurrency(Math.abs(mine.net))} in ${tg?.name || 'tiffin'}`)
    }
    setTiffinOwed(tOwed)
    setTiffinOwe(tOwe)
    setReminders(remind)
    setLoading(false)
    void monthStart
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  const monthTx = useMemo(() => {
    const start = startOfMonth(new Date())
    return txs.filter((t) => parseISO(t.transaction_date) >= start)
  }, [txs])

  const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const balance = income - expense

  const chartData = useMemo(() => {
    const start = startOfMonth(new Date())
    const end = endOfMonth(new Date())
    return eachDayOfInterval({ start, end }).map((day) => {
      const key = format(day, 'yyyy-MM-dd')
      const dayTx = monthTx.filter((t) => t.transaction_date === key)
      return {
        day: format(day, 'd'),
        income: dayTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0),
        expense: dayTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0),
      }
    })
  }, [monthTx])

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Hello, {profile?.full_name?.split(' ')[0] || 'there'}</h1>
        <p className="mt-1 text-sm text-slate-500">Your finance snapshot for {format(new Date(), 'MMMM yyyy')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Personal balance" value={formatCurrency(balance)} icon={Wallet} tone={balance >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Monthly income" value={formatCurrency(income)} icon={TrendingUp} tone="positive" />
        <StatCard label="Monthly expenses" value={formatCurrency(expense)} icon={TrendingDown} tone="negative" />
        <StatCard label="Others owe me" value={formatCurrency(groupOwed + tiffinOwed)} icon={Scale} tone="positive" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="I owe others" value={formatCurrency(groupOwe + tiffinOwe)} icon={ArrowRightLeft} tone="warning" />
        <StatCard label="Group net owed to me" value={formatCurrency(groupOwed)} icon={Users} />
        <StatCard label="Tiffin outstanding (owed to me)" value={formatCurrency(tiffinOwed)} icon={UtensilsCrossed} />
        <StatCard label="Tiffin I owe" value={formatCurrency(tiffinOwe)} icon={UtensilsCrossed} tone="negative" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card p-5 lg:col-span-3">
          <h2 className="font-display text-lg font-semibold mb-4">Monthly spending</h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2d9266" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#2d9266" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Area type="monotone" dataKey="income" stroke="#2d9266" fill="url(#inc)" strokeWidth={2} />
              <Area type="monotone" dataKey="expense" stroke="#ef4444" fill="url(#exp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5 lg:col-span-2 space-y-4">
          <h2 className="font-display text-lg font-semibold">Settlement reminders</h2>
          {reminders.length === 0 ? (
            <p className="text-sm text-slate-500">You're all caught up.</p>
          ) : (
            <ul className="space-y-2">
              {reminders.map((r, i) => (
                <li key={i} className="rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm px-3 py-2">
                  {r}
                </li>
              ))}
            </ul>
          )}
          <div className="pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
            <Link to="/groups" className="btn-secondary w-full">Open groups</Link>
            <Link to="/tiffin" className="btn-secondary w-full">Open tiffin</Link>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display text-lg font-semibold">Recent transactions</h2>
          <Link to="/expenses" className="text-sm font-semibold text-brand-700 dark:text-brand-400">View all</Link>
        </div>
        {txs.slice(0, 8).length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No personal transactions yet</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {txs.slice(0, 8).map((t) => (
              <div key={t.id} className="flex justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{t.expense_categories?.name || t.type}</p>
                  <p className="text-xs text-slate-500">{formatDate(t.transaction_date)}</p>
                </div>
                <p className={t.type === 'income' ? 'text-emerald-600 font-semibold' : 'font-semibold'}>
                  {t.type === 'income' ? '+' : '−'}{formatCurrency(Number(t.amount))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Wallet, TrendingUp, TrendingDown, PiggyBank, AlertTriangle } from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts'
import toast from 'react-hot-toast'
import { format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { Budget, ExpenseCategory, PersonalTransaction } from '@/types/database'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Loading'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TransactionForm } from './TransactionForm'
import { BudgetForm } from './BudgetForm'
import { CategoryManager } from './CategoryManager'

type Period = 'day' | 'week' | 'month' | 'all'

export function PersonalExpenses() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [txs, setTxs] = useState<PersonalTransaction[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PersonalTransaction | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const [{ data: txData }, { data: catData }, { data: budData }] = await Promise.all([
      supabase
        .from('personal_transactions')
        .select('*, expense_categories(*)')
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false }),
      supabase.from('expense_categories').select('*').eq('user_id', user.id).order('name'),
      supabase.from('budgets').select('*, expense_categories(*)').eq('user_id', user.id).eq('year', y).eq('month', m),
    ])
    setTxs((txData as PersonalTransaction[]) || [])
    setCategories((catData as ExpenseCategory[]) || [])
    setBudgets((budData as Budget[]) || [])
    setLoading(false)
  }, [user, month])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const now = new Date()
    return txs.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (categoryFilter !== 'all' && t.category_id !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${t.notes || ''} ${t.expense_categories?.name || ''} ${t.payment_method}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const d = parseISO(t.transaction_date)
      if (period === 'day') {
        return isWithinInterval(d, { start: startOfDay(now), end: endOfDay(now) })
      }
      if (period === 'week') {
        return isWithinInterval(d, {
          start: startOfWeek(now, { weekStartsOn: 1 }),
          end: endOfWeek(now, { weekStartsOn: 1 }),
        })
      }
      if (period === 'month') {
        const [y, m] = month.split('-').map(Number)
        const ref = new Date(y, m - 1, 1)
        return isWithinInterval(d, { start: startOfMonth(ref), end: endOfMonth(ref) })
      }
      return true
    })
  }, [txs, typeFilter, categoryFilter, search, period, month])

  const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const balance = income - expense

  const pieData = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>()
    for (const t of filtered.filter((x) => x.type === 'expense')) {
      const name = t.expense_categories?.name || 'Uncategorized'
      const color = t.expense_categories?.color || '#94a3b8'
      const cur = map.get(name) || { name, value: 0, color }
      cur.value += Number(t.amount)
      map.set(name, cur)
    }
    return Array.from(map.values())
  }, [filtered])

  const budgetUsage = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const monthTx = txs.filter((t) => {
      const d = parseISO(t.transaction_date)
      return t.type === 'expense' && d.getFullYear() === y && d.getMonth() + 1 === m
    })
    return budgets.map((b) => {
      const spent = monthTx
        .filter((t) => t.category_id === b.category_id)
        .reduce((s, t) => s + Number(t.amount), 0)
      const pct = (spent / Number(b.amount)) * 100
      return {
        ...b,
        spent,
        pct,
        over: spent > Number(b.amount),
        name: b.expense_categories?.name || 'Category',
      }
    })
  }, [budgets, txs, month])

  const handleDelete = async () => {
    if (!deleteId) return
    const { error } = await supabase.from('personal_transactions').delete().eq('id', deleteId)
    if (error) toast.error(error.message)
    else {
      toast.success('Transaction deleted')
      setDeleteId(null)
      load()
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">My Expenses</h1>
          <p className="mt-1 text-sm text-slate-500">Track private income, expenses and budgets</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setCatOpen(true)}>Categories</button>
          <button type="button" className="btn-secondary" onClick={() => setBudgetOpen(true)}>Budgets</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={formatCurrency(income)} icon={TrendingUp} tone="positive" />
        <StatCard label="Expenses" value={formatCurrency(expense)} icon={TrendingDown} tone="negative" />
        <StatCard label="Balance" value={formatCurrency(balance)} icon={PiggyBank} tone={balance >= 0 ? 'positive' : 'negative'} />
      </div>

      {budgetUsage.some((b) => b.over) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Budget alert</p>
            <p className="mt-0.5">
              Overspending in: {budgetUsage.filter((b) => b.over).map((b) => b.name).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="card p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input !pl-9"
            placeholder="Search notes, category, payment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select className="input !w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input !w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="day">Today</option>
            <option value="week">This week</option>
            <option value="month">Month</option>
            <option value="all">All time</option>
          </select>
          {period === 'month' && (
            <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Spending breakdown</h2>
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-500 py-10 text-center">No expense data for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {pieData.map((d) => (
              <span key={d.name} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Budget usage</h2>
          {budgetUsage.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No budgets set"
              description="Set monthly category budgets to track overspending"
              action={<button type="button" className="btn-primary" onClick={() => setBudgetOpen(true)}>Set budget</button>}
            />
          ) : (
            <div className="space-y-4">
              {budgetUsage.map((b) => (
                <div key={b.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{b.name}</span>
                    <span className={cn(b.over && 'text-rose-600 font-semibold')}>
                      {formatCurrency(b.spent)} / {formatCurrency(Number(b.amount))}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', b.over ? 'bg-rose-500' : 'bg-brand-500')}
                      style={{ width: `${Math.min(b.pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Transaction history</h2>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No transactions"
            description="Add your first income or expense"
            action={
              <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" /> Add transaction
              </button>
            }
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
                  style={{ background: t.expense_categories?.color || '#64748b' }}
                >
                  {(t.expense_categories?.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.expense_categories?.name || 'Uncategorized'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(t.transaction_date)} · {t.payment_method}
                    {t.notes ? ` · ${t.notes}` : ''}
                  </p>
                </div>
                <p className={cn('font-semibold tabular-nums', t.type === 'income' ? 'text-emerald-600' : 'text-slate-900 dark:text-slate-100')}>
                  {t.type === 'income' ? '+' : '−'}{formatCurrency(Number(t.amount))}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn-ghost !p-2"
                    onClick={() => {
                      setEditing(t)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" className="btn-ghost !p-2 text-rose-600" onClick={() => setDeleteId(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit transaction' : 'Add transaction'}>
        <TransactionForm
          categories={categories}
          initial={editing}
          onDone={() => {
            setFormOpen(false)
            load()
          }}
        />
      </Modal>

      <Modal open={budgetOpen} onClose={() => setBudgetOpen(false)} title="Monthly budgets">
        <BudgetForm
          categories={categories.filter((c) => c.type === 'expense')}
          budgets={budgets}
          month={month}
          onDone={() => {
            setBudgetOpen(false)
            load()
          }}
        />
      </Modal>

      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="Categories">
        <CategoryManager categories={categories} onChange={load} />
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete transaction?"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}

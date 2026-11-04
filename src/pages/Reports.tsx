import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, downloadCSV } from '@/lib/utils'
import type { PersonalTransaction } from '@/types/database'
import { PageLoader } from '@/components/ui/Loading'
import { StatCard } from '@/components/ui/StatCard'
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react'

export function Reports() {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [txs, setTxs] = useState<PersonalTransaction[]>([])
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('personal_transactions')
      .select('*, expense_categories(*)')
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
    setTxs((data as PersonalTransaction[]) || [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const ref = new Date(y, m - 1, 1)
    return txs.filter((t) =>
      isWithinInterval(parseISO(t.transaction_date), { start: startOfMonth(ref), end: endOfMonth(ref) })
    )
  }, [txs, month])

  const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>()
    for (const t of filtered.filter((x) => x.type === 'expense')) {
      const name = t.expense_categories?.name || 'Other'
      const color = t.expense_categories?.color || '#94a3b8'
      const cur = map.get(name) || { name, value: 0, color }
      cur.value += Number(t.amount)
      map.set(name, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value)
  }, [filtered])

  const exportCSV = () => {
    downloadCSV(
      `hisaab-${month}.csv`,
      filtered.map((t) => ({
        date: t.transaction_date,
        type: t.type,
        category: t.expense_categories?.name || '',
        amount: t.amount,
        payment_method: t.payment_method,
        notes: t.notes || '',
      }))
    )
    toast.success('CSV downloaded')
  }

  const exportPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text(`Hisaab Report — ${month}`, 14, 18)
    doc.setFontSize(11)
    doc.text(`${profile?.full_name || ''} · Income ${formatCurrency(income)} · Expense ${formatCurrency(expense)}`, 14, 26)
    autoTable(doc, {
      startY: 32,
      head: [['Date', 'Type', 'Category', 'Amount', 'Notes']],
      body: filtered.map((t) => [
        t.transaction_date,
        t.type,
        t.expense_categories?.name || '',
        String(t.amount),
        t.notes || '',
      ]),
    })
    doc.save(`hisaab-${month}.pdf`)
    toast.success('PDF downloaded')
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Personal monthly income, expenses and category breakdown</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button type="button" className="btn-secondary" onClick={exportCSV}>
            <Download className="h-4 w-4" /> CSV
          </button>
          <button type="button" className="btn-secondary" onClick={exportPDF}>
            <FileText className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={formatCurrency(income)} icon={TrendingUp} tone="positive" />
        <StatCard label="Expenses" value={formatCurrency(expense)} icon={TrendingDown} tone="negative" />
        <StatCard label="Net" value={formatCurrency(income - expense)} icon={Wallet} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Category expenses</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {byCategory.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h2 className="font-display text-lg font-semibold mb-4">Share</h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-slate-500 py-16 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={48}>
                  {byCategory.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}

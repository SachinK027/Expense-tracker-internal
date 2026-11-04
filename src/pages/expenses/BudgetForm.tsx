import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import type { Budget, ExpenseCategory } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  categories: ExpenseCategory[]
  budgets: Budget[]
  month: string
  onDone: () => void
}

export function BudgetForm({ categories, budgets, month, onDone }: Props) {
  const { user } = useAuth()
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !categoryId) return
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const [y, m] = month.split('-').map(Number)
    setSaving(true)
    const { error } = await supabase.from('budgets').upsert(
      {
        user_id: user.id,
        category_id: categoryId,
        amount: amt,
        month: m,
        year: y,
      },
      { onConflict: 'user_id,category_id,month,year' }
    )
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      toast.success('Budget saved')
      setAmount('')
      onDone()
    }
  }

  return (
    <div className="space-y-5">
      {budgets.length > 0 && (
        <ul className="space-y-2">
          {budgets.map((b) => (
            <li key={b.id} className="flex justify-between text-sm rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
              <span>{b.expense_categories?.name}</span>
              <span className="font-semibold">{formatCurrency(Number(b.amount))}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Monthly limit (₹) for {month}</label>
          <input type="number" step="0.01" min="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Save budget'}
        </button>
      </form>
    </div>
  )
}

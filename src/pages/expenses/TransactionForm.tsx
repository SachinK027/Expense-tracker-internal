import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { todayISO } from '@/lib/utils'
import type { ExpenseCategory, PersonalTransaction, TxType } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

const METHODS = ['cash', 'upi', 'card', 'bank', 'other']

interface Props {
  categories: ExpenseCategory[]
  initial: PersonalTransaction | null
  onDone: () => void
}

export function TransactionForm({ categories, initial, onDone }: Props) {
  const { user } = useAuth()
  const [type, setType] = useState<TxType>(initial?.type || 'expense')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.category_id || '')
  const [date, setDate] = useState(initial?.transaction_date || todayISO())
  const [method, setMethod] = useState(initial?.payment_method || 'upi')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [saving, setSaving] = useState(false)

  const cats = categories.filter((c) => c.type === type)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSaving(true)
    const payload = {
      user_id: user.id,
      type,
      amount: amt,
      category_id: categoryId || null,
      transaction_date: date,
      payment_method: method,
      notes: notes.trim() || null,
    }
    const { error } = initial
      ? await supabase.from('personal_transactions').update(payload).eq('id', initial.id)
      : await supabase.from('personal_transactions').insert(payload)
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      toast.success(initial ? 'Updated' : 'Added')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
        {(['expense', 'income'] as TxType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-lg py-2 text-sm font-semibold capitalize transition ${
              type === t ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'
            }`}
            onClick={() => {
              setType(t)
              setCategoryId('')
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div>
        <label className="label">Amount (₹)</label>
        <input type="number" step="0.01" min="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <label className="label">Category</label>
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Select…</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Payment</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : initial ? 'Save changes' : 'Add transaction'}
      </button>
    </form>
  )
}

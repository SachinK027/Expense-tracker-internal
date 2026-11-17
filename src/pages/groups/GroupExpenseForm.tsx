import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { calculateShares } from '@/lib/calculations'
import { syncFrontedPayment } from '@/lib/personalSync'
import { todayISO, formatCurrency } from '@/lib/utils'
import type { GroupMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

const CATEGORIES = ['general', 'food', 'travel', 'rent', 'utilities', 'entertainment', 'other']

interface Props {
  groupId: string
  groupName: string
  members: GroupMember[]
  onDone: () => void
}

export function GroupExpenseForm({ groupId, groupName, members, onDone }: Props) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('general')
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>(members.map((m) => m.user_id))
  const [saving, setSaving] = useState(false)

  const total = Number(amount) || 0
  const preview = useMemo(
    () => calculateShares(total, 'equal', participantIds.map((id) => ({ userId: id }))),
    [total, participantIds]
  )

  const toggle = (id: string) => {
    setParticipantIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  }

  const selectAll = () => setParticipantIds(members.map((m) => m.user_id))
  const clearAll = () => setParticipantIds([])

  const label = (m: GroupMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!title.trim() || total <= 0) {
      toast.error('Title and amount required')
      return
    }
    if (!participantIds.length) {
      toast.error('Select who shares this split')
      return
    }

    // You created the split → you paid
    const payments = [{ user_id: user.id, amount: total }]
    const shares = calculateShares(
      total,
      'equal',
      participantIds.map((id) => ({ userId: id }))
    )

    setSaving(true)
    const { data: exp, error } = await supabase
      .from('group_expenses')
      .insert({
        group_id: groupId,
        title: title.trim(),
        amount: total,
        category,
        expense_date: date,
        notes: notes.trim() || null,
        split_type: 'equal',
        created_by: user.id,
      })
      .select()
      .single()

    if (error || !exp) {
      setSaving(false)
      toast.error(error?.message || 'Failed')
      return
    }

    const { data: payRows, error: payErr } = await supabase
      .from('expense_payments')
      .insert(payments.map((p) => ({ expense_id: exp.id, user_id: p.user_id, amount: p.amount })))
      .select('id, user_id, amount')

    const { error: partErr } = await supabase.from('expense_participants').insert(
      shares.map((s) => ({
        expense_id: exp.id,
        user_id: s.userId,
        share_amount: s.shareAmount,
        share_value: null,
      }))
    )

    if (payErr || partErr) {
      setSaving(false)
      toast.error(payErr?.message || partErr?.message || 'Error saving splits')
      return
    }

    try {
      await Promise.all(
        (payRows || []).map((p) =>
          syncFrontedPayment({
            userId: p.user_id,
            amount: Number(p.amount),
            date,
            groupName,
            title: title.trim(),
            paymentId: p.id,
          })
        )
      )
    } catch (err) {
      console.error(err)
    }

    setSaving(false)
    toast.success('Split created')
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">For</label>
        <input
          className="input"
          required
          placeholder="movie tickets, lunch, settlement…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount (₹)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Category</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <p className="rounded-xl bg-brand-50 dark:bg-brand-950/40 px-3 py-2 text-xs text-brand-800 dark:text-brand-200">
        You are recording this split — <strong>you paid</strong> ₹{total > 0 ? total.toFixed(2) : '…'}.
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label !mb-0">Split among</label>
          <div className="flex gap-2 text-xs font-semibold">
            <button type="button" className="text-brand-700 dark:text-brand-300" onClick={selectAll}>
              Select all
            </button>
            <span className="text-slate-300">|</span>
            <button type="button" className="text-slate-500" onClick={clearAll}>
              Clear
            </button>
          </div>
        </div>
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 p-2">
          {members.map((m) => (
            <label
              key={m.user_id}
              className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <input
                type="checkbox"
                checked={participantIds.includes(m.user_id)}
                onChange={() => toggle(m.user_id)}
              />
              <span className="flex-1">{label(m)}{m.user_id === user?.id ? ' (you)' : ''}</span>
              {participantIds.includes(m.user_id) && total > 0 && (
                <span className="text-xs tabular-nums text-slate-500">
                  {formatCurrency(preview.find((p) => p.userId === m.user_id)?.shareAmount || 0)}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create split'}
      </button>
    </form>
  )
}

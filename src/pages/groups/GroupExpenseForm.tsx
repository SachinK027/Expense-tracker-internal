import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { calculateShares } from '@/lib/calculations'
import { syncFrontedPayment } from '@/lib/personalSync'
import { todayISO, formatCurrency, roundMoney } from '@/lib/utils'
import type { GroupMember, SplitType } from '@/types/database'
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
  const [splitType, setSplitType] = useState<SplitType>('equal')
  const [payerIds, setPayerIds] = useState<string[]>(user ? [user.id] : [])
  const [participantIds, setParticipantIds] = useState<string[]>(members.map((m) => m.user_id))
  const [values, setValues] = useState<Record<string, string>>({})
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const total = Number(amount) || 0

  const preview = useMemo(() => {
    const parts = participantIds.map((id) => ({ userId: id, value: Number(values[id] || 0) }))
    return calculateShares(total, splitType, parts)
  }, [total, splitType, participantIds, values])

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!title.trim() || total <= 0) {
      toast.error('Title and amount required')
      return
    }
    if (!payerIds.length || !participantIds.length) {
      toast.error('Select payers and participants')
      return
    }

    let payments: { user_id: string; amount: number }[]
    if (payerIds.length === 1) {
      payments = [{ user_id: payerIds[0], amount: total }]
    } else {
      payments = payerIds.map((id) => ({
        user_id: id,
        amount: roundMoney(Number(payerAmounts[id] || 0)),
      }))
      const paidSum = roundMoney(payments.reduce((s, p) => s + p.amount, 0))
      if (Math.abs(paidSum - total) > 0.05) {
        toast.error(`Payer amounts must sum to ${formatCurrency(total)}`)
        return
      }
    }

    const shares = calculateShares(
      total,
      splitType,
      participantIds.map((id) => ({ userId: id, value: Number(values[id] || (splitType === 'equal' ? 1 : 0)) }))
    )
    if (splitType !== 'equal') {
      const shareSum = roundMoney(shares.reduce((s, x) => s + x.shareAmount, 0))
      if (splitType === 'percentage') {
        const pct = participantIds.reduce((s, id) => s + Number(values[id] || 0), 0)
        if (Math.abs(pct - 100) > 0.1) {
          toast.error('Percentages must sum to 100')
          return
        }
      } else if (splitType === 'exact' && Math.abs(shareSum - total) > 0.05) {
        toast.error(`Shares must sum to ${formatCurrency(total)}`)
        return
      }
    }

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
        split_type: splitType,
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
        share_value: Number(values[s.userId] || null),
      }))
    )
    if (payErr || partErr) {
      setSaving(false)
      toast.error(payErr?.message || partErr?.message || 'Error saving splits')
      return
    }

    // Sync personal expense for whoever fronted cash
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
    toast.success('Split request created')
    onDone()
  }

  const label = (m: GroupMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Requested for (note)</label>
        <input
          className="input"
          required
          placeholder="movie tickets / gathiya / settlement / lunch…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-slate-400">This is just a note — same as GPay “Requested for …”.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount (₹)</label>
          <input type="number" step="0.01" min="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Split type</label>
          <select className="input" value={splitType} onChange={(e) => setSplitType(e.target.value as SplitType)}>
            <option value="equal">Equal</option>
            <option value="exact">Exact amounts</option>
            <option value="percentage">Percentage</option>
            <option value="shares">Shares</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label">Who paid?</label>
        <div className="space-y-2">
          {members.map((m) => (
            <label key={m.user_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={payerIds.includes(m.user_id)}
                onChange={() => toggle(payerIds, m.user_id, setPayerIds)}
              />
              <span className="flex-1">{label(m)}</span>
              {payerIds.length > 1 && payerIds.includes(m.user_id) && (
                <input
                  type="number"
                  step="0.01"
                  className="input !w-28"
                  placeholder="Paid"
                  value={payerAmounts[m.user_id] || ''}
                  onChange={(e) => setPayerAmounts({ ...payerAmounts, [m.user_id]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Split among</label>
        <div className="space-y-2">
          {members.map((m) => (
            <label key={m.user_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={participantIds.includes(m.user_id)}
                onChange={() => toggle(participantIds, m.user_id, setParticipantIds)}
              />
              <span className="flex-1">{label(m)}</span>
              {splitType !== 'equal' && participantIds.includes(m.user_id) && (
                <input
                  type="number"
                  step="0.01"
                  className="input !w-28"
                  placeholder={splitType === 'percentage' ? '%' : splitType === 'shares' ? 'shares' : '₹'}
                  value={values[m.user_id] || ''}
                  onChange={(e) => setValues({ ...values, [m.user_id]: e.target.value })}
                />
              )}
              {splitType === 'equal' && participantIds.includes(m.user_id) && total > 0 && (
                <span className="text-xs text-slate-500 w-24 text-right">
                  {formatCurrency(preview.find((p) => p.userId === m.user_id)?.shareAmount || 0)}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create split'}
      </button>
    </form>
  )
}

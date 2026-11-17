import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { participantRemaining, payerStillOwed } from '@/lib/calculations'
import { syncTransfer } from '@/lib/personalSync'
import { formatCurrency, todayISO, roundMoney } from '@/lib/utils'
import type { GroupExpense, GroupMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  expense: GroupExpense
  members: GroupMember[]
  groupName: string
  onDone: () => void
}

export function MarkPaidForm({ expense, members, groupName, onDone }: Props) {
  const { user } = useAuth()
  const debtors = useMemo(
    () =>
      members
        .map((m) => ({
          member: m,
          left: participantRemaining(expense, m.user_id),
        }))
        .filter((d) => d.left > 0.01),
    [expense, members]
  )
  const creditors = useMemo(
    () =>
      members
        .map((m) => ({
          member: m,
          owed: payerStillOwed(expense, m.user_id),
        }))
        .filter((c) => c.owed > 0.01),
    [expense, members]
  )

  const defaultFrom = debtors[0]?.member.user_id || ''
  const defaultTo = creditors[0]?.member.user_id || ''
  const [fromId, setFromId] = useState(defaultFrom)
  const [toId, setToId] = useState(defaultTo)
  const maxForFrom = debtors.find((d) => d.member.user_id === fromId)?.left || 0
  const [amount, setAmount] = useState(maxForFrom ? String(maxForFrom) : '')
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const label = (m: GroupMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const onFromChange = (id: string) => {
    setFromId(id)
    const left = debtors.find((d) => d.member.user_id === id)?.left || 0
    setAmount(left ? String(left) : '')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const amt = roundMoney(Number(amount))
    if (!fromId || !toId || fromId === toId || amt <= 0) {
      toast.error('Pick payer, receiver and amount')
      return
    }
    if (amt > maxForFrom + 0.05) {
      toast.error(`Max left for this person is ${formatCurrency(maxForFrom)}`)
      return
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('expense_repayments')
      .insert({
        expense_id: expense.id,
        group_id: expense.group_id,
        from_user_id: fromId,
        to_user_id: toId,
        amount: amt,
        payment_date: date,
        notes: notes.trim() || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error || !data) {
      setSaving(false)
      toast.error(error?.message || 'Failed — run migration 003 in Supabase if table missing')
      return
    }

    try {
      await syncTransfer({
        fromUserId: fromId,
        toUserId: toId,
        amount: amt,
        date,
        note: `${groupName}: paid for "${expense.title}"`,
        sourceType: 'group_repayment',
        sourceId: data.id,
      })
    } catch (err) {
      console.error(err)
    }

    setSaving(false)
    toast.success('Marked paid')
    onDone()
  }

  if (!debtors.length) {
    return <p className="text-sm text-slate-500">Everyone on this split is already paid up.</p>
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Mark that a person paid toward <strong>{expense.title}</strong>. This updates this split only
        (and syncs personal expense/income).
      </p>
      <div>
        <label className="label">Who paid (debtor)</label>
        <select className="input" value={fromId} onChange={(e) => onFromChange(e.target.value)}>
          {debtors.map((d) => (
            <option key={d.member.user_id} value={d.member.user_id}>
              {label(d.member)} — left {formatCurrency(d.left)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Paid to (who fronted)</label>
        <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
          {creditors.map((c) => (
            <option key={c.member.user_id} value={c.member.user_id}>
              {label(c.member)} — still owed {formatCurrency(c.owed)}
            </option>
          ))}
          {creditors.length === 0 &&
            members
              .filter((m) => m.user_id !== fromId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {label(m)}
                </option>
              ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount (₹)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={maxForFrom || undefined}
            className="input"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Note</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cash / UPI…" />
      </div>
      <button type="submit" className="btn-primary w-full !rounded-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Mark paid'}
      </button>
    </form>
  )
}

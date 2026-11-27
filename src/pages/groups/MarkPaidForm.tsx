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

  const myLeft = useMemo(
    () => (user ? participantRemaining(expense, user.id) : 0),
    [expense, user]
  )

  const creditors = useMemo(
    () =>
      members
        .map((m) => ({
          member: m,
          owed: payerStillOwed(expense, m.user_id),
        }))
        .filter((c) => c.owed > 0.01 && c.member.user_id !== user?.id),
    [expense, members, user?.id]
  )

  const defaultTo = creditors[0]?.member.user_id || ''
  const [toId, setToId] = useState(defaultTo)
  const [amount, setAmount] = useState(myLeft > 0 ? String(myLeft) : '')
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const label = (m: GroupMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const fromId = user.id
    const amt = roundMoney(Number(amount))
    if (!toId || toId === fromId || amt <= 0) {
      toast.error('Pick who you paid and an amount')
      return
    }
    if (amt > myLeft + 0.05) {
      toast.error(`You only owe ${formatCurrency(myLeft)} on this split`)
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

  if (myLeft <= 0.01) {
    return (
      <p className="text-sm text-slate-500">
        You have nothing left to pay on this split. Only each person can mark their own payment.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        You can only mark <strong>your own</strong> payment toward <strong>{expense.title}</strong>
        {' '}({formatCurrency(myLeft)} left).
      </p>
      <div>
        <label className="label">You are paying</label>
        <input
          className="input"
          disabled
          value={`${members.find((m) => m.user_id === user?.id)?.profiles?.full_name || 'You'} — ${formatCurrency(myLeft)} left`}
        />
      </div>
      <div>
        <label className="label">Paid to (who fronted)</label>
        <select className="input" value={toId} onChange={(e) => setToId(e.target.value)} required>
          {creditors.length === 0 && <option value="">No one still owed</option>}
          {creditors.map((c) => (
            <option key={c.member.user_id} value={c.member.user_id}>
              {label(c.member)} — still owed {formatCurrency(c.owed)}
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
            max={myLeft || undefined}
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
      <button type="submit" className="btn-primary w-full !rounded-full" disabled={saving || !toId}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Mark paid'}
      </button>
    </form>
  )
}

import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { todayISO } from '@/lib/utils'
import type { TiffinMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  groupId: string
  members: TiffinMember[]
  onDone: () => void
}

export function TiffinSettlementForm({ groupId, members, onDone }: Props) {
  const { user } = useAuth()
  const [fromId, setFromId] = useState(user?.id || '')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const label = (m: TiffinMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const amt = Number(amount)
    if (!fromId || !toId || fromId === toId || !amt) {
      toast.error('Invalid settlement')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('tiffin_settlements').insert({
      tiffin_group_id: groupId,
      from_user_id: fromId,
      to_user_id: toId,
      amount: amt,
      settlement_date: date,
      notes: notes.trim() || null,
      created_by: user.id,
    })
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      toast.success('Settlement recorded')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">From</label>
        <select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{label(m)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">To</label>
        <select className="input" value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">Select…</option>
          {members.filter((m) => m.user_id !== fromId).map((m) => (
            <option key={m.user_id} value={m.user_id}>{label(m)}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount</label>
          <input type="number" step="0.01" className="input" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Notes</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Save'}
      </button>
    </form>
  )
}

import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { todayISO, roundMoney, formatCurrency } from '@/lib/utils'
import type { MealType, TiffinGroup, TiffinMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface MemberRow {
  consumed: boolean
  brought: boolean
  paid: boolean
  payAmount: string
  guests: string
}

interface Props {
  group: TiffinGroup
  members: TiffinMember[]
  mealType: MealType
  onDone: () => void
}

export function MealForm({ group, members, mealType, onDone }: Props) {
  const { user } = useAuth()
  const defaultPrice = mealType === 'lunch' ? Number(group.lunch_price) : Number(group.dinner_price)
  const [date, setDate] = useState(todayISO())
  const [totalCost, setTotalCost] = useState(String(defaultPrice * members.length))
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Record<string, MemberRow>>(() => {
    const init: Record<string, MemberRow> = {}
    for (const m of members) {
      init[m.user_id] = {
        consumed: true,
        brought: false,
        paid: false,
        payAmount: '',
        guests: '0',
      }
    }
    return init
  })
  const [saving, setSaving] = useState(false)

  const label = (m: TiffinMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const update = (uid: string, patch: Partial<MemberRow>) => {
    setRows((r) => ({ ...r, [uid]: { ...r[uid], ...patch } }))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const cost = Number(totalCost)
    if (cost < 0) {
      toast.error('Invalid cost')
      return
    }

    const consumers = Object.entries(rows).filter(([, r]) => r.consumed)
    if (consumers.length === 0 && cost > 0) {
      toast.error('Select at least one consumer, or set cost to 0')
      return
    }

    const payers = Object.entries(rows).filter(([, r]) => r.paid)
    let contributions: { user_id: string; amount: number }[] = []
    if (cost > 0) {
      if (payers.length === 0) {
        toast.error('Mark who paid for the meal')
        return
      }
      if (payers.length === 1) {
        contributions = [{ user_id: payers[0][0], amount: cost }]
      } else {
        contributions = payers.map(([uid, r]) => ({
          user_id: uid,
          amount: roundMoney(Number(r.payAmount || 0)),
        }))
        const sum = roundMoney(contributions.reduce((s, c) => s + c.amount, 0))
        if (Math.abs(sum - cost) > 0.05) {
          toast.error(`Payments must sum to ${formatCurrency(cost)}`)
          return
        }
      }
    }

    setSaving(true)
    const { data: meal, error } = await supabase
      .from('tiffin_meals')
      .upsert(
        {
          tiffin_group_id: group.id,
          meal_date: date,
          meal_type: mealType,
          total_cost: cost,
          notes: notes.trim() || null,
          created_by: user.id,
        },
        { onConflict: 'tiffin_group_id,meal_date,meal_type' }
      )
      .select()
      .single()

    if (error || !meal) {
      setSaving(false)
      toast.error(error?.message || 'Could not save meal (maybe duplicate?)')
      return
    }

    // Replace attendance & contributions for this meal
    await supabase.from('tiffin_attendance').delete().eq('meal_id', meal.id)
    await supabase.from('tiffin_contributions').delete().eq('meal_id', meal.id)

    const attendanceRows = members.map((m) => {
      const r = rows[m.user_id]
      return {
        meal_id: meal.id,
        user_id: m.user_id,
        consumed: r.consumed,
        brought_food: r.brought,
        guest_count: Number(r.guests) || 0,
        marked_by: user.id,
      }
    })
    const { error: attErr } = await supabase.from('tiffin_attendance').insert(attendanceRows)
    let contribErr = null
    if (contributions.length) {
      const res = await supabase.from('tiffin_contributions').insert(
        contributions.map((c) => ({ meal_id: meal.id, user_id: c.user_id, amount: c.amount }))
      )
      contribErr = res.error
    }
    setSaving(false)
    if (attErr || contribErr) toast.error(attErr?.message || contribErr?.message || 'Error')
    else {
      toast.success('Meal saved')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Cost is split only among members who consumed the meal (plus guests). Non-consumers are never charged.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Total cost (₹)</label>
          <input type="number" step="0.01" min="0" className="input" required value={totalCost} onChange={(e) => setTotalCost(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/80 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-2 py-2">Ate</th>
              <th className="px-2 py-2">Brought</th>
              <th className="px-2 py-2">Paid</th>
              <th className="px-2 py-2">Guests</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const r = rows[m.user_id]
              return (
                <tr key={m.user_id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 font-medium">{label(m)}</td>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={r.consumed} onChange={(e) => update(m.user_id, { consumed: e.target.checked })} />
                  </td>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={r.brought} onChange={(e) => update(m.user_id, { brought: e.target.checked })} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <input type="checkbox" checked={r.paid} onChange={(e) => update(m.user_id, { paid: e.target.checked })} />
                      {r.paid && Object.values(rows).filter((x) => x.paid).length > 1 && (
                        <input
                          type="number"
                          className="input !w-20 !py-1 !px-2"
                          placeholder="₹"
                          value={r.payAmount}
                          onChange={(e) => update(m.user_id, { payAmount: e.target.value })}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      className="input !w-16 !py-1 !px-2"
                      value={r.guests}
                      onChange={(e) => update(m.user_id, { guests: e.target.value })}
                      disabled={!r.consumed}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <label className="label">Notes</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Save meal'}
      </button>
    </form>
  )
}

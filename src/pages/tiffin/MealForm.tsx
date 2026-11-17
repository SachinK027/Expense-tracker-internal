import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { syncFrontedPayment } from '@/lib/personalSync'
import { todayISO, formatCurrency } from '@/lib/utils'
import type { MealType, TiffinGroup, TiffinMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  group: TiffinGroup
  members: TiffinMember[]
  mealType: MealType
  onDone: () => void
}

export function MealForm({ group, members, mealType, onDone }: Props) {
  const { user } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [type, setType] = useState<MealType>(mealType)
  const [totalCost, setTotalCost] = useState('')
  const [notes, setNotes] = useState('')
  const [consumerIds, setConsumerIds] = useState<string[]>(members.map((m) => m.user_id))
  const [saving, setSaving] = useState(false)

  const cost = Number(totalCost) || 0
  const perHead = useMemo(() => {
    if (!consumerIds.length || cost <= 0) return 0
    return Math.round((cost / consumerIds.length) * 100) / 100
  }, [cost, consumerIds])

  const label = (m: TiffinMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const toggle = (id: string) => {
    setConsumerIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (cost <= 0) {
      toast.error('Enter meal amount')
      return
    }
    if (!consumerIds.length) {
      toast.error('Select who ate')
      return
    }

    setSaving(true)
    const { data: meal, error } = await supabase
      .from('tiffin_meals')
      .upsert(
        {
          tiffin_group_id: group.id,
          meal_date: date,
          meal_type: type,
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
      toast.error(error?.message || 'Could not save (duplicate meal?)')
      return
    }

    await supabase.from('tiffin_attendance').delete().eq('meal_id', meal.id)
    await supabase.from('tiffin_contributions').delete().eq('meal_id', meal.id)

    const attendanceRows = members.map((m) => ({
      meal_id: meal.id,
      user_id: m.user_id,
      consumed: consumerIds.includes(m.user_id),
      brought_food: m.user_id === user.id,
      guest_count: 0,
      marked_by: user.id,
    }))

    const { error: attErr } = await supabase.from('tiffin_attendance').insert(attendanceRows)
    const { data: contrib, error: cErr } = await supabase
      .from('tiffin_contributions')
      .insert({ meal_id: meal.id, user_id: user.id, amount: cost })
      .select('id')
      .single()

    if (attErr || cErr) {
      setSaving(false)
      toast.error(attErr?.message || cErr?.message || 'Error')
      return
    }

    try {
      if (contrib?.id) {
        await syncFrontedPayment({
          userId: user.id,
          amount: cost,
          date,
          groupName: group.name,
          title: `Tiffin ${type}`,
          paymentId: contrib.id,
        })
      }
    } catch (err) {
      console.error(err)
    }

    setSaving(false)
    toast.success(`${type} saved`)
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
        {(['lunch', 'dinner'] as MealType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-lg py-2 text-sm font-semibold capitalize transition ${
              type === t ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'
            }`}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Total amount (₹)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="input"
            required
            placeholder="250"
            value={totalCost}
            onChange={(e) => setTotalCost(e.target.value)}
          />
        </div>
      </div>

      <p className="rounded-xl bg-brand-50 dark:bg-brand-950/40 px-3 py-2 text-xs text-brand-800 dark:text-brand-200">
        You bought &amp; paid this tiffin. Cost splits equally among who ate
        {perHead > 0 ? ` → ${formatCurrency(perHead)} each` : ''}.
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label !mb-0">Who ate?</label>
          <div className="flex gap-2 text-xs font-semibold">
            <button
              type="button"
              className="text-brand-700 dark:text-brand-300"
              onClick={() => setConsumerIds(members.map((m) => m.user_id))}
            >
              Select all
            </button>
            <span className="text-slate-300">|</span>
            <button type="button" className="text-slate-500" onClick={() => setConsumerIds([])}>
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
                checked={consumerIds.includes(m.user_id)}
                onChange={() => toggle(m.user_id)}
              />
              <span className="flex-1">
                {label(m)}
                {m.user_id === user?.id ? ' (you)' : ''}
              </span>
              {consumerIds.includes(m.user_id) && perHead > 0 && (
                <span className="text-xs text-slate-500 tabular-nums">{formatCurrency(perHead)}</span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : `Save ${type}`}
      </button>
    </form>
  )
}

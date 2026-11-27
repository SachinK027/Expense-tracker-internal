import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { syncFrontedPayment } from '@/lib/personalSync'
import { todayISO, formatCurrency, roundMoney } from '@/lib/utils'
import type { MealType, TiffinGroup, TiffinMeal, TiffinMember } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  group: TiffinGroup
  members: TiffinMember[]
  mealType: MealType
  initial?: TiffinMeal | null
  onDone: () => void
}

/** Portions UI = how many tiffins that person ate. Stored as guest_count = portions - 1. */
function initialPortions(initial: TiffinMeal | null | undefined, members: TiffinMember[]) {
  const map: Record<string, number> = {}
  if (initial) {
    for (const a of initial.tiffin_attendance || []) {
      if (a.consumed) map[a.user_id] = Math.max(1, 1 + (a.guest_count || 0))
    }
  } else {
    for (const m of members) map[m.user_id] = 1
  }
  return map
}

export function MealForm({ group, members, mealType, initial, onDone }: Props) {
  const { user } = useAuth()
  const isEdit = Boolean(initial?.id)

  const [date, setDate] = useState(initial?.meal_date || todayISO())
  const [type, setType] = useState<MealType>(initial?.meal_type || mealType)
  const [totalCost, setTotalCost] = useState(initial ? String(initial.total_cost) : '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [portions, setPortions] = useState<Record<string, number>>(() => initialPortions(initial, members))
  const [saving, setSaving] = useState(false)

  const consumerIds = useMemo(
    () => Object.keys(portions).filter((id) => (portions[id] || 0) > 0),
    [portions]
  )

  const cost = Number(totalCost) || 0
  const totalHeads = useMemo(
    () => consumerIds.reduce((s, id) => s + (portions[id] || 0), 0),
    [consumerIds, portions]
  )
  const perPortion = useMemo(() => {
    if (!totalHeads || cost <= 0) return 0
    return roundMoney(cost / totalHeads)
  }, [cost, totalHeads])

  const label = (m: TiffinMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const isSelected = (id: string) => (portions[id] || 0) > 0

  const toggle = (id: string) => {
    setPortions((prev) => {
      if ((prev[id] || 0) > 0) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: 1 }
    })
  }

  const setPortionCount = (id: string, n: number) => {
    const v = Math.max(1, Math.floor(n) || 1)
    setPortions((prev) => ({ ...prev, [id]: v }))
  }

  const selectAll = () => {
    const next: Record<string, number> = {}
    for (const m of members) next[m.user_id] = portions[m.user_id] || 1
    setPortions(next)
  }

  const clearAll = () => setPortions({})

  const buildAttendance = (mealId: string, payerId: string) =>
    members.map((m) => {
      const count = portions[m.user_id] || 0
      return {
        meal_id: mealId,
        user_id: m.user_id,
        consumed: count > 0,
        brought_food: m.user_id === payerId,
        guest_count: count > 0 ? Math.max(0, count - 1) : 0,
        marked_by: user!.id,
      }
    })

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (cost <= 0) {
      toast.error('Enter meal amount')
      return
    }
    if (!consumerIds.length || totalHeads <= 0) {
      toast.error('Select who ate (and portions)')
      return
    }

    setSaving(true)

    if (isEdit && initial) {
      const payerId = initial.tiffin_contributions?.[0]?.user_id || initial.created_by || user.id

      const { error: upErr } = await supabase
        .from('tiffin_meals')
        .update({
          total_cost: cost,
          notes: notes.trim() || null,
        })
        .eq('id', initial.id)

      if (upErr) {
        setSaving(false)
        toast.error(upErr.message)
        return
      }

      await supabase.from('tiffin_attendance').delete().eq('meal_id', initial.id)

      const { error: attErr } = await supabase
        .from('tiffin_attendance')
        .insert(buildAttendance(initial.id, payerId))
      if (attErr) {
        setSaving(false)
        toast.error(attErr.message)
        return
      }

      const existingContrib = initial.tiffin_contributions?.[0]
      let contribId = existingContrib?.id

      if (existingContrib?.id) {
        const { error: cErr } = await supabase
          .from('tiffin_contributions')
          .update({ amount: cost, user_id: payerId })
          .eq('id', existingContrib.id)
        if (cErr) {
          setSaving(false)
          toast.error(cErr.message)
          return
        }
      } else {
        const { data: contrib, error: cErr } = await supabase
          .from('tiffin_contributions')
          .insert({ meal_id: initial.id, user_id: payerId, amount: cost })
          .select('id')
          .single()
        if (cErr) {
          setSaving(false)
          toast.error(cErr.message)
          return
        }
        contribId = contrib?.id
      }

      try {
        if (contribId) {
          await syncFrontedPayment({
            userId: payerId,
            amount: cost,
            date: initial.meal_date,
            groupName: group.name,
            title: `Tiffin ${initial.meal_type}`,
            paymentId: contribId,
          })
        }
      } catch (err) {
        console.error(err)
      }

      setSaving(false)
      toast.success(`${initial.meal_type} updated`)
      onDone()
      return
    }

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

    const { error: attErr } = await supabase
      .from('tiffin_attendance')
      .insert(buildAttendance(meal.id, user.id))
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
      {!isEdit && (
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
      )}

      {isEdit && (
        <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Editing {initial?.meal_type} · {initial?.meal_date}. Date and meal type stay fixed so history stays intact.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            required
            disabled={isEdit}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
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
        Cost splits by portions (e.g. A took 2, B took 1).
        {perPortion > 0 ? ` → ${formatCurrency(perPortion)} per portion · ${totalHeads} total` : ''}
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label !mb-0">Who ate? (portions)</label>
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
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 p-2">
          {members.map((m) => {
            const selected = isSelected(m.user_id)
            const count = portions[m.user_id] || 0
            const theirCost = selected && perPortion > 0 ? roundMoney(perPortion * count) : 0
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <input type="checkbox" checked={selected} onChange={() => toggle(m.user_id)} />
                <span className="flex-1 min-w-0 truncate">
                  {label(m)}
                  {m.user_id === user?.id ? ' (you)' : ''}
                </span>
                {selected && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="h-7 w-7 rounded-lg border border-slate-200 dark:border-slate-600 text-sm font-semibold"
                      onClick={() => setPortionCount(m.user_id, count - 1)}
                      aria-label="Less"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="input !w-12 !py-1 !px-1 !text-center !text-xs"
                      value={count}
                      onChange={(e) => setPortionCount(m.user_id, Number(e.target.value))}
                      aria-label="Portions"
                    />
                    <button
                      type="button"
                      className="h-7 w-7 rounded-lg border border-slate-200 dark:border-slate-600 text-sm font-semibold"
                      onClick={() => setPortionCount(m.user_id, count + 1)}
                      aria-label="More"
                    >
                      +
                    </button>
                  </div>
                )}
                {selected && theirCost > 0 && (
                  <span className="text-xs text-slate-500 tabular-nums w-14 text-right shrink-0">
                    {formatCurrency(theirCost)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? (
          <Spinner className="!border-white/30 !border-t-white" />
        ) : isEdit ? (
          'Save changes'
        ) : (
          `Save ${type}`
        )}
      </button>
    </form>
  )
}

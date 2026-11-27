import { useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { calculateShares } from '@/lib/calculations'
import { syncFrontedPayment } from '@/lib/personalSync'
import { todayISO, formatCurrency, roundMoney } from '@/lib/utils'
import type { GroupExpense, GroupMember, SplitType } from '@/types/database'
import { Spinner } from '@/components/ui/Loading'

const CATEGORIES = ['general', 'food', 'travel', 'rent', 'utilities', 'entertainment', 'other']
const SPLIT_OPTIONS: { id: SplitType; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equal', hint: 'Same amount each' },
  { id: 'percentage', label: '%', hint: 'By percentage' },
  { id: 'shares', label: 'Counts', hint: 'A×2, B×1…' },
]

interface Props {
  groupId: string
  groupName: string
  members: GroupMember[]
  initial?: GroupExpense | null
  onDone: () => void
}

function defaultValues(
  ids: string[],
  splitType: SplitType,
  existing?: GroupExpense | null
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const id of ids) {
    const prev = existing?.expense_participants?.find((p) => p.user_id === id)
    if (prev?.share_value != null) {
      map[id] = String(prev.share_value)
    } else if (splitType === 'percentage') {
      map[id] = String(roundMoney(100 / Math.max(ids.length, 1)))
    } else if (splitType === 'shares') {
      map[id] = '1'
    } else {
      map[id] = ''
    }
  }
  if (splitType === 'percentage' && ids.length) {
    const sum = ids.reduce((s, id) => s + (Number(map[id]) || 0), 0)
    const fix = roundMoney(100 - sum + (Number(map[ids[0]]) || 0))
    map[ids[0]] = String(fix)
  }
  return map
}

export function GroupExpenseForm({ groupId, groupName, members, initial, onDone }: Props) {
  const { user } = useAuth()
  const isEdit = Boolean(initial?.id)
  const hasRepayments = (initial?.expense_repayments || []).length > 0

  const [title, setTitle] = useState(initial?.title || '')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [category, setCategory] = useState(initial?.category || 'general')
  const [date, setDate] = useState(initial?.expense_date || todayISO())
  const [notes, setNotes] = useState(initial?.notes || '')
  const [splitType, setSplitType] = useState<SplitType>(
    initial?.split_type === 'exact' ? 'equal' : initial?.split_type || 'equal'
  )
  const [participantIds, setParticipantIds] = useState<string[]>(
    initial?.expense_participants?.map((p) => p.user_id) || members.map((m) => m.user_id)
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    defaultValues(
      initial?.expense_participants?.map((p) => p.user_id) || members.map((m) => m.user_id),
      initial?.split_type === 'exact' ? 'equal' : initial?.split_type || 'equal',
      initial
    )
  )
  const [saving, setSaving] = useState(false)

  const total = Number(amount) || 0

  const participantInputs = useMemo(
    () =>
      participantIds.map((id) => ({
        userId: id,
        value: splitType === 'equal' ? undefined : Number(values[id]) || 0,
      })),
    [participantIds, splitType, values]
  )

  const preview = useMemo(
    () => calculateShares(total, splitType === 'exact' ? 'equal' : splitType, participantInputs),
    [total, splitType, participantInputs]
  )

  const pctSum = useMemo(
    () => participantIds.reduce((s, id) => s + (Number(values[id]) || 0), 0),
    [participantIds, values]
  )
  const shareSum = useMemo(
    () => participantIds.reduce((s, id) => s + (Number(values[id]) || 0), 0),
    [participantIds, values]
  )

  const applySplitType = (next: SplitType) => {
    if (hasRepayments) return
    setSplitType(next)
    setValues(defaultValues(participantIds, next, null))
  }

  const toggle = (id: string) => {
    if (hasRepayments) return
    setParticipantIds((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
      setValues((prev) => {
        if (list.includes(id)) {
          const copy = { ...prev }
          delete copy[id]
          return defaultValues(next, splitType, null)
        }
        return {
          ...defaultValues(next, splitType, null),
          ...prev,
          [id]:
            prev[id] ||
            (splitType === 'shares' ? '1' : splitType === 'percentage' ? String(roundMoney(100 / Math.max(next.length, 1))) : ''),
        }
      })
      return next
    })
  }

  const selectAll = () => {
    if (hasRepayments) return
    const ids = members.map((m) => m.user_id)
    setParticipantIds(ids)
    setValues(defaultValues(ids, splitType, null))
  }
  const clearAll = () => {
    if (hasRepayments) return
    setParticipantIds([])
    setValues({})
  }

  const setValue = (id: string, v: string) => {
    if (hasRepayments) return
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  const label = (m: GroupMember) => m.profiles?.full_name || m.profiles?.email || 'Member'

  const validateSplit = () => {
    if (!participantIds.length) {
      toast.error('Select who shares this split')
      return false
    }
    if (splitType === 'percentage') {
      if (Math.abs(pctSum - 100) > 0.05) {
        toast.error(`Percentages must add to 100% (now ${pctSum.toFixed(1)}%)`)
        return false
      }
      if (participantIds.some((id) => (Number(values[id]) || 0) < 0)) {
        toast.error('Percentages cannot be negative')
        return false
      }
    }
    if (splitType === 'shares') {
      if (shareSum <= 0 || participantIds.some((id) => (Number(values[id]) || 0) <= 0)) {
        toast.error('Each person needs at least 1 count/share')
        return false
      }
    }
    return true
  }

  const buildShares = () =>
    calculateShares(
      total,
      splitType === 'exact' ? 'equal' : splitType,
      participantIds.map((id) => ({
        userId: id,
        value: splitType === 'equal' ? undefined : Number(values[id]) || 0,
      }))
    )

  const shareValueFor = (userId: string) => {
    if (splitType === 'equal') return null
    return Number(values[userId]) || 0
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!title.trim() || total <= 0) {
      toast.error('Title and amount required')
      return
    }
    if (!hasRepayments && !validateSplit()) return

    setSaving(true)

    if (isEdit && initial) {
      const meta = {
        title: title.trim(),
        category,
        expense_date: date,
        notes: notes.trim() || null,
      }

      if (hasRepayments) {
        const { error } = await supabase.from('group_expenses').update(meta).eq('id', initial.id)
        setSaving(false)
        if (error) toast.error(error.message)
        else {
          toast.success('Split updated (amount locked — payments already marked)')
          onDone()
        }
        return
      }

      const shares = buildShares()
      const payerId = initial.expense_payments?.[0]?.user_id || initial.created_by || user.id

      const { error: upErr } = await supabase
        .from('group_expenses')
        .update({ ...meta, amount: total, split_type: splitType })
        .eq('id', initial.id)
      if (upErr) {
        setSaving(false)
        toast.error(upErr.message)
        return
      }

      await supabase.from('expense_participants').delete().eq('expense_id', initial.id)
      await supabase.from('expense_payments').delete().eq('expense_id', initial.id)

      const { data: payRows, error: payErr } = await supabase
        .from('expense_payments')
        .insert([{ expense_id: initial.id, user_id: payerId, amount: total }])
        .select('id, user_id, amount')

      const { error: partErr } = await supabase.from('expense_participants').insert(
        shares.map((s) => ({
          expense_id: initial.id,
          user_id: s.userId,
          share_amount: s.shareAmount,
          share_value: shareValueFor(s.userId),
        }))
      )

      if (payErr || partErr) {
        setSaving(false)
        toast.error(payErr?.message || partErr?.message || 'Error updating splits')
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
      toast.success('Split updated')
      onDone()
      return
    }

    const shares = buildShares()

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
      .insert([{ expense_id: exp.id, user_id: user.id, amount: total }])
      .select('id, user_id, amount')

    const { error: partErr } = await supabase.from('expense_participants').insert(
      shares.map((s) => ({
        expense_id: exp.id,
        user_id: s.userId,
        share_amount: s.shareAmount,
        share_value: shareValueFor(s.userId),
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
            disabled={hasRepayments}
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

      {!isEdit && (
        <p className="rounded-xl bg-brand-50 dark:bg-brand-950/40 px-3 py-2 text-xs text-brand-800 dark:text-brand-200">
          You are recording this split — <strong>you paid</strong> ₹{total > 0 ? total.toFixed(2) : '…'}.
        </p>
      )}
      {hasRepayments && (
        <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Some people already marked paid — amount and members are locked. You can still edit title, date, notes.
        </p>
      )}

      <div>
        <label className="label">Split method</label>
        <div className="grid grid-cols-3 gap-2">
          {SPLIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={hasRepayments}
              onClick={() => applySplitType(opt.id)}
              className={`rounded-2xl border px-2 py-2.5 text-center transition ${
                splitType === opt.id
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-brand-800 dark:text-brand-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="block text-sm font-semibold">{opt.label}</span>
              <span className="block text-[10px] opacity-70 mt-0.5">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label !mb-0">Split among</label>
          {!hasRepayments && (
            <div className="flex gap-2 text-xs font-semibold">
              <button type="button" className="text-brand-700 dark:text-brand-300" onClick={selectAll}>
                Select all
              </button>
              <span className="text-slate-300">|</span>
              <button type="button" className="text-slate-500" onClick={clearAll}>
                Clear
              </button>
            </div>
          )}
        </div>
        {splitType === 'percentage' && (
          <p className={`mb-2 text-xs ${Math.abs(pctSum - 100) < 0.05 ? 'text-emerald-600' : 'text-amber-600'}`}>
            Total {pctSum.toFixed(1)}% {Math.abs(pctSum - 100) < 0.05 ? '✓' : '(need 100%)'}
          </p>
        )}
        {splitType === 'shares' && (
          <p className="mb-2 text-xs text-slate-500">
            Total counts: {shareSum || 0}
            {shareSum > 0 && total > 0 ? ` · ${formatCurrency(roundMoney(total / shareSum))} per count` : ''}
          </p>
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 p-2">
          {members.map((m) => {
            const selected = participantIds.includes(m.user_id)
            const shareAmt = preview.find((p) => p.userId === m.user_id)?.shareAmount || 0
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={hasRepayments}
                  onChange={() => toggle(m.user_id)}
                />
                <span className="flex-1 min-w-0 truncate">
                  {label(m)}
                  {m.user_id === user?.id ? ' (you)' : ''}
                </span>
                {selected && splitType !== 'equal' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={splitType === 'shares' ? 1 : 0}
                      step={splitType === 'percentage' ? 0.1 : 1}
                      disabled={hasRepayments}
                      className="input !w-16 !py-1 !px-2 !text-xs"
                      value={values[m.user_id] ?? ''}
                      onChange={(e) => setValue(m.user_id, e.target.value)}
                      aria-label={splitType === 'percentage' ? 'Percent' : 'Counts'}
                    />
                    <span className="text-[10px] text-slate-400 w-4">
                      {splitType === 'percentage' ? '%' : '×'}
                    </span>
                  </div>
                )}
                {selected && total > 0 && (
                  <span className="text-xs tabular-nums text-slate-500 w-16 text-right shrink-0">
                    {formatCurrency(shareAmt)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : isEdit ? 'Save changes' : 'Create split'}
      </button>
    </form>
  )
}

import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/Loading'

export function CreateTiffinForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { data, error } = await supabase
      .from('tiffin_groups')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        lunch_price: 0,
        dinner_price: 0,
        track_lunch: true,
        track_dinner: true,
        pricing_mode: 'custom',
        created_by: user.id,
      })
      .select()
      .single()
    if (error || !data) {
      setSaving(false)
      toast.error(error?.message || 'Failed')
      return
    }
    const { error: memErr } = await supabase.from('tiffin_members').insert({
      tiffin_group_id: data.id,
      user_id: user.id,
      role: 'admin',
    })
    setSaving(false)
    if (memErr) toast.error(memErr.message)
    else {
      toast.success('Tiffin group created')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Group name</label>
        <input
          className="input"
          required
          placeholder="Room / PG / Flat"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Description (optional)</label>
        <textarea
          className="input min-h-[70px]"
          placeholder="Daily lunch & dinner"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <p className="text-xs text-slate-500">
        No fixed prices needed — enter the amount when you record each meal.
      </p>
      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create group'}
      </button>
    </form>
  )
}

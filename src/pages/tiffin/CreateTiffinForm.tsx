import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/Loading'

export function CreateTiffinForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [lunchPrice, setLunchPrice] = useState('50')
  const [dinnerPrice, setDinnerPrice] = useState('50')
  const [trackLunch, setTrackLunch] = useState(true)
  const [trackDinner, setTrackDinner] = useState(true)
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
        lunch_price: Number(lunchPrice) || 50,
        dinner_price: Number(dinnerPrice) || 50,
        track_lunch: trackLunch,
        track_dinner: trackDinner,
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
        <label className="label">Name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[70px]" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Lunch price (₹)</label>
          <input type="number" className="input" value={lunchPrice} onChange={(e) => setLunchPrice(e.target.value)} />
        </div>
        <div>
          <label className="label">Dinner price (₹)</label>
          <input type="number" className="input" value={dinnerPrice} onChange={(e) => setDinnerPrice(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={trackLunch} onChange={(e) => setTrackLunch(e.target.checked)} /> Lunch
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={trackDinner} onChange={(e) => setTrackDinner(e.target.checked)} /> Dinner
        </label>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create'}
      </button>
    </form>
  )
}

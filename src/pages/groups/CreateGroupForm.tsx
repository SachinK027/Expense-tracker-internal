import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/Loading'

export function CreateGroupForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { data, error } = await supabase
      .from('expense_groups')
      .insert({ name: name.trim(), description: description.trim() || null, created_by: user.id })
      .select()
      .single()
    if (error || !data) {
      setSaving(false)
      toast.error(error?.message || 'Failed')
      return
    }
    const { error: memErr } = await supabase.from('group_members').insert({
      group_id: data.id,
      user_id: user.id,
      role: 'admin',
    })
    setSaving(false)
    if (memErr) toast.error(memErr.message)
    else {
      toast.success('Group created')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Group name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Create'}
      </button>
    </form>
  )
}

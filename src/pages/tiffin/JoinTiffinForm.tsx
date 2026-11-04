import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/Loading'

export function JoinTiffinForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { data: group } = await supabase
      .from('tiffin_groups')
      .select('id')
      .eq('invite_code', code.trim().toLowerCase())
      .maybeSingle()
    if (!group) {
      setSaving(false)
      toast.error('Invalid invite code')
      return
    }
    const { error } = await supabase.from('tiffin_members').upsert(
      {
        tiffin_group_id: group.id,
        user_id: user.id,
        role: 'member',
        is_active: true,
        left_at: null,
      },
      { onConflict: 'tiffin_group_id,user_id' }
    )
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      toast.success('Joined tiffin group')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Invite code</label>
        <input className="input font-mono" required value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Join'}
      </button>
    </form>
  )
}

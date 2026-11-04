import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/Loading'

export function JoinGroupForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { data: group, error } = await supabase
      .from('expense_groups')
      .select('id')
      .eq('invite_code', code.trim().toLowerCase())
      .maybeSingle()
    if (error || !group) {
      setSaving(false)
      toast.error('Invalid invite code')
      return
    }
    const { error: joinErr } = await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
      role: 'member',
    })
    setSaving(false)
    if (joinErr) {
      if (joinErr.code === '23505') toast.error('You are already a member')
      else toast.error(joinErr.message)
    } else {
      toast.success('Joined group')
      onDone()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Invite code</label>
        <input className="input font-mono uppercase" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc123…" />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Join group'}
      </button>
    </form>
  )
}

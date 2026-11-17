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
    const invite = code.trim().toLowerCase()
    if (!invite) {
      toast.error('Enter invite code')
      return
    }

    setSaving(true)
    const { data: group, error: lookupErr } = await supabase
      .from('tiffin_groups')
      .select('id, name')
      .eq('invite_code', invite)
      .maybeSingle()

    if (lookupErr) {
      setSaving(false)
      toast.error(lookupErr.message)
      return
    }
    if (!group) {
      setSaving(false)
      toast.error('Invalid invite code')
      return
    }

    // Prefer insert (new join). If already a member, treat as success.
    const { error: insertErr } = await supabase.from('tiffin_members').insert({
      tiffin_group_id: group.id,
      user_id: user.id,
      role: 'member',
      is_active: true,
      left_at: null,
    })

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Already joined — reactivate if needed
        const { error: updErr } = await supabase
          .from('tiffin_members')
          .update({ is_active: true, left_at: null })
          .eq('tiffin_group_id', group.id)
          .eq('user_id', user.id)
        setSaving(false)
        if (updErr) toast.error(updErr.message)
        else {
          toast.success(`Already in ${group.name}`)
          onDone()
        }
        return
      }
      setSaving(false)
      toast.error(insertErr.message)
      return
    }

    setSaving(false)
    toast.success(`Joined ${group.name}`)
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Invite code</label>
        <input
          className="input font-mono"
          required
          placeholder="Paste group code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary w-full !rounded-2xl" disabled={saving}>
        {saving ? <Spinner className="!border-white/30 !border-t-white" /> : 'Join'}
      </button>
    </form>
  )
}

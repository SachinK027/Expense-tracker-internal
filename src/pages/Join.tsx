import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageLoader } from '@/components/ui/Loading'

export function Join() {
  const { type, code } = useParams<{ type: string; code: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) {
      navigate(`/login?redirect=/join/${type}/${code}`)
      return
    }
    if (!code || !type) return

    const run = async () => {
      setWorking(true)
      if (type === 'group') {
        const { data: group } = await supabase.from('expense_groups').select('id').eq('invite_code', code).maybeSingle()
        if (!group) {
          toast.error('Invalid group invite')
          navigate('/groups')
          return
        }
        const { error } = await supabase.from('group_members').insert({
          group_id: group.id,
          user_id: user.id,
          role: 'member',
        })
        if (error && error.code !== '23505') toast.error(error.message)
        else toast.success('Joined group')
        navigate(`/groups/${group.id}`)
      } else if (type === 'tiffin') {
        const invite = code.trim().toLowerCase()
        const { data: group } = await supabase
          .from('tiffin_groups')
          .select('id')
          .eq('invite_code', invite)
          .maybeSingle()
        if (!group) {
          toast.error('Invalid tiffin invite')
          navigate('/tiffin')
          return
        }
        const { error } = await supabase.from('tiffin_members').insert({
          tiffin_group_id: group.id,
          user_id: user.id,
          role: 'member',
          is_active: true,
          left_at: null,
        })
        if (error && error.code === '23505') {
          await supabase
            .from('tiffin_members')
            .update({ is_active: true, left_at: null })
            .eq('tiffin_group_id', group.id)
            .eq('user_id', user.id)
          toast.success('Already a member')
        } else if (error) {
          toast.error(error.message)
          navigate('/tiffin')
          return
        } else {
          toast.success('Joined tiffin group')
        }
        navigate(`/tiffin/${group.id}`)
      } else {
        navigate('/')
      }
      setWorking(false)
    }
    run()
  }, [user, loading, code, type, navigate])

  if (loading || working) return <PageLoader />
  return <PageLoader />
}

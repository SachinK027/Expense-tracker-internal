import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate } from '@/lib/utils'
import type { Notification } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/Loading'

export function Notifications() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setItems((data as Notification[]) || [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, load])

  const markAllRead = async () => {
    if (!user) return
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    if (error) toast.error(error.message)
    else {
      toast.success('Marked as read')
      load()
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Invites, settlements and reminders</p>
        </div>
        {items.some((n) => !n.is_read) && (
          <button type="button" className="btn-secondary" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up" />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((n) => (
              <div key={n.id} className={`px-5 py-4 ${n.is_read ? '' : 'bg-brand-50/40 dark:bg-brand-950/20'}`}>
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>
                  </div>
                  <p className="text-xs text-slate-400 whitespace-nowrap">{formatDate(n.created_at, 'dd MMM · HH:mm')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

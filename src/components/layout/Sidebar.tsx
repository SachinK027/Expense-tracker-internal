import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Wallet,
  Users,
  UtensilsCrossed,
  BarChart3,
  Bell,
  Settings,
  X,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar } from '@/components/ui/Avatar'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/expenses', icon: Wallet, label: 'My Expenses' },
  { to: '/groups', icon: Users, label: 'Group Expenses' },
  { to: '/tiffin', icon: UtensilsCrossed, label: 'Tiffin Manager' },
  { to: '/reports', icon: BarChart3, label: 'Reports & Analytics' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/settings', icon: Settings, label: 'Profile & Settings' },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { profile, signOut } = useAuth()

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 dark:border-slate-800',
          'bg-white dark:bg-surface-dark transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white font-display font-bold">
              H
            </div>
            <div>
              <p className="font-display text-lg font-semibold leading-none">Hisaab</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Finance & splits</p>
            </div>
          </div>
          <button type="button" className="btn-ghost !p-2 lg:hidden" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 dark:border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={profile?.full_name} email={profile?.email} url={profile?.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile?.full_name || 'User'}</p>
              <p className="truncate text-xs text-slate-500">{profile?.email}</p>
            </div>
            <button type="button" className="btn-ghost !p-2" title="Sign out" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

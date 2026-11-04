import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, Moon, Sun } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { useTheme } from '@/contexts/ThemeContext'

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const { resolved, setTheme } = useTheme()

  return (
    <div className="flex min-h-screen bg-surface-muted dark:bg-surface-dark">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-surface-dark/80 backdrop-blur px-4 lg:px-6">
          <button type="button" className="btn-ghost !p-2 lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            className="btn-ghost !p-2"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
          >
            {resolved === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

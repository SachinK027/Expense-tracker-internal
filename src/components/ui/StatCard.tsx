import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  trend?: string
  tone?: 'default' | 'positive' | 'negative' | 'warning'
}

const tones = {
  default: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  positive: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  negative: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

export function StatCard({ label, value, icon: Icon, trend, tone = 'default' }: StatCardProps) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1.5 font-display text-xl sm:text-2xl font-semibold tabular-nums">{value}</p>
          {trend && <p className="mt-1 text-xs text-slate-500">{trend}</p>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

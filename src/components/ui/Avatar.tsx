import { initials, cn } from '@/lib/utils'

interface AvatarProps {
  name?: string | null
  email?: string
  url?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' }

export function Avatar({ name, email, url, size = 'md', className }: AvatarProps) {
  if (url) {
    return <img src={url} alt={name || ''} className={cn('rounded-full object-cover', sizes[size], className)} />
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-brand-100 text-brand-800 font-semibold dark:bg-brand-900 dark:text-brand-200',
        sizes[size],
        className
      )}
    >
      {initials(name, email)}
    </div>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, FileText, MessageSquare, LogOut, Shield, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { errorMessage, type User } from '@/lib/api'
import { removeToken } from '@/lib/auth'
import { cn } from '@/lib/utils'

export default function Sidebar({ user }: { user: User }) {
  const pathname = usePathname()
  const router = useRouter()
  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/patients', label: user.role === 'patient' ? 'My locker' : 'Patients', icon: Users },
    { href: '/queries', label: 'Query letters', icon: FileText },
    { href: '/messages', label: 'Message history', icon: MessageSquare },
    ...(user.role === 'admin' ? [{ href: '/admin', label: 'Accounts & access', icon: Shield }] : []),
    { href: '/settings', label: 'My account', icon: Settings },
  ]
  const logout = async () => {
    try { await api.post('/api/auth/logout') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { removeToken(); router.replace('/login') }
  }
  return <aside className="flex flex-col bg-slate-950 text-white md:fixed md:inset-y-0 md:left-0 md:w-64">
    <Link href="/dashboard" className="flex items-center gap-3 border-b border-slate-800 px-6 py-5"><Shield className="text-brand-300" /><div>
      <div className="font-bold">Patient Locker</div><div className="text-xs text-slate-400">Claims & query response</div></div></Link>
    <nav aria-label="Main navigation" className="flex flex-wrap gap-1 p-3 md:flex-1 md:flex-col">{nav.map(item =>
      <Link key={item.href} href={item.href} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
        pathname.startsWith(item.href) ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white')}>
        <item.icon size={18} />{item.label}</Link>)}</nav>
    <div className="border-t border-slate-800 p-4"><p className="truncate text-sm font-medium">{user.name}</p>
      <p className="mb-3 text-xs capitalize text-slate-400">{user.role}</p><button onClick={logout} className="flex items-center gap-2 text-sm text-slate-300 hover:text-white"><LogOut size={16} /> Sign out</button></div>
  </aside>
}

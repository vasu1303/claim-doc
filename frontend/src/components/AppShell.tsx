'use client'
import { createContext, useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { getToken } from '@/lib/auth'
import { useResource } from '@/lib/hooks'
import type { User } from '@/lib/api'
import { ErrorBox, Loading } from './Portal'

const SessionContext = createContext<User | null>(null)
export function useSession() { return useContext(SessionContext) }
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const session = useResource<User>('/api/auth/me')
  useEffect(() => {
    const expired = () => router.replace('/login')
    if (!getToken()) expired()
    window.addEventListener('locker-session-expired', expired)
    return () => window.removeEventListener('locker-session-expired', expired)
  }, [router])
  if (session.loading) return <Loading />
  if (!session.data) return <div className="mx-auto max-w-lg p-8"><ErrorBox message={session.error} retry={session.refresh} /></div>
  return <SessionContext.Provider value={session.data}><div className="min-h-screen bg-slate-50">
    <Sidebar user={session.data} />
    <main className="p-5 md:ml-64 md:p-8"><div className="mx-auto max-w-6xl">
      <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-900">
        Synthetic-data assignment environment. Real patient data is not authorized for external processing.
        Delivery and analysis modes are shown on the dashboard.
      </div>
      {children}
    </div></main>
  </div></SessionContext.Provider>
}

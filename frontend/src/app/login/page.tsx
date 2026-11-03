'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'
import api, { errorMessage, type User } from '@/lib/api'
import { setToken } from '@/lib/auth'
import { ErrorBox, Field } from '@/components/Portal'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { data } = await api.post<{ token: string; user: User }>('/api/auth/login', { email, password })
      setToken(data.token); router.replace('/dashboard')
    } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5">
    <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
      <Shield size={38} className="mb-5 text-brand-600" /><h1 className="text-2xl font-bold">Your documents. One locker.</h1>
      <p className="mb-7 mt-2 text-sm text-slate-500">Sign in to Patient Locker to manage claims, documents, and insurer requests.</p>
      <ErrorBox message={error} />
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email address" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128} />
        <button className="btn w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-xs leading-relaxed text-slate-400">Accounts are provisioned by an administrator. For the initial local admin account, use the credentials generated in the root environment file. This demo uses synthetic patient data only.</p>
    </div>
  </main>
}

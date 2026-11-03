'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { ErrorBox, Field, PageHeader } from '@/components/Portal'
import api, { errorMessage } from '@/lib/api'
import { removeToken } from '@/lib/auth'
import toast from 'react-hot-toast'
export default function SettingsPage() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('')
    if (password !== confirm) { setError('New passwords do not match.'); return }
    setBusy(true)
    try { await api.post('/api/auth/password', { current_password: current, password }); removeToken(); toast.success('Password changed. Sign in again.'); router.replace('/login') }
    catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <AppShell><PageHeader title="My account" description="Change your password. This signs out all of your existing sessions." /><form className="card max-w-lg space-y-4" onSubmit={save}>
    <ErrorBox message={error} /><Field label="Current password" type="password" autoComplete="current-password" value={current} required onChange={e => setCurrent(e.target.value)} />
    <Field label="New password (at least 12 characters)" type="password" autoComplete="new-password" value={password} minLength={12} maxLength={128} required onChange={e => setPassword(e.target.value)} />
    <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} required onChange={e => setConfirm(e.target.value)} />
    <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
  </form></AppShell>
}

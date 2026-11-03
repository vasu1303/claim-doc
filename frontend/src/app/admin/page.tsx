'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'
import AppShell, { useSession } from '@/components/AppShell'
import { ErrorBox, Field, Loading, PageHeader } from '@/components/Portal'
import api, { errorMessage, type User, type Patient } from '@/lib/api'
import { useResource } from '@/lib/hooks'
import { formatDateTime } from '@/lib/utils'

interface AuditEvent { id: string; action: string; created_at: string; user_name: string; patient_id?: string }
function PasswordReset({ user, refreshed }: { user: User; refreshed: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  async function reset(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api.patch(`/api/users/${user.id}`, { password }); setPassword(''); await refreshed(); toast.success('Password reset. Existing sessions were revoked.') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <details className="text-sm"><summary className="cursor-pointer text-brand-700">Reset password</summary><form onSubmit={reset} className="mt-3 flex flex-wrap items-end gap-2">
    <Field label={`New password for ${user.name}`} type="password" autoComplete="new-password" value={password} minLength={12} maxLength={128} required onChange={e => setPassword(e.target.value)} />
    <button className="btn-secondary" disabled={busy}>{busy ? 'Resetting…' : 'Set password'}</button>
  </form></details>
}

function Accounts() {
  const users = useResource<User[]>('/api/users')
  const patients = useResource<{ patients: Patient[] }>('/api/patients?limit=100')
  const audit = useResource<AuditEvent[]>('/api/users/audit', 10000)
  const blank = { name: '', email: '', password: '', role: 'staff', patient_id: '' }
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const session = useSession()
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api.post('/api/users', { ...form, patient_id: form.role === 'patient' ? form.patient_id : null }); setForm(blank); await users.refresh(); toast.success('Account created. Share credentials securely.') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  async function toggle(user: User) {
    try { await api.patch(`/api/users/${user.id}`, { active: !user.active }); await users.refresh(); toast.success('Account access updated') }
    catch (e) { toast.error(errorMessage(e)) }
  }
  return <>
    <PageHeader title="Accounts & access" description="Provision staff and patient logins. Patient accounts can see only their linked locker; staff need explicit assignments." />
    <ErrorBox message={users.error || patients.error} />
    <form className="card mb-6" onSubmit={create}><h2 className="mb-4 font-semibold">Create account</h2><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" value={form.name} required onChange={e => setForm({ ...form, name: e.target.value })} />
      <Field label="Login email" type="email" autoComplete="off" value={form.email} required onChange={e => setForm({ ...form, email: e.target.value })} />
      <Field label="Initial password (at least 12 characters)" type="password" autoComplete="new-password" value={form.password} minLength={12} maxLength={128} required onChange={e => setForm({ ...form, password: e.target.value })} />
      <label className="text-sm font-medium">Role<select className="input mt-1" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="staff">Staff</option><option value="patient">Patient</option><option value="admin">Administrator</option></select></label>
      {form.role === 'patient' && <label className="text-sm font-medium">Linked patient locker<select className="input mt-1" value={form.patient_id} required onChange={e => setForm({ ...form, patient_id: e.target.value })}>
        <option value="">Select a locker</option>{patients.data?.patients.map(p => <option key={p.id} value={p.id}>{p.patient_id} · {p.name}</option>)}</select></label>}
    </div><button className="btn mt-5" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></form>
    {users.loading ? <Loading /> : <div className="space-y-3">{users.data?.map(user => <div className="card flex flex-wrap items-center justify-between gap-3" key={user.id}>
      <div><p className="font-semibold">{user.name} <span className="text-xs font-normal capitalize text-slate-500">· {user.role} · {user.active ? 'active' : 'disabled'}</span></p>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>{user.patient_id && <p className="mt-1 text-xs text-slate-400">Locker: {patients.data?.patients.find(p => p.id === user.patient_id)?.patient_id || user.patient_id}</p>}</div>
      {user.id !== session?.id && <div className="flex flex-wrap items-center gap-4"><PasswordReset user={user} refreshed={users.refresh} /><button className="btn-secondary" onClick={() => toggle(user)}>{user.active ? 'Disable access' : 'Enable access'}</button></div>}
    </div>)}</div>}
    <p className="mt-5 text-sm text-slate-500">Assign staff from the patient locker&apos;s Overview tab. Disabling an account immediately invalidates its sessions. Patients and staff can change their own passwords under My account.</p>
    <h2 className="mb-3 mt-8 text-lg font-semibold">Recent access & change audit</h2><ErrorBox message={audit.error} />
    <div className="card overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Time', 'Account', 'Action', 'Patient'].map(h => <th className="pb-3 pr-4 text-slate-400" key={h}>{h}</th>)}</tr></thead>
      <tbody>{audit.data?.map(a => <tr key={a.id} className="border-t"><td className="py-2 pr-4">{formatDateTime(a.created_at)}</td><td className="pr-4">{a.user_name}</td><td className="pr-4">{a.action.replace(/_/g, ' ')}</td><td>{a.patient_id || '—'}</td></tr>)}</tbody></table></div>
  </>
}
function AdminContent() { const user = useSession(); return user?.role === 'admin' ? <Accounts /> : <ErrorBox message="Administrator access required." /> }
export default function AdminPage() { return <AppShell><AdminContent /></AppShell> }

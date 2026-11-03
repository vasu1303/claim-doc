'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell, { useSession } from '@/components/AppShell'
import { Empty, ErrorBox, Field, Loading, PageHeader, Pagination, Status } from '@/components/Portal'
import { useResource } from '@/lib/hooks'
import api, { errorMessage, type Patient } from '@/lib/api'
import toast from 'react-hot-toast'

function Patients() {
  const user = useSession()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const blank = { patient_id: '', name: '', phone: '', email: '', dob: '', gender: '', policy_number: '', insurer_name: '', notes: '', is_synthetic: true }
  const [form, setForm] = useState(blank)
  const resource = useResource<{ patients: Patient[]; total: number }>(`/api/patients?search=${encodeURIComponent(debounced)}&status=${status}&page=${page}`)
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1) }, 300); return () => clearTimeout(timer) }, [search])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try { await api.post('/api/patients', form); setShowAdd(false); setForm(blank); await resource.refresh(); toast.success('Patient locker created') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <>
    <PageHeader title={user?.role === 'patient' ? 'My patient locker' : 'Patient lockers'} description="Private documents, insurer requests, and notification history.">
      {user?.role !== 'patient' && <button className="btn" onClick={() => setShowAdd(true)}>+ Add patient</button>}
    </PageHeader>
    <div className="mb-5 flex flex-wrap gap-3"><input className="input flex-1" aria-label="Search patients" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, patient ID, or email" />
      <select className="input w-auto" aria-label="Filter by claim status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
        <option value="">All statuses</option>{['pending', 'processing', 'awaiting_documents', 'completed'].map(s => <option key={s}>{s}</option>)}</select></div>
    <ErrorBox message={resource.error} retry={resource.refresh} />
    {resource.loading ? <Loading /> : resource.data && <>
      {!resource.data.patients.length ? <Empty>No accessible patients match your search. Staff accounts see only assigned lockers.</Empty> :
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr>{['Patient', 'Insurer', 'Documents', 'Queries', 'Status', ''].map((h, i) => <th className="px-5 py-4" key={i}>{h}</th>)}</tr></thead>
          <tbody>{resource.data.patients.map(p => <tr key={p.id} className="border-t hover:bg-slate-50">
            <td className="px-5 py-4"><Link className="font-semibold text-brand-700" href={`/patients/${p.id}`}>{p.name}</Link><p className="mt-1 text-xs text-slate-400">{p.patient_id}{p.is_synthetic ? ' · synthetic' : ''}</p></td>
            <td className="px-5 py-4">{p.insurer_name || '—'}</td><td className="px-5 py-4">{p.doc_count}</td><td className="px-5 py-4">{p.query_count}</td>
            <td className="px-5 py-4"><Status value={p.claim_status} /></td><td className="px-5 py-4"><Link href={`/patients/${p.id}`} className="text-brand-700">Open →</Link></td>
          </tr>)}</tbody></table></div>}
      <Pagination page={page} total={resource.data.total} size={20} onChange={setPage} />
    </>}
    {showAdd && <div role="dialog" aria-modal="true" aria-label="Create patient locker" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <form onSubmit={add} className="my-auto w-full max-w-2xl rounded-2xl bg-white p-6">
        <div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">Create patient locker</h2><button type="button" aria-label="Close dialog" onClick={() => setShowAdd(false)}>✕</button></div>
        <div className="grid gap-4 sm:grid-cols-2">{([
          ['patient_id', 'Patient ID', 'text'], ['name', 'Full name', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone with country code', 'tel'],
          ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'text'], ['policy_number', 'Policy number', 'text'], ['insurer_name', 'Insurer', 'text'],
        ] as const).map(([key, label, type]) => <Field key={key} label={label} type={type} required={key === 'name' || key === 'patient_id'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}</div>
        <p className="my-4 rounded-lg bg-sky-50 p-3 text-xs text-sky-900">Create fictional patient profiles only in this assignment environment. Patient login accounts are created separately by an administrator.</p>
        <div className="flex justify-end gap-3"><button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create locker'}</button></div>
      </form>
    </div>}
  </>
}
export default function PatientsPage() { return <AppShell><Patients /></AppShell> }

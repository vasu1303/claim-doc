'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import AppShell, { useSession } from '@/components/AppShell'
import { Empty, ErrorBox, Field, Loading, MessageCards, PageHeader, QueryList, Status } from '@/components/Portal'
import api, { DOC_TYPES, downloadFile, errorMessage, type Patient, type Document, type Query, type Message, type User } from '@/lib/api'
import { useResource } from '@/lib/hooks'
import { formatDate, formatFileSize, getDocTypeLabel } from '@/lib/utils'

function Assignments({ patientId }: { patientId: string }) {
  const users = useResource<User[]>('/api/users')
  const assigned = useResource<string[]>(`/api/patients/${patientId}/assignments`)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = selected || assigned.data || []
  async function save() {
    setBusy(true)
    try { await api.put(`/api/patients/${patientId}/assignments`, { user_ids: ids }); await assigned.refresh(); setSelected(null); toast.success('Access updated') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <section className="card mt-5"><h2 className="mb-2 font-semibold">Staff access</h2><p className="mb-3 text-xs text-slate-500">Only assigned staff, administrators, and the linked patient account can access this locker.</p>
    <ErrorBox message={users.error || assigned.error} />
    {users.data?.filter(u => u.role === 'staff' && u.active).map(u => <label key={u.id} className="mr-5 inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={ids.includes(u.id)} onChange={e => setSelected(e.target.checked ? [...ids, u.id] : ids.filter(id => id !== u.id))} />{u.name}</label>)}
    {users.data && !users.data.some(u => u.role === 'staff' && u.active) && <p className="mb-3 text-sm text-slate-400">Create staff accounts under Accounts & access first.</p>}
    <button className="btn-secondary mt-3 block" disabled={busy || assigned.loading || !!assigned.error} onClick={save}>{busy ? 'Saving…' : 'Save staff access'}</button>
  </section>
}

function PatientLocker({ id }: { id: string }) {
  const user = useSession()
  const patient = useResource<Patient>(`/api/patients/${id}`, 5000)
  const docs = useResource<Document[]>(`/api/patients/${id}/documents`, 4000)
  const queries = useResource<Query[]>(`/api/patients/${id}/queries`, 4000)
  const messages = useResource<Message[]>(`/api/messages/patient/${id}`, 4000)
  const [tab, setTab] = useState<'overview' | 'documents' | 'queries' | 'messages'>('overview')
  const [docType, setDocType] = useState('discharge_summary')
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', dob: '', gender: '', policy_number: '', insurer_name: '', notes: '', claim_status: '' })
  const [saving, setSaving] = useState(false)
  async function upload(event: React.ChangeEvent<HTMLInputElement>, query: boolean) {
    const file = event.target.files?.[0]
    const input = event.target
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { toast.error('Files must be 20 MB or smaller.'); input.value = ''; return }
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      if (!query) body.append('doc_type', docType)
      const result = await api.post<{ id: string }>(`/api/patients/${id}/${query ? 'queries' : 'documents'}`, body)
      toast.success(query ? 'Letter queued. Analysis and both notification channels run automatically.' : 'Document uploaded. Existing queries will be checked again after indexing.')
      if (query) { setTab('queries'); await queries.refresh() }
      else { await docs.refresh(); setTab('documents') }
      return result
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setUploading(false); input.value = '' }
  }
  async function download(url: string, name: string) {
    try { await downloadFile(url, name) } catch (e) { toast.error(errorMessage(e)) }
  }
  async function retryDocument(document: Document) {
    try { await api.post(`/api/patients/${id}/documents/${document.id}/retry`); await docs.refresh(); toast.success('Indexing queued again') }
    catch (e) { toast.error(errorMessage(e)) }
  }
  async function removeDocument(document: Document) {
    if (!window.confirm(`Permanently remove ${document.original_name}? Existing queries will be checked again.`)) return
    try { await api.delete(`/api/patients/${id}/documents/${document.id}`); await docs.refresh(); toast.success('Document removed') }
    catch (e) { toast.error(errorMessage(e)) }
  }
  function edit(p: Patient) {
    setForm({ name: p.name, phone: p.phone || '', email: p.email || '', dob: p.dob?.slice(0, 10) || '', gender: p.gender || '',
      policy_number: p.policy_number || '', insurer_name: p.insurer_name || '', notes: p.notes || '', claim_status: p.claim_status })
    setEditing(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true)
    try { await api.patch(`/api/patients/${id}`, form); await patient.refresh(); setEditing(false); toast.success('Profile updated') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  if (patient.loading) return <Loading />
  if (!patient.data) return <ErrorBox message={patient.error || 'Patient not found.'} retry={patient.refresh} />
  const p = patient.data
  return <>
    <Link href="/patients" className="mb-4 inline-block text-sm text-brand-700">← Patient lockers</Link>
    <PageHeader title={p.name} description={`${p.patient_id} · ${p.insurer_name || 'No insurer yet'}${p.is_synthetic ? ' · SYNTHETIC' : ''}`}>
      <div className="flex items-center gap-3"><Status value={p.claim_status} />{user?.role !== 'patient' && <button className="btn-secondary" onClick={() => edit(p)}>Edit profile</button>}</div>
    </PageHeader>
    <div className="mb-5 flex flex-wrap gap-2">{(['overview', 'documents', 'queries', 'messages'] as const).map(t =>
      <button key={t} className={tab === t ? 'btn' : 'btn-secondary'} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}
        {t === 'documents' ? ` (${docs.data?.length || 0})` : t === 'queries' ? ` (${queries.data?.length || 0})` : t === 'messages' ? ` (${messages.data?.length || 0})` : ''}</button>)}</div>
    <ErrorBox message={patient.error || docs.error || queries.error || messages.error} />
    {tab === 'overview' && <>
      <div className="grid gap-4 sm:grid-cols-2"><section className="card"><h2 className="mb-4 font-semibold">Patient profile</h2><dl className="space-y-3">
        {[['Email', p.email], ['Phone', p.phone], ['Date of birth', p.dob ? formatDate(p.dob) : ''], ['Gender', p.gender], ['Policy number', p.policy_number], ['Insurer', p.insurer_name]].map(([label, value]) =>
          <div className="flex justify-between gap-3 text-sm" key={label}><dt className="text-slate-500">{label}</dt><dd className="break-all font-medium">{value || '—'}</dd></div>)}</dl></section>
        <section className="card"><h2 className="mb-4 font-semibold">How your locker works</h2><ol className="list-inside list-decimal space-y-3 text-sm text-slate-600">
          <li>Upload supporting documents using the correct document category.</li><li>Staff upload insurer query letters to this locker.</li>
          <li>The system identifies requests and checks existing documents automatically.</li><li>Missing items and clarifications are sent by WhatsApp and email. Check message history for actual channel outcomes.</li>
        </ol>{p.notes && <p className="mt-4 whitespace-pre-wrap border-t pt-3 text-sm text-slate-500">{p.notes}</p>}</section></div>
      {user?.role === 'admin' && <Assignments patientId={id} />}
    </>}
    {tab === 'documents' && <>
      <div className="card mb-5 flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Document category<select className="input mt-1" value={docType} onChange={e => setDocType(e.target.value)}>
        {DOC_TYPES.map(t => <option value={t} key={t}>{getDocTypeLabel(t)}</option>)}</select></label>
        <label className={`btn cursor-pointer ${uploading ? 'opacity-50' : ''}`}>{uploading ? 'Uploading…' : '+ Upload document'}
          <input aria-label="Upload supporting document" type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={uploading} onChange={e => upload(e, false)} /></label>
        <p className="text-xs text-slate-400">PDF, PNG, JPEG, or UTF-8 text · up to 20 MB</p></div>
      {docs.loading ? <Loading /> : !docs.data?.length ? <Empty>No documents yet.</Empty> : <div className="grid gap-3 sm:grid-cols-2">{docs.data.map(d => <article className="card" key={d.id}>
        <div className="flex items-start justify-between gap-2"><h3 className="break-all font-semibold">{d.original_name}</h3><Status value={d.extraction_status} /></div>
        <p className="my-3 text-sm text-slate-500">{getDocTypeLabel(d.doc_type)} · {formatFileSize(d.file_size)} · {formatDate(d.created_at)}</p>
        {d.extraction_status === 'failed' && <div className="mb-2 text-xs text-red-700"><p>This document could not be indexed. Check the analysis service, then retry, or ask staff to remove it and upload a readable replacement.</p>
          <button className="mt-2 underline" onClick={() => retryDocument(d)}>Retry indexing</button></div>}
        <button className="text-sm text-brand-700 hover:underline" onClick={() => download(`/api/patients/${id}/documents/${d.id}/download`, d.original_name)}>Download private file</button>
        {user?.role !== 'patient' && <button className="ml-4 text-xs text-red-700 hover:underline" onClick={() => removeDocument(d)}>Remove</button>}
      </article>)}</div>}
    </>}
    {tab === 'queries' && <>
      {user?.role !== 'patient' && <div className="card mb-5"><label className={`btn cursor-pointer ${uploading ? 'opacity-50' : ''}`}>{uploading ? 'Uploading…' : '+ Upload insurer query letter'}
        <input aria-label="Upload insurer query letter" type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={uploading} onChange={e => upload(e, true)} /></label>
        <p className="mt-3 text-xs text-slate-500">Uploading starts analysis and both notification channels without another click. This screen updates automatically.</p></div>}
      {queries.loading ? <Loading /> : <QueryList queries={queries.data || []} />}
    </>}
    {tab === 'messages' && (messages.loading ? <Loading /> : <MessageCards messages={messages.data || []} />)}
    {editing && <div role="dialog" aria-modal="true" aria-label="Edit patient" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <form className="my-auto w-full max-w-2xl rounded-2xl bg-white p-6" onSubmit={save}><h2 className="mb-5 text-xl font-bold">Edit patient</h2>
        <div className="grid gap-3 sm:grid-cols-2">{([
          ['name', 'Full name', 'text'], ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'], ['dob', 'Date of birth', 'date'],
          ['gender', 'Gender', 'text'], ['policy_number', 'Policy number', 'text'], ['insurer_name', 'Insurer', 'text'],
        ] as const).map(([key, label, type]) => <Field label={label} key={key} type={type} required={key === 'name'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}
          <label className="text-sm font-medium">Claim status<select className="input mt-1" value={form.claim_status} onChange={e => setForm({ ...form, claim_status: e.target.value })}>
            {['pending', 'processing', 'awaiting_documents', 'completed'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <label className="mt-3 block text-sm font-medium">Notes<textarea className="input mt-1" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} maxLength={5000} /></label>
        <div className="mt-5 flex justify-end gap-3"><button className="btn-secondary" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>
      </form></div>}
  </>
}
export default function PatientPage() { const params = useParams<{ id: string }>(); return <AppShell><PatientLocker id={params.id} /></AppShell> }

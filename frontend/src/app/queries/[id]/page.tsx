'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import AppShell, { useSession } from '@/components/AppShell'
import { ErrorBox, Loading, MessageCards, PageHeader, Status } from '@/components/Portal'
import api, { downloadFile, errorMessage, type Query } from '@/lib/api'
import { useResource } from '@/lib/hooks'
import { getDocTypeLabel } from '@/lib/utils'

function QueryDetail({ id }: { id: string }) {
  const user = useSession()
  const query = useResource<Query>(`/api/queries/${id}`, 3000)
  const [busy, setBusy] = useState(false)
  async function retry() {
    if (!query.data) return
    setBusy(true)
    try { await api.post(`/api/patients/${query.data.patient_id}/queries/${id}/retry`); await query.refresh(); toast.success('Query queued again') }
    catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  async function download(url: string, name: string) {
    try { await downloadFile(url, name) } catch (e) { toast.error(errorMessage(e)) }
  }
  if (query.loading) return <Loading />
  if (!query.data) return <ErrorBox message={query.error || 'Query not found.'} retry={query.refresh} />
  const q = query.data
  return <>
    <Link href={`/patients/${q.patient_id}`} className="mb-4 inline-block text-sm text-brand-700">← {q.patient_name}&apos;s locker</Link>
    <PageHeader title={q.file_name} description={`${q.patient_short_id} · analysis revision ${q.revision}${q.duration_ms ? ` · ${(q.duration_ms / 1000).toFixed(1)} seconds analysis` : ''}`}>
      <Status value={q.status} />
    </PageHeader>
    <ErrorBox message={query.error || q.error || ''} />
    <div className="mb-5 flex flex-wrap gap-3"><button className="btn-secondary" onClick={() => download(`/api/patients/${q.patient_id}/queries/${id}/download`, q.file_name)}>Download query letter</button>
      {user?.role !== 'patient' && ['failed', 'needs_review'].includes(q.status) && <button className="btn" disabled={busy} onClick={retry}>{busy ? 'Queueing…' : 'Retry after correcting the issue'}</button>}</div>
    {['pending', 'processing'].includes(q.status) && <div className="card mb-5"><Loading /><p className="text-sm text-slate-500">Processing automatically. Keep this page open or return later; no send button is needed.</p></div>}
    <h2 className="mb-3 text-lg font-semibold">Point-by-point assessment</h2>
    <div className="mb-7 space-y-3">{q.points?.map(p => <article key={p.id} className="card">
      <div className="flex justify-between gap-3"><h3 className="font-semibold">{p.point_index}. {p.description}</h3><Status value={p.status} /></div>
      <p className="mt-2 text-sm text-slate-500">{p.requirement_type === 'clarification' ? 'Written clarification' : getDocTypeLabel(p.document_type || 'other')}</p>
      <p className="mt-2 text-sm"><strong>Why:</strong> {p.reason}</p>
      {p.qualifiers && <p className="mt-2 text-sm"><strong>Specific requirements:</strong> {p.qualifiers}</p>}
      {p.matched_doc_id && <button className="mt-3 text-sm text-brand-700 hover:underline" onClick={() => download(`/api/patients/${q.patient_id}/documents/${p.matched_doc_id}/download`, p.matched_doc_name || 'document')}>Available in locker: {p.matched_doc_name}</button>}
      {p.evidence && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Match evidence</summary><p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{p.evidence}</p></details>}
    </article>)}</div>
    {q.raw_text && <details className="card mb-7 text-sm"><summary className="cursor-pointer font-semibold">Extracted insurer letter text</summary><pre className="mt-3 whitespace-pre-wrap font-sans text-slate-600">{q.raw_text}</pre></details>}
    <h2 className="mb-3 text-lg font-semibold">Automatic patient notifications</h2><MessageCards messages={q.messages || []} />
  </>
}
export default function QueryPage() { const params = useParams<{ id: string }>(); return <AppShell><QueryDetail id={params.id} /></AppShell> }

'use client'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Badge } from './ui/badge'
import { formatDateTime, getStatusColor } from '@/lib/utils'
import type { Message, Query } from '@/lib/api'

export function Status({ value }: { value: string }) {
  return <Badge variant={getStatusColor(value)}>{value.replace(/_/g, ' ')}</Badge>
}
export function Loading() {
  return <div role="status" className="flex items-center gap-3 p-10 text-slate-500"><Loader2 className="animate-spin" size={20} /> Loading…</div>
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null
  return <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    {message}{retry && <button className="ml-3 underline" onClick={retry}>Try again</button>}
  </div>
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">{children}</div>
}
export function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input {...props} className={`input mt-1 ${props.className || ''}`} /></label>
}
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">{title}</h1>
    {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>{children}</div>
}
export function QueryList({ queries }: { queries: Query[] }) {
  if (!queries.length) return <Empty>No query letters yet. Upload one from a patient locker to start automatic processing.</Empty>
  return <div className="space-y-3">{queries.map(q => <Link href={`/queries/${q.id}`} key={q.id} className="card block transition hover:border-brand-300">
    <div className="flex justify-between gap-3"><div><h3 className="font-semibold">{q.file_name}</h3>
      <p className="mt-1 text-sm text-slate-500">{q.patient_name && `${q.patient_name} · `}{formatDateTime(q.created_at)}</p></div><Status value={q.status} /></div>
    {q.error && <p className="mt-2 text-sm text-red-700">{q.error}</p>}
  </Link>)}</div>
}
export function MessageCards({ messages }: { messages: Message[] }) {
  if (!messages.length) return <Empty>No messages yet. Messages are generated and dispatched automatically after a query is analyzed.</Empty>
  return <div className="space-y-4">{messages.map(m => <article key={m.id} className="card">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-semibold">{m.patient_name || 'Patient notification'} <span className="font-normal text-slate-400">· revision {m.revision}</span></p>
        <p className="text-xs text-slate-500">Created {formatDateTime(m.created_at)}{m.sent_at ? ` · ${m.delivery_mode === 'mock' ? 'simulated' : 'provider accepted'} ${formatDateTime(m.sent_at)}` : ''}</p></div>
      <Badge variant={m.delivery_mode === 'mock' ? 'warning' : 'info'}>{m.delivery_mode === 'mock' ? 'SIMULATED — not delivered' : 'Live delivery'}</Badge>
    </div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2">{(['whatsapp', 'email'] as const).map(channel => <div key={channel} className="rounded-xl bg-slate-50 p-3">
      <div className="flex items-center justify-between"><span className="text-sm font-medium capitalize">{channel}</span><Status value={m[`${channel}_status`]} /></div>
      {m[`${channel}_error`] && <p className="mt-2 text-xs text-red-700">{m[`${channel}_error`]}</p>}
      {m[`${channel}_message_id`] && <p className="mt-2 break-all text-xs text-slate-400">Provider ID: {m[`${channel}_message_id`]}</p>}
    </div>)}</div>
    <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-4 font-sans text-sm leading-relaxed">{m.message_body}</pre>
    <Link href={`/queries/${m.query_id}`} className="mt-3 inline-block text-sm text-brand-700 hover:underline">View insurer query →</Link>
  </article>)}</div>
}
export function Pagination({ page, total, size, onChange }: { page: number; total: number; size: number; onChange: (page: number) => void }) {
  return <div className="mt-5 flex items-center justify-between text-sm text-slate-500"><span>{total} result{total === 1 ? '' : 's'} · Page {page}</span>
    <div className="flex gap-2"><button className="btn-secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
      <button className="btn-secondary" disabled={page * size >= total} onClick={() => onChange(page + 1)}>Next</button></div></div>
}

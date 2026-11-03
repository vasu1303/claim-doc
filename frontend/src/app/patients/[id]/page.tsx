'use client'
import { useEffect, useState, useRef } from 'react'
import AppShell from '@/components/AppShell'
import api, { type Patient, type Document as Doc, type Query, type Message } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { getStatusColor, formatDate, formatDateTime, formatFileSize, getDocTypeLabel } from '@/lib/utils'
import { ChevronLeft, Upload, FileText, MessageSquare, User, Loader2, CheckCircle, XCircle, Clock, AlertCircle, X } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const DOC_TYPES = [
  'discharge_summary', 'hospital_bill', 'consultation_notes', 'lab_report',
  'prescription', 'policy_copy', 'kyc_document', 'claim_form',
  'previous_medical_history', 'authorization_letter', 'id_proof',
]

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [queries, setQueries] = useState<Query[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [tab, setTab] = useState<'overview' | 'documents' | 'queries' | 'messages'>('overview')
  const [loading, setLoading] = useState(true)
  const docRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState('discharge_summary')
  const [uploading, setUploading] = useState(false)
  const [uploadingQuery, setUploadingQuery] = useState(false)

  const load = async () => {
    try {
      const [pRes, dRes, qRes, mRes] = await Promise.all([
        api.get(`/api/patients/${params.id}`),
        api.get(`/api/patients/${params.id}/documents`),
        api.get(`/api/patients/${params.id}/queries`),
        api.get(`/api/messages/patient/${params.id}`),
      ])
      setPatient(pRes.data)
      setDocs(dRes.data)
      setQueries(qRes.data)
      setMessages(mRes.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [params.id])

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('doc_type', docType)
    try {
      await api.post(`/api/patients/${params.id}/documents`, fd)
      toast.success('Document uploaded')
      const dRes = await api.get(`/api/patients/${params.id}/documents`)
      setDocs(dRes.data)
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed') }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleQueryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingQuery(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post(`/api/patients/${params.id}/queries`, fd)
      toast.success('Query letter uploaded – AI processing started 🤖')
      const qRes = await api.get(`/api/patients/${params.id}/queries`)
      setQueries(qRes.data)
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed') }
    finally { setUploadingQuery(false); e.target.value = '' }
  }

  if (loading) return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-brand-500" size={32} /></div></AppShell>
  if (!patient) return <AppShell><p className="text-slate-500">Patient not found.</p></AppShell>

  return (
    <AppShell>
      <div className="max-w-5xl">
        {/* Back */}
        <Link href="/patients" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm mb-5">
          <ChevronLeft size={16} /> Patients
        </Link>

        {/* Patient header */}
        <div className="bg-white rounded-2xl card-shadow p-6 mb-5 flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xl flex-shrink-0">
              {patient.name[0]}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{patient.name}</h1>
              <p className="text-slate-400 text-sm mt-0.5">{patient.patient_id} · {patient.email} · {patient.phone}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={getStatusColor(patient.claim_status) as any}>
                  {patient.claim_status.replace(/_/g, ' ')}
                </Badge>
                {patient.insurer_name && <span className="text-xs text-slate-400">{patient.insurer_name}</span>}
                {patient.policy_number && <span className="text-xs text-slate-400">· {patient.policy_number}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <div className="text-center">
              <p className="text-lg font-bold text-slate-900">{docs.length}</p>
              <p className="text-xs text-slate-400">Docs</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-900">{queries.length}</p>
              <p className="text-xs text-slate-400">Queries</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-900">{messages.length}</p>
              <p className="text-xs text-slate-400">Messages</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-5 w-fit">
          {(['overview', 'documents', 'queries', 'messages'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'documents' && <span className="ml-1.5 text-xs font-normal text-slate-400">({docs.length})</span>}
              {t === 'queries' && <span className="ml-1.5 text-xs font-normal text-slate-400">({queries.length})</span>}
              {t === 'messages' && <span className="ml-1.5 text-xs font-normal text-slate-400">({messages.length})</span>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl card-shadow p-5">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><User size={16} className="text-brand-500" /> Patient Info</h3>
              <dl className="space-y-3">
                {[['Name', patient.name], ['DOB', patient.dob ? formatDate(patient.dob) : '—'], ['Gender', patient.gender || '—'], ['Phone', patient.phone || '—'], ['Email', patient.email || '—']].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="bg-white rounded-2xl card-shadow p-5">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><FileText size={16} className="text-brand-500" /> Claim Info</h3>
              <dl className="space-y-3">
                {[['Policy No.', patient.policy_number || '—'], ['Insurer', patient.insurer_name || '—'], ['Status', patient.claim_status.replace(/_/g, ' ')], ['Added', formatDate(patient.created_at)]].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-700">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 bg-white">
                {DOC_TYPES.map(t => <option key={t} value={t}>{getDocTypeLabel(t)}</option>)}
              </select>
              <input ref={docRef} type="file" className="hidden" onChange={handleDocUpload} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
              <button onClick={() => docRef.current?.click()} disabled={uploading}
                className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Uploading...' : 'Upload Document'}
              </button>
            </div>
            {docs.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                No documents yet
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {docs.map(d => (
                  <div key={d.id} className="bg-white rounded-xl card-shadow p-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-brand-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 text-sm truncate">{d.original_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{getDocTypeLabel(d.doc_type)} · {formatDate(d.created_at)}</p>
                      {d.file_size && <p className="text-xs text-slate-300 mt-0.5">{formatFileSize(d.file_size)}</p>}
                    </div>
                    <Badge variant="success" className="flex-shrink-0">Available</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'queries' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input ref={queryRef} type="file" className="hidden" onChange={handleQueryUpload} accept=".pdf,.jpg,.jpeg,.png" />
              <button onClick={() => queryRef.current?.click()} disabled={uploadingQuery}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                {uploadingQuery ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploadingQuery ? 'Processing...' : 'Upload Query Letter'}
              </button>
              <p className="text-xs text-slate-400">AI will automatically process and send patient message</p>
            </div>
            {queries.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <FileText size={36} className="mx-auto mb-2 text-slate-200" />
                No query letters yet
              </div>
            ) : (
              <div className="space-y-3">
                {queries.map(q => (
                  <Link key={q.id} href={`/queries/${q.id}`}
                    className="block bg-white rounded-xl card-shadow p-5 hover:card-shadow-hover transition-shadow">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{q.file_name}</p>
                        <p className="text-xs text-slate-400 mt-1">{q.insurer_name || patient.insurer_name} · Received {formatDate(q.created_at)}</p>
                      </div>
                      <Badge variant={getStatusColor(q.status) as any}>{q.status}</Badge>
                    </div>
                    {q.processed_at && <p className="text-xs text-slate-300 mt-2">Processed: {formatDateTime(q.processed_at)}</p>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'messages' && (
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <MessageSquare size={36} className="mx-auto mb-2 text-slate-200" />
                No messages sent yet
              </div>
            ) : messages.map(m => (
              <div key={m.id} className="bg-white rounded-xl card-shadow p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sent {formatDateTime(m.sent_at || m.created_at)}</p>
                  <div className="flex gap-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.whatsapp_status === 'sent' || m.whatsapp_status === 'mock_sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      WhatsApp: {m.whatsapp_status}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.email_status === 'sent' || m.email_status === 'mock_sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      Email: {m.email_status}
                    </span>
                  </div>
                </div>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-slate-50 rounded-xl p-4 border border-slate-100">{m.message_body}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

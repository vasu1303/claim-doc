'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import api, { type Patient } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { getStatusColor, formatDate } from '@/lib/utils'
import { Search, Plus, ChevronRight, Users, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ patient_id: '', name: '', phone: '', email: '', dob: '', gender: 'Male', policy_number: '', insurer_name: '' })
  const [saving, setSaving] = useState(false)

  const load = async (q = '') => {
    setLoading(true)
    try {
      const res = await api.get(`/api/patients?search=${encodeURIComponent(q)}&limit=50`)
      setPatients(res.data.patients)
      setTotal(res.data.total)
    } catch { toast.error('Failed to load patients') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSearch = (val: string) => {
    setSearch(val)
    const t = setTimeout(() => load(val), 400)
    return () => clearTimeout(t)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/patients', form)
      toast.success('Patient added successfully')
      setShowAdd(false)
      setForm({ patient_id: '', name: '', phone: '', email: '', dob: '', gender: 'Male', policy_number: '', insurer_name: '' })
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add patient')
    } finally { setSaving(false) }
  }

  return (
    <AppShell>
      <div className="max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
            <p className="text-slate-500 text-sm mt-1">{total} patient{total !== 1 ? 's' : ''} total</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-brand-500/20"
          >
            <Plus size={16} /> Add Patient
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, ID or email…"
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all card-shadow"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl card-shadow overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Patient</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Insurer</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Docs</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Queries</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && [...Array(5)].map((_, i) => (
                <tr key={i}>
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {!loading && patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0">
                        {p.name[0]}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.patient_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-600">{p.insurer_name || '—'}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1 text-sm text-slate-700">
                      <span className="font-semibold">{p.doc_count || 0}</span>
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-700 font-semibold">{p.query_count || 0}</td>
                  <td className="px-5 py-4">
                    <Badge variant={getStatusColor(p.claim_status) as any}>
                      {p.claim_status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-xs text-slate-400">{formatDate(p.created_at)}</td>
                  <td className="px-5 py-4">
                    <Link href={`/patients/${p.id}`} className="text-brand-600 hover:text-brand-700">
                      <ChevronRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && patients.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                  <Users size={32} className="mx-auto mb-2 text-slate-200" />
                  No patients found
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Patient Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Add New Patient</h2>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Patient ID *</label>
                  <input required value={form.patient_id} onChange={e => setForm({...form, patient_id: e.target.value})}
                    placeholder="PAT-001"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Full Name *</label>
                  <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Rahul Sharma"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                    placeholder="+91 98765 43210"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                    placeholder="rahul@email.com"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Date of Birth</label>
                  <input type="date" value={form.dob} onChange={e => setForm({...form, dob: e.target.value})}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Gender</label>
                  <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400 bg-white">
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Policy Number</label>
                  <input value={form.policy_number} onChange={e => setForm({...form, policy_number: e.target.value})}
                    placeholder="POL-2024-001"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Insurer Name</label>
                  <input value={form.insurer_name} onChange={e => setForm({...form, insurer_name: e.target.value})}
                    placeholder="Star Health Insurance"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? 'Saving...' : 'Add Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  )
}

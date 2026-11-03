'use client'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { Empty, ErrorBox, Loading, PageHeader, QueryList } from '@/components/Portal'
import { useResource } from '@/lib/hooks'
import type { Stats, Query } from '@/lib/api'

export default function DashboardPage() {
  const stats = useResource<Stats>('/api/messages/stats', 4000)
  const queries = useResource<{ queries: Query[] }>('/api/queries', 4000)
  return <AppShell><PageHeader title="Claims overview" description="From insurer query to patient notification, automatically." />
    <ErrorBox message={stats.error || queries.error} retry={() => { void stats.refresh(); void queries.refresh() }} />
    {stats.loading ? <Loading /> : stats.data && <>
      <div className={`mb-6 rounded-xl border p-4 text-sm ${stats.data.delivery_mode === 'mock' || stats.data.analysis_mode === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
        <strong>Analysis: {stats.data.analysis_mode.toUpperCase()} · Delivery: {stats.data.delivery_mode.toUpperCase()}</strong>
        <p className="mt-1">{stats.data.analysis_mode === 'demo' ? 'Demo analysis accepts the labelled sample letters only. Configure OpenAI for unseen letters and scanned documents. ' : 'OpenAI processes synthetic letters and document evidence. '}
          {stats.data.delivery_mode === 'mock' ? 'Mock notifications are recorded but are NOT sent to a phone or inbox.' : 'Live notifications are sent only to configured test recipients. “Sent” means provider accepted, not confirmed delivered.'}</p>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[['Patients', stats.data.total_patients], ['Documents', stats.data.total_documents], ['Query letters', stats.data.total_queries], ['Messages', stats.data.messages_sent],
          ['Analyzed', stats.data.completed_queries], ['In progress', stats.data.pending_queries], ['Needs attention', stats.data.failed_queries], ['Delivery issues', stats.data.delivery_issues]].map(([label, count]) =>
          <div className="card" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{count}</p></div>)}
      </div>
    </>}
    <div className="mb-4 flex justify-between"><h2 className="text-lg font-semibold">Recent query letters</h2><Link href="/queries" className="text-sm text-brand-700">View all →</Link></div>
    {queries.data ? <QueryList queries={queries.data.queries.slice(0, 5)} /> : !queries.loading && <Empty>No query data available.</Empty>}
  </AppShell>
}

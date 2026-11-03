'use client'
import { useState } from 'react'
import AppShell from '@/components/AppShell'
import { ErrorBox, Loading, PageHeader, Pagination, QueryList } from '@/components/Portal'
import { useResource } from '@/lib/hooks'
import type { Query } from '@/lib/api'
export default function QueriesPage() {
  const [page, setPage] = useState(1)
  const queries = useResource<{ queries: Query[]; total: number }>(`/api/queries?page=${page}`, 4000)
  return <AppShell><PageHeader title="Insurer query letters" description="Every request, document match, and processing outcome in one place." />
    <ErrorBox message={queries.error} retry={queries.refresh} />
    {queries.loading ? <Loading /> : queries.data && <><QueryList queries={queries.data.queries} /><Pagination page={page} total={queries.data.total} size={50} onChange={setPage} /></>}
  </AppShell>
}

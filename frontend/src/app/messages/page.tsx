'use client'
import { useState } from 'react'
import AppShell from '@/components/AppShell'
import { ErrorBox, Loading, MessageCards, PageHeader, Pagination } from '@/components/Portal'
import { useResource } from '@/lib/hooks'
import type { Message } from '@/lib/api'
export default function MessagesPage() {
  const [page, setPage] = useState(1)
  const messages = useResource<{ messages: Message[]; total: number }>(`/api/messages?page=${page}`, 4000)
  return <AppShell><PageHeader title="Message history" description="Automatic notifications with independent WhatsApp and email outcomes. Sent means provider acceptance, not delivery confirmation." />
    <ErrorBox message={messages.error} retry={messages.refresh} />
    {messages.loading ? <Loading /> : messages.data && <><MessageCards messages={messages.data.messages} /><Pagination page={page} total={messages.data.total} size={50} onChange={setPage} /></>}
  </AppShell>
}

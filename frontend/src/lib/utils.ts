import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'completed': case 'sent': case 'available': case 'mock_sent': return 'success'
    case 'processing': case 'queued': return 'info'
    case 'pending': case 'awaiting_documents': return 'warning'
    case 'failed': case 'missing': return 'danger'
    case 'clarification_needed': return 'warning'
    default: return 'secondary'
  }
}

export function getDocTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    discharge_summary: 'Discharge Summary',
    hospital_bill: 'Hospital Bill',
    consultation_notes: 'Consultation Notes',
    lab_report: 'Lab Report',
    prescription: 'Prescription',
    policy_copy: 'Policy Copy',
    kyc_document: 'KYC Document',
    claim_form: 'Claim Form',
    previous_medical_history: 'Medical History',
    authorization_letter: 'Auth Letter',
    id_proof: 'ID Proof',
  }
  return labels[type] || type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Document'
}

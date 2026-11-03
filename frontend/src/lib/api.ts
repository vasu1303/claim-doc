import axios from 'axios'
import { getToken, removeToken } from './auth'

const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000', timeout: 30000 })
api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && typeof window !== 'undefined' && !error.config?.url?.includes('/auth/login')) {
    removeToken()
    window.dispatchEvent(new Event('locker-session-expired'))
  }
  return Promise.reject(error)
})
export default api

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: string }>(error)) return error.response?.data?.error || 'Cannot reach the server. Check that the services are running.'
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
export interface User { id: string; name: string; email: string; role: 'admin' | 'staff' | 'patient'; patient_id: string | null; active?: boolean }
export interface Patient {
  id: string; patient_id: string; name: string; phone: string; email: string; dob?: string; gender?: string;
  policy_number?: string; insurer_name?: string; claim_status: string; notes?: string; is_synthetic: boolean;
  doc_count?: number; query_count?: number; message_count?: number; created_at: string;
}
export interface Document {
  id: string; patient_id: string; original_name: string; doc_type: string; file_size?: number; mime_type?: string;
  extraction_status: string; created_at: string;
}
export interface QueryPoint {
  id: string; query_id: string; point_index: number; description: string; requirement_type: string; document_type?: string;
  status: string; matched_doc_id?: string; matched_doc_name?: string; reason: string; qualifiers?: string; evidence?: string;
}
export interface Query {
  id: string; patient_id: string; patient_name?: string; patient_short_id?: string; file_name: string; raw_text?: string;
  status: string; error?: string; insurer_name?: string; revision: number; processed_at?: string; duration_ms?: number;
  created_at: string; points?: QueryPoint[]; messages?: Message[];
}
export interface Message {
  id: string; patient_id: string; patient_name?: string; query_id: string; message_body: string;
  whatsapp_status: string; email_status: string; whatsapp_error?: string; email_error?: string;
  whatsapp_message_id?: string; email_message_id?: string; delivery_mode: string; revision: number;
  sent_at?: string; created_at: string;
}
export interface Stats {
  total_patients: number; total_queries: number; completed_queries: number; pending_queries: number;
  failed_queries: number; messages_sent: number; total_documents: number; delivery_issues: number;
  analysis_mode: string; delivery_mode: string; data_mode: string;
}
export const DOC_TYPES = ['discharge_summary', 'hospital_bill', 'consultation_notes', 'lab_report', 'prescription',
  'policy_copy', 'kyc_document', 'claim_form', 'previous_medical_history', 'authorization_letter', 'id_proof', 'other']

export async function downloadFile(url: string, name: string) {
  const response = await api.get<Blob>(url, { responseType: 'blob' })
  const objectUrl = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

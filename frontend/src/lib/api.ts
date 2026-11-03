import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: API_URL })

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api

export interface Patient {
  id: string
  patient_id: string
  name: string
  phone: string
  email: string
  dob?: string
  gender?: string
  policy_number?: string
  insurer_name?: string
  claim_status: string
  notes?: string
  doc_count?: number
  query_count?: number
  message_count?: number
  created_at: string
}

export interface Document {
  id: string
  patient_id: string
  file_name: string
  original_name: string
  doc_type: string
  doc_category?: string
  file_url: string
  file_size?: number
  mime_type?: string
  created_at: string
}

export interface QueryPoint {
  id: string
  query_id: string
  point_index: number
  description: string
  requirement_type: string
  document_type?: string
  status: string
  matched_doc_id?: string
  matched_doc_name?: string
  matched_doc_type?: string
}

export interface Query {
  id: string
  patient_id: string
  file_name: string
  file_url: string
  raw_text?: string
  status: string
  insurer_name?: string
  received_date?: string
  processed_at?: string
  created_at: string
  points?: QueryPoint[]
}

export interface Message {
  id: string
  patient_id: string
  query_id: string
  message_body: string
  whatsapp_status: string
  email_status: string
  whatsapp_message_id?: string
  email_message_id?: string
  sent_at?: string
  created_at: string
}

export interface Stats {
  total_patients: string
  total_queries: string
  completed_queries: string
  pending_queries: string
  messages_sent: string
  total_documents: string
}

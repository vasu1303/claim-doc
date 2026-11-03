'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import api, { errorMessage } from './api'

export function useResource<T>(url: string, interval = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const response = await api.get<T>(url)
      if (request === generation.current) { setData(response.data); setError('') }
    } catch (e) { if (request === generation.current) setError(errorMessage(e)) }
    finally { if (request === generation.current) setLoading(false) }
  }, [url])
  useEffect(() => {
    setLoading(true)
    setData(null)
    void refresh()
    const timer = interval ? setInterval(() => { void refresh() }, interval) : null
    return () => { invalidate(); if (timer) clearInterval(timer) }
  }, [refresh, interval, invalidate])
  return { data, error, loading, refresh }
}

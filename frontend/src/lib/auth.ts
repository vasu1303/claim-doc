export function getToken(): string | null {
  return typeof window === 'undefined' ? null : sessionStorage.getItem('locker-token')
}
export function setToken(token: string) { sessionStorage.setItem('locker-token', token) }
export function removeToken() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem('locker-token')
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

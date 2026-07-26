const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

let accessToken = localStorage.getItem('accessToken') || null;
let refreshPromise: Promise<string | null> | null = null;

export const setAccessToken = (token: string) => {
  accessToken = token;
  localStorage.setItem('accessToken', token);
};

export const clearTokens = async () => {
  accessToken = null;
  localStorage.removeItem('accessToken');
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (err) {
    console.error('Logout failed', err);
  }
};

async function refreshToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Must be set to send HttpOnly cookie
    });

    if (res.ok) {
      const data = await res.json();
      setAccessToken(data.accessToken);
      return data.accessToken;
    }
  } catch (error) {
    console.error('Failed to refresh token', error);
  }

  clearTokens();
  window.location.href = '/login';
  return null;
}

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  let currentToken = accessToken;

  // Add auth header
  const headers = new Headers(options.headers || {});
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  // First attempt
  let response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: options.credentials || 'include',
  });

  if (response.status === 401) {
    // Prevent multiple parallel refresh calls
    if (!refreshPromise) {
      refreshPromise = refreshToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (newToken) {
      // Retry request with new token
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: options.credentials || 'include',
      });
    }
  }

  return response;
}

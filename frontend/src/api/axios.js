import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request automatically
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('gocab_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle global 401 responses
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('gocab_token');
      localStorage.removeItem('gocab_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default API;

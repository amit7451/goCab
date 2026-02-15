import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { Toaster } from 'react-hot-toast'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            background: '#0f172a',
            color: '#f8fafc',
            border: '1px solid #f59e0b',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#f59e0b', secondary: '#0f172a' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />
    </AuthProvider>
  </React.StrictMode>
)

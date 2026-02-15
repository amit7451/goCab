import { createContext, useContext, useState, useEffect } from 'react';
import API from '../api/axios';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load auth from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('gocab_token');
    const storedUser = localStorage.getItem('gocab_user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const res = await API.post('/auth/login', { email, password });
    const { token: newToken, user: newUser } = res.data;

    localStorage.setItem('gocab_token', newToken);
    localStorage.setItem('gocab_user', JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);

    return newUser;
  };

  const register = async (formData) => {
    const res = await API.post('/auth/register', formData);
    const { token: newToken, user: newUser } = res.data;

    localStorage.setItem('gocab_token', newToken);
    localStorage.setItem('gocab_user', JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);

    return newUser;
  };

  const logout = () => {
    localStorage.removeItem('gocab_token');
    localStorage.removeItem('gocab_user');
    setToken(null);
    setUser(null);
    toast.success('Logged out successfully');
  };

  const updateUser = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('gocab_user', JSON.stringify(updatedUser));
  };

  const isAuthenticated = !!token && !!user;
  const isDriver = user?.role === 'driver';
  const isUser = user?.role === 'user';

  return (
    <AuthContext.Provider
      value={{ user, token, loading, isAuthenticated, isDriver, isUser, login, register, logout, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

export default AuthContext;

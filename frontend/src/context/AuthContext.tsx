import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import API from '../api/axios';
import toast from 'react-hot-toast';
import { User, AuthContextType } from '../types';
import { connectSocket, disconnectSocket } from '../utils/socket';

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Load auth from localStorage on mount and connect socket
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('gocab_token');
      const storedUser = localStorage.getItem('gocab_user');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        connectSocket(storedToken);
      }
    } catch (err) {
      console.error('Failed to parse stored user data:', err);
      localStorage.removeItem('gocab_token');
      localStorage.removeItem('gocab_user');
    } finally {
      setLoading(false);
    }

    const handleUnauthorized = () => {
      setToken(null);
      setUser(null);
      disconnectSocket();
    };

    window.addEventListener('gocab:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('gocab:unauthorized', handleUnauthorized);
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    const res = await API.post('/auth/login', { email, password });
    const { token: newToken, user: newUser } = res.data;

    localStorage.setItem('gocab_token', newToken);
    localStorage.setItem('gocab_user', JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);
    connectSocket(newToken);

    return newUser;
  };

  const register = async (formData: Record<string, any>): Promise<User> => {
    const res = await API.post('/auth/register', formData);
    const { token: newToken, user: newUser } = res.data;

    localStorage.setItem('gocab_token', newToken);
    localStorage.setItem('gocab_user', JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);
    connectSocket(newToken);

    return newUser;
  };

  const logout = (): void => {
    localStorage.removeItem('gocab_token');
    localStorage.removeItem('gocab_user');
    setToken(null);
    setUser(null);
    disconnectSocket();
    toast.success('Logged out successfully');
  };

  const updateUser = (updatedUser: User): void => {
    setUser(updatedUser);
    localStorage.setItem('gocab_user', JSON.stringify(updatedUser));
  };

  const isAuthenticated = !!token && !!user;
  const isDriver = user?.role === 'driver';
  const isUser = user?.role === 'user';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated,
        isDriver,
        isUser,
        login,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};

export default AuthContext;

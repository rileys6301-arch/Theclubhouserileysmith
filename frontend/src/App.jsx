import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login    from './pages/Login';
import Register from './pages/Register';
import Profile  from './pages/Profile';
import Home     from './pages/Home';
import LogRound from './pages/LogRound';
import Members      from './pages/Members';
import Competitions from './pages/Competitions';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/"            element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/login"       element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register"    element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/profile"     element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/log"         element={<ProtectedRoute><LogRound /></ProtectedRoute>} />
        <Route path="/members"     element={<ProtectedRoute><Members /></ProtectedRoute>} />
        <Route path="/members/:id"       element={<ProtectedRoute><Members /></ProtectedRoute>} />
        <Route path="/competitions"      element={<ProtectedRoute><Competitions /></ProtectedRoute>} />
        <Route path="/competitions/:id"  element={<ProtectedRoute><Competitions /></ProtectedRoute>} />
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ClubProvider } from './contexts/ClubContext';
import Login    from './pages/Login';
import Register from './pages/Register';
import Profile  from './pages/Profile';
import Home     from './pages/Home';
import LogRound  from './pages/LogRound';
import LiveRound from './pages/LiveRound';
import Play        from './pages/Play';
import Members      from './pages/Members';
import Competitions from './pages/Competitions';
import Admin        from './pages/Admin';
import CreateClub from './pages/CreateClub';
import JoinClub   from './pages/JoinClub';

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
      <ClubProvider>
        <Routes>
          {/* Auth */}
          <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

          {/* Club setup — accessible to any logged-in user */}
          <Route path="/club/create" element={<ProtectedRoute><CreateClub /></ProtectedRoute>} />
          <Route path="/club/join"   element={<ProtectedRoute><JoinClub /></ProtectedRoute>} />

          {/* Main app */}
          <Route path="/"            element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/profile"     element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/play"        element={<ProtectedRoute><Play /></ProtectedRoute>} />
          <Route path="/log"         element={<ProtectedRoute><LogRound /></ProtectedRoute>} />
          <Route path="/live"        element={<ProtectedRoute><LiveRound /></ProtectedRoute>} />
          <Route path="/members"          element={<ProtectedRoute><Members /></ProtectedRoute>} />
          <Route path="/members/:id"      element={<ProtectedRoute><Members /></ProtectedRoute>} />
          <Route path="/competitions"     element={<ProtectedRoute><Competitions /></ProtectedRoute>} />
          <Route path="/competitions/:id" element={<ProtectedRoute><Competitions /></ProtectedRoute>} />
          <Route path="/admin"            element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="*"                 element={<Navigate to="/" replace />} />
        </Routes>
      </ClubProvider>
    </AuthProvider>
  );
}

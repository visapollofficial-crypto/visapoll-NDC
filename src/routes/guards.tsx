import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";
import { Loader } from "../components/Loader";

/** Requires a signed-in user with a completed profile. */
export function RequireAuth() {
  const { user, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (profile === null) return <Navigate to="/register" replace />;
  return <Outlet />;
}

/** Requires one of the given roles. Rules and Functions re-check this server-side. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { role, loading } = useAuth();
  if (loading) return <Loader />;
  if (!role || !roles.includes(role)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

/** Locks premium screens until a trial/subscription is active (UI layer only). */
export function RequirePremium() {
  const { hasPremiumAccess, loading } = useAuth();
  if (loading) return <Loader />;
  if (!hasPremiumAccess) return <Navigate to="/subscription" replace />;
  return <Outlet />;
}

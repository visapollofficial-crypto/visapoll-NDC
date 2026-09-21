import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { auth, db } from "../firebase/config";

export type Role = "student" | "moderator" | "admin" | "superadmin";

export interface Profile {
  fullName: string;
  studentId: string;
  department: string;
  section: string;
  session: string;
  phone: string;
  photoURL: string | null;
  scoreVisibility: "private" | "public";
  verificationStatus: "pending" | "verified" | "rejected" | "reupload_required";
  verificationNote?: string | null;
}

export interface Subscription {
  status: "none" | "trial" | "active" | "expired";
  endsAt: Timestamp | null;
  trialStatus: "granted" | "already_used" | "not_verified" | "disabled" | "blocked";
}

interface AuthState {
  user: User | null;
  role: Role | null;
  /** undefined = still loading, null = signed in but no profile yet */
  profile: Profile | null | undefined;
  subscription: Subscription | null;
  /** True while the initial auth/profile load is in flight. */
  loading: boolean;
  /** UI convenience only. Real enforcement is in security rules and Cloud Functions. */
  hasPremiumAccess: boolean;
  signOut: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const loadRole = async (u: User, force = false) => {
    const token = await u.getIdTokenResult(force);
    setRole((token.claims.role as Role) ?? null);
  };

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) await loadRole(u).catch(() => setRole(null));
        else {
          setRole(null);
          setProfile(undefined);
          setSubscription(null);
        }
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    if (!user) return;
    setProfile(undefined);
    const offProfile = onSnapshot(
      doc(db, "users", user.uid),
      (s) => setProfile(s.exists() ? (s.data() as Profile) : null),
      () => setProfile(null)
    );
    const offSub = onSnapshot(
      doc(db, "subscriptions", user.uid),
      (s) => setSubscription(s.exists() ? (s.data() as Subscription) : null),
      () => setSubscription(null)
    );
    return () => {
      offProfile();
      offSub();
    };
  }, [user]);

  const value = useMemo<AuthState>(() => {
    const active =
      !!subscription &&
      (subscription.status === "trial" || subscription.status === "active") &&
      !!subscription.endsAt &&
      subscription.endsAt.toMillis() > Date.now();
    return {
      user,
      role,
      profile,
      subscription,
      loading: !authReady || (!!user && profile === undefined),
      hasPremiumAccess: active,
      signOut: () => fbSignOut(auth),
      refreshClaims: async () => {
        if (auth.currentUser) await loadRole(auth.currentUser, true);
      },
    };
  }, [user, role, profile, subscription, authReady]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

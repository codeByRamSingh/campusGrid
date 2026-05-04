import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, type LoginResponse } from "../services/api";

export type UserSession = LoginResponse["user"];

type AuthContextValue = {
  user: UserSession | null;
  permissions: string[];
  login: (data: LoginResponse) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "campusgrid_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserSession) : null;
  });

  const allPermissions = [
    "ACADEMIC_READ", "ADMIN_MANAGE", "AUDIT_READ", "ADMISSIONS_APPROVE",
    "FINANCE_APPROVE", "FINANCE_READ", "FINANCE_WRITE", "HR_ATTENDANCE",
    "HR_READ", "HR_WRITE", "PAYROLL_READ", "REPORTS_READ", "SETTINGS_MANAGE", "SETTINGS_COLLEGE",
    "STUDENTS_READ", "STUDENTS_WRITE", "WORKFLOW_READ", "EXCEPTIONS_READ", "EXCEPTIONS_WRITE", "EXCEPTIONS_RESOLVE",
    "EXAM_READ", "EXAM_WRITE", "HOSTEL_READ", "HOSTEL_WRITE", "LIBRARY_READ", "LIBRARY_WRITE", "TRANSPORT_READ", "TRANSPORT_WRITE",
  ];

  const permissions = user?.role === "SUPER_ADMIN" ? allPermissions : (user?.permissions ?? []);

  const login = useCallback((data: LoginResponse) => {
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    api.post("/auth/logout").catch(() => {});
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    function handleSessionExpired() {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      toast.error("Session expired. Please login again.");
    }
    window.addEventListener("campusgrid:session-expired", handleSessionExpired);
    return () => window.removeEventListener("campusgrid:session-expired", handleSessionExpired);
  }, []);

  return (
    <AuthContext.Provider value={{ user, permissions, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

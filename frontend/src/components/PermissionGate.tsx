import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";

type Props = {
  permission: string | string[];
  fallback?: ReactNode;
  children: ReactNode;
};

export function PermissionGate({ permission, fallback = null, children }: Props) {
  const { user, permissions } = useAuth();

  if (user?.role === "SUPER_ADMIN") return <>{children}</>;

  const required = Array.isArray(permission) ? permission : [permission];
  const allowed = required.some((p) => permissions.includes(p));

  return allowed ? <>{children}</> : <>{fallback}</>;
}

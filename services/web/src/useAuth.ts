import { useEffect, useState } from "react";
import { me, login as apiLogin, logout as apiLogout, type Principal } from "./auth.js";

export function useAuth() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    me().then((p) => setPrincipal(p)).catch(() => setPrincipal(null)).finally(() => setLoading(false));
  }, []);

  const login = async (memberId: string) => { setPrincipal(await apiLogin(memberId)); };
  const logout = async () => { await apiLogout(); setPrincipal(null); };

  return { principal, loading, login, logout };
}

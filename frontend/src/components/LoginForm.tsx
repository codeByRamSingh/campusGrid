import { FormEvent, useState } from "react";
import { api, type LoginResponse } from "../services/api";

type LoginFormProps = {
  onSuccess: (data: LoginResponse) => void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.post<LoginResponse>("/auth/login", { email, password });
      onSuccess(response.data);
    } catch {
      setError("Login failed. Check credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 md:grid md:grid-cols-2">
        <div className="hidden bg-slate-900 p-8 text-white md:block">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">CampusGrid</p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight">Trust ERP, redesigned for scale.</h2>
          <p className="mt-4 text-sm text-slate-300">Operations, admissions, finance, and HR in one enterprise-grade workspace.</p>
        </div>

        <form className="p-8" onSubmit={handleSubmit}>
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Mother Teresa Educational Trust ERP</p>

          <label className="mt-6 block text-sm text-slate-600">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="mt-1 w-full rounded-xl bg-slate-100 px-3 py-2.5 outline-none ring-1 ring-transparent focus:ring-slate-300"
            />
          </label>

          <label className="mt-4 block text-sm text-slate-600">
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              className="mt-1 w-full rounded-xl bg-slate-100 px-3 py-2.5 outline-none ring-1 ring-transparent focus:ring-slate-300"
            />
          </label>

          {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <button
            className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

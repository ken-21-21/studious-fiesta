import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

export default function Login() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
                await login(username, password);
                navigate("/", { replace: true });
        } catch (err) {
                setError(err instanceof Error ? err.message : "Login failed");
        } finally {
                setLoading(false);
        }
  }

  return (
        <div className="login-page">
              <div className="login-card glass-panel">
                      <h1 className="app-title" style={{ marginBottom: "1.5rem" }}>FSRS Learn</h1>h1>
                      <form onSubmit={handleSubmit} className="login-form">
                                <label className="login-label">
                                            Username
                                            <input
                                                            className="login-input"
                                                            type="text"
                                                            autoComplete="username"
                                                            value={username}
                                                            onChange={(e) => setUsername(e.target.value)}
                                                            required
                                                            disabled={loading}
                                                          />
                                </label>label>
                                <label className="login-label">
                                            Password
                                            <input
                                                            className="login-input"
                                                            type="password"
                                                            autoComplete="current-password"
                                                            value={password}
                                                            onChange={(e) => setPassword(e.target.value)}
                                                            required
                                                            disabled={loading}
                                                          />
                                </label>label>
                        {error && <p className="login-error">{error}</p>p>}
                                <button className="btn-primary login-btn" type="submit" disabled={loading}>
                                  {loading ? "Signing in..." : "Sign in"}
                                </button>button>
                      </form>form>
              </div>div>
        </div>div>
      );
}</div>

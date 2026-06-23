import { Routes, Route, Link, NavLink, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import Decks from "./pages/Decks";
import Import from "./pages/Import";
import Study from "./pages/Study";
import AddCard from "./pages/AddCard";
import Login from "./pages/Login";
import ErrorBoundary from "./components/ErrorBoundary";
import { checkAuth, logout, getSessionToken } from "./lib/api";

function RequireAuth({ children }: { children: React.ReactNode }) {
    const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
        if (!getSessionToken()) {
                setAuthed(false);
                return;
        }
        checkAuth().then(setAuthed);
  }, []);

  if (authed === null) return null; // loading
  if (!authed) return <Navigate to="/login" replace />;
    return <>{children}</>>;
}

export default function App() {
    const location = useLocation();
  
    async function handleLogout() {
          await logout();
          window.location.href = "/login";
    }
  
    return (
          <>
                <Toaster position="top-center" theme="dark" richColors />
                <Routes location={location} key={location.pathname}>
                        <Route path="/login" element={<Login />} />
                        <Route
                                    path="/*"
                                    element={
                                                  <RequireAuth>
                                                                <motion.header
                                                                                  className="glass-panel app-header"
                                                                                  initial={{ opacity: 0 }}
                                                                                  animate={{ opacity: 1 }}
                                                                                  transition={{ duration: 0.3 }}
                                                                                >
                                                                                <Link to="/" className="app-title-link">
                                                                                                  <h1 className="app-title">FSRS Learn</h1>h1>
                                                                                </Link>Link>
                                                                                <nav className="nav-links">
                                                                                  {({ isActive }: { isActive: boolean }) => (
                                                                                                      <NavLink to="/" end className={`btn-secondary nav-btn${isActive ? " is-active" : ""}`}>
                                                                                                                            Decks
                                                                                                        </NavLink>NavLink>
                                                                                                  )}
                                                                                  {({ isActive }: { isActive: boolean }) => (
                                                                                                      <NavLink to="/add" className={`btn-secondary nav-btn${isActive ? " is-active" : ""}`}>
                                                                                                                            Add Card
                                                                                                        </NavLink>NavLink>
                                                                                                  )}
                                                                                  {({ isActive }: { isActive: boolean }) => (
                                                                                                      <NavLink to="/import" className={`btn-secondary nav-btn${isActive ? " is-active" : ""}`}>
                                                                                                                            Import
                                                                                                        </NavLink>NavLink>
                                                                                                  )}
                                                                                                  <button className="btn-secondary nav-btn" onClick={handleLogout}>
                                                                                                                      Sign out
                                                                                                    </button>button>
                                                                                </nav>nav>
                                                                </motion.header>motion.header>
                                                                <main className="main-content">
                                                                                <ErrorBoundary>
                                                                                                  <AnimatePresence mode="wait">
                                                                                                                      <Routes location={location} key={location.pathname}>
                                                                                                                                            <Route path="/" element={<Decks />} />
                                                                                                                                            <Route path="/add" element={<AddCard />} />
                                                                                                                                            <Route path="/import" element={<Import />} />
                                                                                                                                            <Route path="/study" element={<Study />} />
                                                                                                                        </Routes>Routes>
                                                                                                    </AnimatePresence>AnimatePresence>
                                                                                </ErrorBoundary>ErrorBoundary>
                                                                </main>main>
                                                  </RequireAuth>RequireAuth>
                          }
                                />
                        </Route>Routes>
                </Routes>>
            );
            }</></>

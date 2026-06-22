import { Routes, Route, Link, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Toaster } from "sonner";
import Decks from "./pages/Decks";
import Import from "./pages/Import";
import Study from "./pages/Study";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const location = useLocation();

  return (
    <>
      <Toaster position="top-center" theme="dark" richColors />
      <header className="glass-panel app-header">
        <Link to="/" className="app-title-link">
          <h1 className="app-title">FSRS Learn</h1>
        </Link>
        <nav className="nav-links">
          <Link to="/" className="btn-primary" style={{ marginRight: '0.5rem' }}>Decks</Link>
          <Link to="/import" className="btn-primary">Import</Link>
        </nav>
      </header>
      <main className="main-content">
        <ErrorBoundary>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Decks />} />
              <Route path="/import" element={<Import />} />
              <Route path="/study" element={<Study />} />
            </Routes>
          </AnimatePresence>
        </ErrorBoundary>
      </main>
    </>
  );
}

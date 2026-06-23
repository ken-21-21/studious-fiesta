import { Routes, Route, Link } from "react-router-dom";
import Decks from "./pages/Decks";
import Import from "./pages/Import";
import Study from "./pages/Study";
import AddCard from "./pages/AddCard";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <>
      <header className="glass-panel app-header">
        <Link to="/" className="app-title-link">
          <h1 className="app-title">FSRS Learn</h1>
        </Link>
        <nav className="nav-links">
          <Link to="/" className="nav-link"><button>Decks</button></Link>
          <Link to="/add" className="nav-link"><button>Add Card</button></Link>
          <Link to="/import" className="nav-link"><button>Import</button></Link>
        </nav>
      </header>
      <main className="main-content">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Decks />} />
            <Route path="/add" element={<AddCard />} />
            <Route path="/import" element={<Import />} />
            <Route path="/study" element={<Study />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  );
}

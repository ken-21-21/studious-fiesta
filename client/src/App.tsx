import { Routes, Route, Link } from "react-router-dom";
import Decks from "./pages/Decks";
import Import from "./pages/Import";
import Study from "./pages/Study";

export default function App() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: 24 }}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ margin: 0 }}>FSRS Learn</h1>
        </Link>
      </header>
      <Routes>
        <Route path="/" element={<Decks />} />
        <Route path="/import" element={<Import />} />
        <Route path="/study" element={<Study />} />
      </Routes>
    </div>
  );
}

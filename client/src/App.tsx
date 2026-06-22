import { Routes, Route, Link } from "react-router-dom";
import Decks from "./pages/Decks";
import Import from "./pages/Import";
import Study from "./pages/Study";

export default function App() {
  return (
    <>
      <header className="app-header">
        <Link to="/">
          <h1>FSRS Learn</h1>
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Decks />} />
          <Route path="/import" element={<Import />} />
          <Route path="/study" element={<Study />} />
        </Routes>
      </main>
    </>
  );
}

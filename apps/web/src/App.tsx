import type { JSX } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router";
import { Notice } from "./components/Notice";
import { useWideLayout } from "./hooks/useWideLayout";
import { BatchResultsPage } from "./pages/BatchResultsPage";
import { HomePage } from "./pages/HomePage";
import { QuoteHistoryPage } from "./pages/QuoteHistoryPage";
import { QuoteResultPage } from "./pages/QuoteResultPage";

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link is-active" : "nav-link";
}

export function App(): JSX.Element {
  const wide = useWideLayout();

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="brand">
            <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <path d="M12 1v22M1 12h22" />
            </svg>
            CAD Quote App
          </Link>
          <nav aria-label="Main" className="nav">
            <NavLink to="/" end className={navClassName}>
              New Quote
            </NavLink>
            {!wide && (
              <NavLink to="/quotes" className={navClassName}>
                History
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/quotes"
            element={wide ? <Navigate to="/" replace /> : <QuoteHistoryPage />}
          />
          <Route path="/quotes/batch" element={<BatchResultsPage />} />
          <Route path="/quotes/:id" element={<QuoteResultPage />} />
          <Route
            path="*"
            element={
              <Notice title="Page not found">
                <Link to="/">Start a new quote</Link>
              </Notice>
            }
          />
        </Routes>
      </main>
    </>
  );
}

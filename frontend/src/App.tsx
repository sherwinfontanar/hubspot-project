
import { useCallback, useEffect, useState } from "react";
import "./App.css";

type SyncAttempt = {
  id: number;
  order_id: string;
  status: "pending" | "processing" | "success" | "failed";
  attempt_count: number;
  contact_id: string | null;
  deal_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type AttemptsResponse = {
  count: number;
  attempts: SyncAttempt[];
};

function App() {
  const [attempts, setAttempts] = useState<SyncAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  

const loadAttempts = useCallback(async () => {
  try {
    const response = await fetch("/api/attempts");
    setError("");

    if (!response.ok) {
      throw new Error("Could not load sync attempts.");
    }

    const data: AttemptsResponse = await response.json();
    setAttempts(data.attempts);
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "An unexpected error occurred.",
    );
  } finally {
    setLoading(false);
  }
}, []);



  
useEffect(() => {
  let cancelled = false;

  async function fetchInitialAttempts() {
    try {
      const response = await fetch("/api/attempts");

      if (!response.ok) {
        throw new Error("Could not load sync attempts.");
      }

      const data: AttemptsResponse = await response.json();

      if (!cancelled) {
        setAttempts(data.attempts);
        setError("");
      }
    } catch (err) {
      if (!cancelled) {
        setError(
          err instanceof Error
            ? err.message
            : "An unexpected error occurred.",
        );
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  }

  void fetchInitialAttempts();

  return () => {
    cancelled = true;
  };
}, []);


  async function retryAttempt(id: number) {
    setRetryingId(id);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/attempts/${id}/retry`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? "Retry failed.");
      }

      setMessage(`Order ${data.order_id} synchronized successfully.`);
      await loadAttempts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
      await loadAttempts();
    } finally {
      setRetryingId(null);
    }
  }

  const successful = attempts.filter((item) => item.status === "success").length;
  const pending = attempts.filter(
    (item) => item.status === "pending" || item.status === "processing",
  ).length;
  const failed = attempts.filter((item) => item.status === "failed").length;

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">INTEGRATION MONITOR</p>
          <h1>Order Sync Dashboard</h1>
          <p className="subtitle">
            Monitor ecommerce orders synchronized with HubSpot.
          </p>
        </div>
        <button className="refresh-button" onClick={() => void loadAttempts()}>
          Refresh
        </button>
      </header>

      <section className="stats" aria-label="Sync statistics">
        <article className="stat-card">
          <span>Total records</span>
          <strong>{attempts.length}</strong>
        </article>
        <article className="stat-card">
          <span>Successful</span>
          <strong className="success-text">{successful}</strong>
        </article>
        <article className="stat-card">
          <span>Pending / processing</span>
          <strong>{pending}</strong>
        </article>
        <article className="stat-card">
          <span>Failed</span>
          <strong className="failed-text">{failed}</strong>
        </article>
      </section>

      {message && <p className="notice success-notice">{message}</p>}
      {error && <p className="notice error-notice">{error}</p>}

      <section className="table-section">
        <div className="section-heading">
          <div>
            <h2>Recent sync attempts</h2>
            <p>Showing up to 50 records, newest first.</p>
          </div>
          <span className="record-count">{attempts.length} records</span>
        </div>

        {loading ? (
          <p className="empty-state">Loading sync attempts...</p>
        ) : attempts.length === 0 ? (
          <p className="empty-state">No sync attempts found.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Contact ID</th>
                  <th>Deal ID</th>
                  <th>Last updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="order-id">{attempt.order_id}</td>
                    <td>
                      <span className={`status status-${attempt.status}`}>
                        {attempt.status}
                      </span>
                      {attempt.error_message && (
                        <p className="row-error">{attempt.error_message}</p>
                      )}
                    </td>
                    <td>{attempt.attempt_count}</td>
                    <td className="id-cell">{attempt.contact_id ?? "—"}</td>
                    <td className="id-cell">{attempt.deal_id ?? "—"}</td>
                    <td>{attempt.updated_at}</td>
                    <td>
                      {attempt.status === "failed" ? (
                        <button
                          className="retry-button"
                          disabled={retryingId !== null}
                          onClick={() => void retryAttempt(attempt.id)}
                        >
                          {retryingId === attempt.id ? "Retrying..." : "Retry"}
                        </button>
                      ) : (
                        <span className="no-action">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>HubSpot Order Sync · Local development dashboard</footer>
    </main>
  );
}

export default App;

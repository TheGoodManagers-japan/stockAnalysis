"use client";

/**
 * Shared add-to-portfolio popup form, used by both ScannerTable (table view)
 * and EnhancedStockCard (card view).
 *
 * Each parent passes its own CSS module `styles` so the popup inherits the
 * correct positioning (table drops down, card pops up).
 */
export default function AddToPortfolioPopup({
  tickerCode,
  form,
  setForm,
  status,
  onSubmit,
  onClose,
  popupRef,
  styles,
}) {
  return (
    <div className={styles.addPopup} ref={popupRef}>
      {status === "success" ? (
        <div
          style={{
            padding: 14,
            textAlign: "center",
            color: "var(--accent-green)",
            fontWeight: 600,
          }}
        >
          Added to portfolio!
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div
            style={{
              fontWeight: 600,
              marginBottom: 10,
              fontSize: "0.88rem",
            }}
          >
            Add {tickerCode} to Portfolio
          </div>
          <div className={styles.addPopupGrid}>
            <div>
              <label>Entry Price</label>
              <input
                type="number"
                value={form.entry_price}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entry_price: e.target.value }))
                }
                required
                step="any"
              />
            </div>
            <div>
              <label>Shares</label>
              <input
                type="number"
                value={form.shares}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shares: e.target.value }))
                }
                required
              />
            </div>
            <div>
              <label>Stop Loss</label>
              <input
                type="number"
                value={form.initial_stop}
                onChange={(e) =>
                  setForm((f) => ({ ...f, initial_stop: e.target.value }))
                }
                step="any"
              />
            </div>
            <div>
              <label>Target</label>
              <input
                type="number"
                value={form.price_target}
                onChange={(e) =>
                  setForm((f) => ({ ...f, price_target: e.target.value }))
                }
                step="any"
              />
            </div>
            <div>
              <label>Type</label>
              <select
                value={form.entry_kind}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entry_kind: e.target.value }))
                }
              >
                <option value="DIP">DIP</option>
                <option value="BREAKOUT">BREAKOUT</option>
                <option value="RETEST">RETEST</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <div>
              <label>Date</label>
              <input
                type="date"
                value={form.entry_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entry_date: e.target.value }))
                }
              />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Reason</label>
            <input
              type="text"
              value={form.entry_reason}
              onChange={(e) =>
                setForm((f) => ({ ...f, entry_reason: e.target.value }))
              }
              style={{ width: "100%" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 12,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Adding..." : "Add"}
            </button>
          </div>
          {status === "error" && (
            <div
              style={{
                color: "var(--accent-red)",
                fontSize: "0.78rem",
                marginTop: 6,
              }}
            >
              Failed to add. Please try again.
            </div>
          )}
        </form>
      )}
    </div>
  );
}

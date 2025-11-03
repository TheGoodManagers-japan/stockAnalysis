#!/usr/bin/env python3
# compare_buynow_simple.py
#
# Minimal CLI: compare signal.buyNow True vs False from your backtest JSON.
# Text output only. No options, no CSV.
#
# Usage:
#   python compare_buynow_simple.py path/to/backtest.json

import json
import math
import os
import sys
from collections import Counter
from statistics import median

def fmt(x, p=2):
    if x is None:
        return ""
    try:
        xv = float(x)
        if math.isinf(xv):
            return "∞"
        if math.isnan(xv):
            return "NaN"
        return f"{xv:.{p}f}"
    except Exception:
        return str(x)

def pct(n, d):
    return (100.0 * n / d) if d else float("nan")

def safe_mean(xs):
    ys = []
    for v in xs:
        try:
            y = float(v)
            if math.isfinite(y):
                ys.append(y)
        except Exception:
            pass
    return sum(ys) / len(ys) if ys else float("nan")

def safe_median(xs):
    ys = []
    for v in xs:
        try:
            y = float(v)
            if math.isfinite(y):
                ys.append(y)
        except Exception:
            pass
    return median(ys) if ys else float("nan")

def profit_factor(rows):
    # PF = sum(positive R) / sum(abs(negative R))
    gains = 0.0
    losses = 0.0
    for r in rows:
        R = (r.get("simulation") or {}).get("R")
        try:
            R = float(R)
        except Exception:
            R = 0.0
        if R > 0:
            gains += R
        elif R < 0:
            losses += -R
    if losses == 0:
        return float("inf") if gains > 0 else float("nan")
    return gains / losses

def summarize(rows):
    n = len(rows)
    wins = sum(1 for r in rows if (r.get("simulation") or {}).get("result") == "WIN")
    losses = sum(1 for r in rows if (r.get("simulation") or {}).get("result") == "LOSS")
    ex = Counter((r.get("simulation") or {}).get("exitType") for r in rows)

    R_vals = [(r.get("simulation") or {}).get("R") for r in rows]
    ret_vals = [(r.get("simulation") or {}).get("returnPct") for r in rows]
    rr_vals = [(r.get("risk") or {}).get("rrAtEntry") for r in rows]
    hold_days = [(r.get("simulation") or {}).get("holdingDays") for r in rows]
    mae_vals = [(r.get("simulation") or {}).get("maePct") for r in rows]
    mfe_vals = [(r.get("simulation") or {}).get("mfePct") for r in rows]

    return {
        "n": n,
        "wins": wins,
        "win_rate_%": pct(wins, n),
        "avg_R": safe_mean(R_vals),
        "med_R": safe_median(R_vals),
        "exp_R": safe_mean(R_vals),  # expectancy in R
        "profit_factor": profit_factor(rows),
        "avg_return_%": safe_mean(ret_vals),
        "avg_hold_days": safe_mean(hold_days),
        "target_hit_%": pct(ex.get("TARGET", 0), n),
        "stop_hit_%": pct(ex.get("STOP", 0), n),
        "time_exit_%": pct(ex.get("TIME", 0), n),
        "avg_rr_at_entry": safe_mean(rr_vals),
        "avg_mae_%": safe_mean(mae_vals),
        "avg_mfe_%": safe_mean(mfe_vals),
    }

def print_table(title, s):
    headers = [
        ("Trades",          s["n"]),
        ("Wins",            s["wins"]),
        ("Win rate %",      fmt(s["win_rate_%"])),
        ("Avg R",           fmt(s["avg_R"])),
        ("Med R",           fmt(s["med_R"])),
        ("Expectancy R",    fmt(s["exp_R"])),
        ("Profit factor",   fmt(s["profit_factor"])),
        ("Avg return %",    fmt(s["avg_return_%"])),
        ("Avg hold (days)", fmt(s["avg_hold_days"])),
        ("Target hit %",    fmt(s["target_hit_%"])),
        ("Stop hit %",      fmt(s["stop_hit_%"])),
        ("Time exit %",     fmt(s["time_exit_%"])),
        ("Avg RR at entry", fmt(s["avg_rr_at_entry"])),
        ("Avg MAE %",       fmt(s["avg_mae_%"])),
        ("Avg MFE %",       fmt(s["avg_mfe_%"])),
    ]
    width_k = max(len(k) for k,_ in headers)
    width_v = max(len(str(v)) for _,v in headers)
    bar = "-" * (width_k + width_v + 5)
    print(f"\n{title}\n{bar}")
    for k, v in headers:
        print(f"{k.ljust(width_k)} : {str(v).rjust(width_v)}")
    print(bar)

def main():
    if len(sys.argv) != 2:
        print("Usage: python compare_buynow_simple.py path/to/backtest.json", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Failed to read JSON: {e}", file=sys.stderr)
        sys.exit(1)

    events = data.get("events")
    if not isinstance(events, list):
        print("No events[] found in JSON.", file=sys.stderr)
        sys.exit(1)

    # Partition by signal.buyNow boolean
    buy_true = []
    buy_false = []
    for r in events:
        bn = ((r.get("signal") or {}).get("buyNow") is True)
        if bn:
            buy_true.append(r)
        else:
            buy_false.append(r)

    # Summaries
    s_true = summarize(buy_true)
    s_false = summarize(buy_false)

    # Overall header
    ver = data.get("version")
    dfrom = data.get("from")
    dto = data.get("to")
    total_n = len(events)

    print("BUY NOW COMPARISON REPORT")
    print("==========================")
    if ver is not None:
        print(f"Version : {ver}")
    if dfrom or dto:
        print(f"Range   : {dfrom or '?'} → {dto or '?'}")
    print(f"Total events: {total_n}")
    print("==========================")

    print_table("Group: buyNow = TRUE", s_true)
    print_table("Group: buyNow = FALSE", s_false)

    # Delta section (True minus False)
    def delta(a, b, key):
        av = a.get(key)
        bv = b.get(key)
        try:
            av = float(av)
            bv = float(bv)
            if math.isfinite(av) and math.isfinite(bv):
                return av - bv
            return float("nan")
        except Exception:
            return float("nan")

    deltas = {
        "win_rate_%": delta(s_true, s_false, "win_rate_%"),
        "avg_R": delta(s_true, s_false, "avg_R"),
        "med_R": delta(s_true, s_false, "med_R"),
        "exp_R": delta(s_true, s_false, "exp_R"),
        "profit_factor": delta(s_true, s_false, "profit_factor"),
        "avg_return_%": delta(s_true, s_false, "avg_return_%"),
        "avg_hold_days": delta(s_true, s_false, "avg_hold_days"),
        "target_hit_%": delta(s_true, s_false, "target_hit_%"),
        "stop_hit_%": delta(s_true, s_false, "stop_hit_%"),
        "time_exit_%": delta(s_true, s_false, "time_exit_%"),
        "avg_rr_at_entry": delta(s_true, s_false, "avg_rr_at_entry"),
        "avg_mae_%": delta(s_true, s_false, "avg_mae_%"),
        "avg_mfe_%": delta(s_true, s_false, "avg_mfe_%"),
    }

    width_k = max(len(k) for k in deltas.keys())
    width_v = max(len(fmt(v)) for v in deltas.values())
    bar = "-" * (width_k + width_v + 5)
    print("\nΔ True - False")
    print(bar)
    for k, v in deltas.items():
        print(f"{k.ljust(width_k)} : {fmt(v).rjust(width_v)}")
    print(bar)

if __name__ == "__main__":
    main()

"use client";

import { useEffect, useRef, useMemo } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

function computeSMA(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

function computeRSI(data, period = 14) {
  const result = [];
  if (data.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: data[period].time, value: 100 - 100 / (1 + rs) });

  // Subsequent values using smoothed averages
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: data[i].time, value: rsi });
  }
  return result;
}

function computeBollingerBands(data, period = 20, stdDev = 2) {
  const upper = [];
  const lower = [];
  const middle = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (data[j].close - mean) ** 2;
    }
    const std = Math.sqrt(sqSum / period);

    const t = data[i].time;
    middle.push({ time: t, value: mean });
    upper.push({ time: t, value: mean + stdDev * std });
    lower.push({ time: t, value: mean - stdDev * std });
  }

  return { upper, middle, lower };
}

const MA_CONFIG = [
  { period: 5, color: "#ffeb3b", width: 1 },
  { period: 25, color: "#ff9800", width: 1 },
  { period: 50, color: "#2196f3", width: 1.5 },
  { period: 75, color: "#9c27b0", width: 1 },
  { period: 200, color: "#e91e63", width: 2 },
];

export default function PriceChart({ history, scan }) {
  const containerRef = useRef(null);
  const rsiContainerRef = useRef(null);
  const chartRef = useRef(null);
  const rsiChartRef = useRef(null);

  // Memoize OHLC formatting — only recalculates when history changes
  const ohlc = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history.map((bar) => {
      const d = new Date(bar.date);
      return {
        time: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume) || 0,
      };
    });
  }, [history]);

  // Memoize indicator computations — only recalculates when ohlc changes
  const indicators = useMemo(() => {
    if (ohlc.length === 0) return null;
    const smas = MA_CONFIG
      .filter((ma) => ohlc.length > ma.period)
      .map((ma) => ({ ...ma, data: computeSMA(ohlc, ma.period) }));
    const bb = ohlc.length >= 20 ? computeBollingerBands(ohlc, 20, 2) : null;
    const rsi = ohlc.length > 14 ? computeRSI(ohlc, 14) : null;
    return { smas, bb, rsi };
  }, [ohlc]);

  useEffect(() => {
    if (!containerRef.current || ohlc.length === 0) return;

    const container = containerRef.current;

    // --- Main price chart ---
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(ohlc);

    // Bollinger Bands overlay (from memoized indicators)
    if (indicators?.bb) {
      const bbUpper = chart.addLineSeries({
        color: "rgba(100, 181, 246, 0.4)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bbUpper.setData(indicators.bb.upper);

      const bbLower = chart.addLineSeries({
        color: "rgba(100, 181, 246, 0.4)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bbLower.setData(indicators.bb.lower);

      const bbMiddle = chart.addLineSeries({
        color: "rgba(100, 181, 246, 0.2)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bbMiddle.setData(indicators.bb.middle);
    }

    // MA overlays (from memoized indicators)
    if (indicators?.smas) {
      for (const ma of indicators.smas) {
        const lineSeries = chart.addLineSeries({
          color: ma.color,
          lineWidth: ma.width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSeries.setData(ma.data);
      }
    }

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeries.setData(
      ohlc.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color:
          bar.close >= bar.open
            ? "rgba(34,197,94,0.25)"
            : "rgba(239,68,68,0.25)",
      }))
    );

    // Price lines for stop loss and target
    if (scan?.stop_loss) {
      candleSeries.createPriceLine({
        price: Number(scan.stop_loss),
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Stop",
      });
    }
    if (scan?.price_target) {
      candleSeries.createPriceLine({
        price: Number(scan.price_target),
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Target",
      });
    }
    if (scan?.limit_buy_order) {
      candleSeries.createPriceLine({
        price: Number(scan.limit_buy_order),
        color: "#3b82f6",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Limit",
      });
    }

    chart.timeScale().fitContent();

    // --- RSI sub-chart ---
    let rsiChart = null;
    if (rsiContainerRef.current && indicators?.rsi) {
      rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#94a3b8",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.04)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,0.1)",
          scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.1)",
          timeVisible: false,
          visible: true,
        },
        handleScroll: true,
        handleScale: true,
      });
      rsiChartRef.current = rsiChart;

      const rsiData = indicators.rsi;

      const rsiSeries = rsiChart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      rsiSeries.setData(rsiData);

      // Overbought line (70)
      const overbought = rsiChart.addLineSeries({
        color: "rgba(239, 68, 68, 0.4)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      overbought.setData(
        rsiData.map((d) => ({ time: d.time, value: 70 }))
      );

      // Oversold line (30)
      const oversold = rsiChart.addLineSeries({
        color: "rgba(34, 197, 94, 0.4)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      oversold.setData(
        rsiData.map((d) => ({ time: d.time, value: 30 }))
      );

      // Middle line (50)
      const midline = rsiChart.addLineSeries({
        color: "rgba(148, 163, 184, 0.2)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      midline.setData(
        rsiData.map((d) => ({ time: d.time, value: 50 }))
      );

      rsiChart.timeScale().fitContent();

      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) chart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // Resize handling
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        chart.applyOptions({ width });
        if (rsiChart) rsiChart.applyOptions({ width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      if (rsiChart) {
        rsiChart.remove();
        rsiChartRef.current = null;
      }
    };
  }, [ohlc, indicators, scan]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: 400 }}
      />
      {/* MA + BB Legend */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          display: "flex",
          gap: 12,
          fontSize: "0.7rem",
          opacity: 0.7,
        }}
      >
        {MA_CONFIG.map((ma) => (
          <span key={ma.period} style={{ color: ma.color }}>
            MA{ma.period}
          </span>
        ))}
        <span style={{ color: "rgba(100, 181, 246, 0.7)" }}>BB(20,2)</span>
      </div>

      {/* RSI sub-pane */}
      {history && history.length > 14 && (
        <div style={{ marginTop: 4 }}>
          <div
            style={{
              fontSize: "0.72rem",
              color: "#94a3b8",
              marginBottom: 2,
              paddingLeft: 4,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <span style={{ color: "#a78bfa", fontWeight: 600 }}>RSI(14)</span>
            <span style={{ color: "rgba(239,68,68,0.6)", fontSize: "0.65rem" }}>70</span>
            <span style={{ color: "rgba(34,197,94,0.6)", fontSize: "0.65rem" }}>30</span>
          </div>
          <div
            ref={rsiContainerRef}
            style={{ width: "100%", height: 120 }}
          />
        </div>
      )}
    </div>
  );
}

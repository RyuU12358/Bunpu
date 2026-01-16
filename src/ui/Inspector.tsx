import { useEffect, useState } from "react";
import { graph } from "../graphInstance";
import { Dist } from "../core/dist";
import "./Inspector.css";

interface InspectorProps {
  selectedId: string | null;
  externalTick: number;
}

import { useTranslation } from "./i18n";

export const Inspector = ({ selectedId, externalTick }: InspectorProps) => {
  const [, setTick] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    // eslint-disable-next-line
    setTick((t) => t + 1);
  }, [externalTick, selectedId]);

  if (!selectedId) {
    return <div className="inspector-empty">{t("selectCell")}</div>;
  }

  const cell = graph.getCell(selectedId);
  if (!cell) return <div className="inspector-empty">{t("cellNotFound")}</div>;

  const dist = cell.value;
  if (!dist || dist.components.length === 0) {
    return (
      <div className="inspector">
        <h3>Cell {selectedId}</h3>
        <div className="info">{t("empty")}</div>
      </div>
    );
  }

  const mean = dist.mean();
  let variance = 0;
  let std = 0;
  let median = 0;

  // Safe calculation just in case
  try {
    variance = dist.variance();
    std = dist.std();
    median = dist.median();
  } catch (e) {
    console.error(e);
  }

  return (
    <div className="inspector">
      <div className="inspector-header">
        <h3>Cell {selectedId}</h3>
        <span className={`status-badge ${cell.status}`}>{cell.status}</span>
      </div>

      {cell.status === "error" && (
        <div className="error-msg">{cell.error || t("unknownError")}</div>
      )}

      <div className="stats-grid">
        <div className="stat-item">
          <label>{t("mean")}</label>
          <div className="value">{mean.toFixed(4)}</div>
        </div>
        <div className="stat-item">
          <label>{t("variance")}</label>
          <div className="value">{variance.toFixed(4)}</div>
        </div>
        <div className="stat-item">
          <label>{t("stdDev")}</label>
          <div className="value">{std.toFixed(4)}</div>
        </div>
        <div className="stat-item">
          <label>{t("median")}</label>
          <div className="value">{median.toFixed(4)}</div>
        </div>
        <div className="stat-item">
          <label>{t("comps")}</label>
          <div className="value">{dist.components.length}</div>
        </div>
      </div>

      <div className="chart-container">
        <h4>{t("distShape")}</h4>
        <InspectorChart dist={dist} />
      </div>
    </div>
  );
};

const InspectorChart = ({ dist }: { dist: Dist }) => {
  // Determine range
  let min = Infinity,
    max = -Infinity;
  dist.components.forEach((c) => {
    if (c.type === "atom") {
      min = Math.min(min, c.x);
      max = Math.max(max, c.x);
    } else if (c.type === "bin") {
      min = Math.min(min, c.a);
      max = Math.max(max, c.b);
    } else if (c.type === "tail") {
      if (c.side === "right") min = Math.min(min, c.x0);
      else max = Math.max(max, c.x0);
    }
  });

  if (min === Infinity) return null;

  // Add margin
  const range = max - min || 1;
  const padding = range * 0.1;
  const vMin = min - padding;
  const vMax = max + padding;
  const vRange = vMax - vMin || 1;

  const toX = (val: number) => ((val - vMin) / vRange) * 100;

  return (
    <svg
      viewBox="0 0 100 60"
      className="inspector-svg"
      preserveAspectRatio="none"
    >
      {/* Axis Line */}
      <line x1="0" y1="55" x2="100" y2="55" stroke="#ccc" strokeWidth="0.5" />

      {dist.components.map((c, i) => {
        const color = c.type === "tail" ? "red" : "blue";
        const opacity = 0.6;

        if (c.type === "atom") {
          const x = toX(c.x);
          const h = c.p * 50; // Scale height?
          return (
            <line
              key={i}
              x1={x}
              y1={55}
              x2={x}
              y2={55 - h}
              stroke={color}
              strokeWidth="2"
            />
          );
        } else if (c.type === "bin") {
          const x1 = toX(c.a);
          const x2 = toX(c.b);
          const w = Math.max(0.5, x2 - x1);
          const h = c.p * 50;
          return (
            <rect
              key={i}
              x={x1}
              y={55 - h}
              width={w}
              height={h}
              fill={color}
              fillOpacity={opacity}
            />
          );
        } else if (c.type === "tail") {
          // Draw a fading rect or path?
          // Tail is hard to visualize on linear scale if it goes to infinity.
          // Just draw a marker start -> direction
          const x0 = toX(c.x0);
          const dir = c.side === "right" ? 10 : -10;
          return (
            <path
              key={i}
              d={`M ${x0} 55 L ${x0} ${55 - c.mass * 50} L ${x0 + dir} 55 Z`}
              fill="orange"
              opacity="0.5"
            />
          );
        }
        return null;
      })}

      {/* Min/Max Labels */}
      <text x="0" y="65" fontSize="3" fill="#666">
        {vMin.toFixed(1)}
      </text>
      <text x="90" y="65" fontSize="3" fill="#666">
        {vMax.toFixed(1)}
      </text>
    </svg>
  );
};

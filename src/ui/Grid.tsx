import { useState, useEffect, useRef, useCallback } from "react";
import { Cell } from "../engine/cell";
import { Dist } from "../core/dist";
import "./Grid.css";

import { graph } from "../graphInstance";

const INITIAL_ROWS = 50;
const INITIAL_COLS = 26;

interface GridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: () => void;
  onStartTyping?: (char: string) => void;
  externalTick: number; // To force re-render when external update happens
}

function colIndexToLabel(index: number): string {
  let label = "";
  let i = index;
  while (i >= 0) {
    label = String.fromCharCode((i % 26) + 65) + label;
    i = Math.floor(i / 26) - 1;
  }
  return label;
}

function labelToColIndex(label: string): number {
  let index = 0;
  for (let i = 0; i < label.length; i++) {
    index = index * 26 + (label.charCodeAt(i) - 64);
  }
  return index - 1;
}

export const Grid = ({
  selectedId,
  onSelect,
  onUpdate,
  onStartTyping,
  externalTick,
}: GridProps) => {
  const [, setTick] = useState(0);
  const [rowCount, setRowCount] = useState(INITIAL_ROWS);
  const [colCount, setColCount] = useState(INITIAL_COLS);

  // Virtualization State
  const [scrollState, setScrollState] = useState({ top: 0, left: 0 });
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  const CELL_WIDTH = 120;
  const CELL_HEIGHT = 32;
  const HEADER_HEIGHT = 30;
  const ROW_HEADER_WIDTH = 50;

  // Force update and expansion logic
  useEffect(() => {
    // We don't need to manually tick if we rely on re-renders from parent
    // or we can use a ref to track processing.
    // The issue is calling setTick immediately.
    // Let's just remove setTick here because externalTick forces re-render of THIS component anyway?
    // Wait, externalTick is a prop. If prop changes, component re-renders.
    // So we don't need local state update to force re-render.
    // But we use 'tick' state?
    // It seems 'tick' state is unused except to force update?
    // Let's check usage.
    // If 'tick' is not used, remove it.
    // But update() calls setTick.
    // Let's just remove the setTick call locally in this effect.

    let maxR = rowCount;
    let maxC = colCount;
    let expanded = false;

    const all = graph.getAllCells();
    for (const cell of all) {
      const match = cell.id.match(/([A-Z]+)(\d+)/);
      if (match) {
        const c = labelToColIndex(match[1]);
        const r = parseInt(match[2]);
        if (r > maxR) {
          maxR = r;
          expanded = true;
        }
        if (c + 1 > maxC) {
          maxC = c + 1;
          expanded = true;
        }
      }
    }

    if (expanded) {
      // eslint-disable-next-line
      setRowCount(Math.max(maxR + 10, rowCount));

      setColCount(Math.max(maxC + 5, colCount));
    }
    // eslint-disable-next-line
  }, [externalTick, selectedId]);

  const update = () => {
    setTick((t) => t + 1);
    onUpdate();
  };

  const handleInput = (id: string, val: string) => {
    graph.setCellInput(id, val);
    update();
  };

  // Resize observer to get view size
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Infinite Scroll & Scroll Tracking
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const {
      scrollTop,
      scrollLeft,
      scrollHeight,
      clientHeight,
      scrollWidth,
      clientWidth,
    } = containerRef.current;

    setScrollState({ top: scrollTop, left: scrollLeft });

    const bottomThreshold = 200;
    const rightThreshold = 200;

    if (scrollHeight - scrollTop - clientHeight < bottomThreshold) {
      setRowCount((r) => r + 20);
    }
    if (scrollWidth - scrollLeft - clientWidth < rightThreshold) {
      setColCount((c) => c + 5);
    }
  }, []);

  // Calculate visible range
  // We add buffer to prevent flicker
  const bufferRows = 5;
  const bufferCols = 2;

  const startRow = Math.max(
    0,
    Math.floor((scrollState.top - HEADER_HEIGHT) / CELL_HEIGHT) - bufferRows
  );
  const endRow = Math.min(
    rowCount,
    Math.ceil((scrollState.top + viewSize.height) / CELL_HEIGHT) + bufferRows
  );

  const startCol = Math.max(
    0,
    Math.floor((scrollState.left - ROW_HEADER_WIDTH) / CELL_WIDTH) - bufferCols
  );
  const endCol = Math.min(
    colCount,
    Math.ceil((scrollState.left + viewSize.width) / CELL_WIDTH) + bufferCols
  );

  // Navigation Logic
  const moveSelection = useCallback(
    (rowDelta: number, colDelta: number) => {
      if (!selectedId) return;
      const match = selectedId.match(/([A-Z]+)(\d+)/);
      if (!match) return;

      const colStr = match[1];
      const rowNum = parseInt(match[2]);
      const colIdx = labelToColIndex(colStr);

      let newRow = rowNum + rowDelta;
      let newCol = colIdx + colDelta;

      if (newRow < 1) newRow = 1;
      if (newRow > rowCount) setRowCount((r) => Math.max(r, newRow + 10));

      if (newCol < 0) newCol = 0;
      if (newCol >= colCount) setColCount((c) => Math.max(c, newCol + 5));

      const newId = `${colIndexToLabel(newCol)}${newRow}`;
      onSelect(newId);
    },
    [selectedId, rowCount, colCount, onSelect]
  );

  // Generate Visible Cells
  const visibleCells = [];

  // Determine active row/col for highlighting
  let activeColIndex = -1;
  let activeRowIndex = -1;
  if (selectedId) {
    const match = selectedId.match(/([A-Z]+)(\d+)/);
    if (match) {
      activeColIndex = labelToColIndex(match[1]);
      activeRowIndex = parseInt(match[2]) - 1;
    }
  }

  // 1. Column Headers
  const colHeaders = [];
  for (let c = startCol; c < endCol; c++) {
    const left = ROW_HEADER_WIDTH + c * CELL_WIDTH;
    const isSelected = c === activeColIndex;
    colHeaders.push(
      <div
        key={`h-col-${c}`}
        className={`grid-header-col ${isSelected ? "selected" : ""}`}
        style={{
          left,
          top: scrollState.top, // Virtual Sticky
          width: CELL_WIDTH,
          zIndex: 15,
        }}
      >
        {colIndexToLabel(c)}
      </div>
    );
  }

  // 2. Row Headers
  const rowHeaders = [];
  for (let r = startRow; r < endRow; r++) {
    const top = HEADER_HEIGHT + r * CELL_HEIGHT;
    const isSelected = r === activeRowIndex;
    rowHeaders.push(
      <div
        key={`h-row-${r}`}
        className={`grid-header-row ${isSelected ? "selected" : ""}`}
        style={{
          top,
          left: scrollState.left, // Virtual Sticky
          height: CELL_HEIGHT,
          zIndex: 15,
        }}
      >
        {r + 1}
      </div>
    );
  }

  // 3. Cells
  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const id = `${colIndexToLabel(c)}${r + 1}`;
      const top = HEADER_HEIGHT + r * CELL_HEIGHT;
      const left = ROW_HEADER_WIDTH + c * CELL_WIDTH;
      const cellData = graph.getCell(id);

      visibleCells.push(
        <GridCell
          key={id}
          id={id}
          cell={cellData}
          selected={selectedId === id}
          onSelect={() => onSelect(id)}
          onCommit={(val) => handleInput(id, val)}
          onNavigate={moveSelection}
          style={{
            top,
            left,
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
          }}
        />
      );
    }
  }

  // Corner Header
  const rootHeader = (
    <div
      className="grid-header-root"
      style={{
        top: scrollState.top,
        left: scrollState.left,
      }}
    />
  );

  const totalWidth = ROW_HEADER_WIDTH + colCount * CELL_WIDTH;
  const totalHeight = HEADER_HEIGHT + rowCount * CELL_HEIGHT;

  // Keyboard Navigation & Interaction
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      // If editing in cell or inputs, don't nav
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (!selectedId) return;

      const isModifier = e.ctrlKey || e.metaKey || e.altKey;

      // 1. Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleInput(selectedId, "");
        return;
      }

      // 2. Copy
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        const cell = graph.getCell(selectedId);
        await navigator.clipboard.writeText(cell.rawInput || "");
        return;
      }

      // 3. Paste
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            handleInput(selectedId, text);
          }
        } catch (err) {
          console.error("Paste failed", err);
        }
        return;
      }

      // 4. Directional Nav
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1, 0);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1, 0);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection(0, -1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection(0, 1);
        return;
      }

      // 5. Enter (Down) / Tab (Right)
      if (e.key === "Enter") {
        e.preventDefault();
        moveSelection(1, 0);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        moveSelection(0, 1);
        return;
      }

      // 6. Direct Typing
      if (!isModifier && e.key.length === 1) {
        e.preventDefault();
        onStartTyping?.(e.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line
  }, [selectedId, onSelect, rowCount, colCount, onStartTyping, moveSelection]);

  return (
    <div ref={containerRef} className="grid-container" onScroll={handleScroll}>
      <div
        className="grid-canvas"
        style={{ width: totalWidth, height: totalHeight }}
      >
        {colHeaders}
        {rowHeaders}
        {visibleCells}
        {rootHeader}
      </div>
    </div>
  );
};

const GridCell = ({
  cell,
  selected,
  onSelect,
  onCommit,
  onNavigate,
  style,
}: {
  id?: string;
  cell: Cell;
  selected: boolean;
  onSelect: () => void;
  onCommit: (val: string) => void;
  onNavigate: (r: number, c: number) => void;
  style?: React.CSSProperties;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cell.rawInput);
  const [lastRaw, setLastRaw] = useState(cell.rawInput);

  if (cell.rawInput !== lastRaw) {
    setLastRaw(cell.rawInput);
    setDraft(cell.rawInput);
  }

  // If selected changed to false, stop editing?
  useEffect(() => {
    // eslint-disable-next-line
    if (!selected) setEditing(false);
  }, [selected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setEditing(false);
      onCommit(draft);
      onNavigate(1, 0); // Move Down
    }
    if (e.key === "Tab") {
      e.preventDefault();
      setEditing(false);
      onCommit(draft);
      onNavigate(0, 1); // Move Right
    }
  };

  const handleDoubleClick = () => {
    setEditing(true);
    onSelect();
  };

  return (
    <div
      className={`grid-cell ${selected ? "selected" : ""} ${
        cell.status === "error"
          ? "error"
          : cell.status === "evaluating"
          ? "evaluating"
          : ""
      }`}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      style={style}
    >
      {editing ? (
        <input
          autoFocus={true}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onCommit(draft);
          }}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className="cell-content">
          <DistVisualizer
            dist={cell.value}
            fallback={!cell.rawInput.startsWith("=") ? cell.rawInput : ""}
          />
          {/* Error handled by CSS ::after */}
        </div>
      )}
    </div>
  );
};

const formatNumber = (num: number): string => {
  if (Math.abs(num) < 1e-6) return "0";
  if (Math.abs(num) < 0.01) return num.toPrecision(3);
  if (Number.isInteger(num)) return num.toString();
  return num.toFixed(2);
};

const DistVisualizer = ({
  dist,
  fallback,
}: {
  dist: Dist;
  fallback?: string;
}) => {
  if (!dist || dist.components.length === 0) {
    if (fallback) return <span className="text-cell">{fallback}</span>;
    return <span className="empty-cell"></span>;
  }

  // Single scalar display optimization
  if (dist.components.length === 1 && dist.components[0].type === "atom") {
    return (
      <span className="scalar-cell">{formatNumber(dist.components[0].x)}</span>
    );
  }

  let min = Infinity,
    max = -Infinity;
  dist.components.forEach((c) => {
    if (c.type === "atom") {
      min = Math.min(min, c.x);
      max = Math.max(max, c.x);
    } else if (c.type === "bin") {
      min = Math.min(min, c.a);
      max = Math.max(max, c.b);
    }
  });

  if (dist.components.length === 1 && dist.components[0].type === "atom") {
    return (
      <span className="scalar-cell">{dist.components[0].x.toFixed(2)}</span>
    );
  }

  if (min === Infinity) return null;

  const margin = (max - min) * 0.1 || 1;
  const vMin = min - margin;
  const vMax = max + margin;
  const range = vMax - vMin || 1;
  const toX = (v: number) => ((v - vMin) / range) * 100;

  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="dist-spark">
      {dist.components.map((c, i) => {
        if (c.type === "atom") {
          const x = toX(c.x);
          const h = c.p * 20;
          return (
            <line
              key={i}
              x1={x}
              y1={20}
              x2={x}
              y2={20 - h}
              stroke="blue"
              strokeWidth="2"
            />
          );
        } else if (c.type === "bin") {
          const x1 = toX(c.a);
          const x2 = toX(c.b);
          const w = Math.max(1, x2 - x1);
          const h = c.p * 20;
          return (
            <rect
              key={i}
              x={x1}
              y={20 - h}
              width={w}
              height={h}
              fill="rgba(0,0,255,0.3)"
            />
          );
        }
        return null;
      })}
    </svg>
  );
};

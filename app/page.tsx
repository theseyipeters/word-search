"use client";

import { useCallback, useRef } from "react";
import { useWordSearch, type Position } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";
import { useTimer } from "@/lib/useTimer";

function posFromEvent(
  e: React.MouseEvent | React.TouchEvent,
  gridRef: React.RefObject<HTMLDivElement | null>
): Position | null {
  const rect = gridRef.current?.getBoundingClientRect();
  if (!rect) return null;

  let clientX: number, clientY: number;
  if ("touches" in e) {
    if (e.touches.length === 0) return null;
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const cellSize = rect.width / 14;
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (row < 0 || row >= 14 || col < 0 || col >= 14) return null;
  return { row, col };
}

export default function Home() {
  const {
    grid,
    placed,
    foundWords,
    foundCells,
    selectedCells,
    isComplete,
    startSelect,
    moveSelect,
    endSelect,
    newGame,
    getSelectionLine,
    lastFoundCells,
    showLastFound,
  } = useWordSearch();

  const { theme, toggle } = useTheme();
  const { formatted, reset } = useTimer(isComplete);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleNewGame = useCallback(() => {
    newGame();
    reset();
  }, [newGame, reset]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = posFromEvent(e, gridRef);
      if (pos) startSelect(pos);
    },
    [startSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = posFromEvent(e, gridRef);
      if (pos) moveSelect(pos);
    },
    [moveSelect]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const pos = posFromEvent(e, gridRef);
      if (pos) startSelect(pos);
    },
    [startSelect]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const pos = posFromEvent(e, gridRef);
      if (pos) moveSelect(pos);
    },
    [moveSelect]
  );

  const selLine = getSelectionLine();

  const placedWords = placed.map((p) => p.word);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Word Search</h1>
          <span style={styles.subtitle}>
            {foundWords.size}/{placedWords.length} found
          </span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.timer}>{formatted}</span>
          <button onClick={toggle} style={styles.themeBtn} title="Toggle theme">
            {theme === "dark" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button onClick={handleNewGame} style={styles.newGameBtn}>
            New Game
          </button>
        </div>
      </header>

      <div style={styles.gameArea}>
        <div
          ref={gridRef}
          style={styles.grid}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endSelect}
          onMouseLeave={endSelect}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={endSelect}
        >
          {selLine && (
            <svg style={styles.svgOverlay}>
              <line
                x1={`${((selLine.start.col + 0.5) / 14) * 100}%`}
                y1={`${((selLine.start.row + 0.5) / 14) * 100}%`}
                x2={`${((selLine.end.col + 0.5) / 14) * 100}%`}
                y2={`${((selLine.end.row + 0.5) / 14) * 100}%`}
                stroke="var(--highlight-line)"
                strokeWidth="calc(100% / 14 - 4px)"
                strokeLinecap="round"
              />
            </svg>
          )}
          {grid.map((row, r) =>
            row.map((letter, c) => {
              const key = `${r},${c}`;
              const isFound = foundCells.has(key);
              const isSelected = selectedCells.has(key);
              const isJustFound = showLastFound && lastFoundCells.has(key);

              return (
                <div
                  key={key}
                  style={{
                    ...styles.cell,
                    ...(isSelected ? styles.cellSelected : {}),
                    ...(isFound && !isSelected ? styles.cellFound : {}),
                    ...(isJustFound ? styles.cellJustFound : {}),
                  }}
                >
                  <span
                    style={{
                      ...styles.cellLetter,
                      ...(isSelected ? { color: "var(--cell-selected-text)" } : {}),
                      ...(isFound && !isSelected
                        ? { color: "var(--cell-found-text)" }
                        : {}),
                    }}
                  >
                    {letter}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div style={styles.wordList}>
          <h2 style={styles.wordListTitle}>Words</h2>
          <div style={styles.words}>
            {placedWords.map((word) => {
              const isFound = foundWords.has(word);
              return (
                <span
                  key={word}
                  style={{
                    ...styles.word,
                    ...(isFound ? styles.wordFound : {}),
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {isComplete && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalEmoji}>&#10024;</div>
            <h2 style={styles.modalTitle}>Puzzle Complete!</h2>
            <p style={styles.modalText}>
              You found all {placedWords.length} words in {formatted}
            </p>
            <button onClick={handleNewGame} style={styles.modalBtn}>
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "24px 16px",
    maxWidth: "900px",
    margin: "0 auto",
    gap: "24px",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    gap: "16px",
    flexWrap: "wrap",
  },
  headerLeft: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  title: {
    fontSize: "clamp(1.4rem, 4vw, 1.8rem)",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    fontWeight: 400,
  },
  timer: {
    fontFamily: "var(--font-jost), monospace",
    fontSize: "1rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
    minWidth: "52px",
  },
  themeBtn: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  newGameBtn: {
    padding: "8px 20px",
    borderRadius: "10px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    letterSpacing: "0.01em",
  },
  gameArea: {
    display: "flex",
    gap: "24px",
    width: "100%",
    alignItems: "flex-start",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(14, 1fr)",
    gap: "2px",
    width: "min(100%, 560px)",
    aspectRatio: "1",
    background: "var(--border)",
    borderRadius: "16px",
    overflow: "hidden",
    border: "2px solid var(--border)",
    position: "relative",
    touchAction: "none",
  },
  svgOverlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 1,
  },
  cell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--cell-bg)",
    cursor: "pointer",
    transition: "background 0.15s ease",
    position: "relative",
    zIndex: 2,
    aspectRatio: "1",
  },
  cellSelected: {
    background: "var(--cell-selected)",
  },
  cellFound: {
    background: "var(--cell-found)",
  },
  cellJustFound: {
    animation: "pulse 0.6s ease",
  },
  cellLetter: {
    fontSize: "clamp(0.7rem, 2.5vw, 1rem)",
    fontWeight: 600,
    color: "var(--text)",
    lineHeight: 1,
    pointerEvents: "none",
    transition: "color 0.15s ease",
  },
  wordList: {
    flex: "1 1 200px",
    minWidth: "200px",
    maxWidth: "280px",
  },
  wordListTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    marginBottom: "12px",
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  words: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  word: {
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.06em",
    background: "var(--bg-tertiary)",
    color: "var(--text)",
    transition: "all 0.3s ease",
    border: "1px solid var(--border)",
  },
  wordFound: {
    textDecoration: "line-through",
    color: "var(--word-found)",
    background: "transparent",
    borderColor: "transparent",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    animation: "fadeIn 0.3s ease",
  },
  modal: {
    background: "var(--bg-secondary)",
    borderRadius: "24px",
    padding: "48px 40px",
    textAlign: "center" as const,
    maxWidth: "380px",
    width: "90%",
    border: "1px solid var(--border)",
    boxShadow: "0 24px 48px var(--shadow)",
  },
  modalEmoji: {
    fontSize: "3rem",
    marginBottom: "16px",
  },
  modalTitle: {
    fontSize: "1.6rem",
    fontWeight: 700,
    marginBottom: "8px",
  },
  modalText: {
    color: "var(--text-secondary)",
    marginBottom: "24px",
    fontSize: "1rem",
  },
  modalBtn: {
    padding: "12px 32px",
    borderRadius: "12px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
};

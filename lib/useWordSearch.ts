import { useState, useCallback, useRef } from "react";

export type Direction = [number, number];
export type Position = { row: number; col: number };
export type PlacedWord = {
  word: string;
  start: Position;
  direction: Direction;
  cells: Position[];
};

const DIRECTIONS: Direction[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [1, -1],
];

const WORD_LISTS = [
  ["GENESIS", "EXODUS", "PSALMS", "GOSPEL", "FAITH", "GRACE", "PRAYER", "AMEN", "CROSS", "GLORY"],
  ["MOSES", "DAVID", "ABRAHAM", "PETER", "PAUL", "JOSEPH", "SAMUEL", "ELIJAH", "DANIEL", "RUTH"],
  ["BAPTISM", "TRINITY", "CHURCH", "HEAVEN", "ANGEL", "SPIRIT", "PRAISE", "MERCY", "TRUTH", "PEACE"],
  ["JORDAN", "GALILEE", "BETHEL", "SINAI", "EDEN", "ZION", "CALVARY", "JERICHO", "CANAAN", "JUDAH"],
  ["WISDOM", "BLESSED", "TEMPLE", "PARDON", "SAVIOR", "REDEEM", "PROPHET", "DISCIPLE", "MANNA", "PSALM"],
];

const GRID_SIZE = 14;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateGrid(words: string[]): {
  grid: string[][];
  placed: PlacedWord[];
} {
  const grid: string[][] = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill("")
  );
  const placed: PlacedWord[] = [];

  const sorted = [...words].sort((a, b) => b.length - a.length);

  for (const word of sorted) {
    let didPlace = false;
    const dirs = shuffle(DIRECTIONS);

    for (const dir of dirs) {
      const positions = shuffle(
        Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => ({
          row: Math.floor(i / GRID_SIZE),
          col: i % GRID_SIZE,
        }))
      );

      for (const start of positions) {
        if (canPlace(grid, word, start, dir)) {
          const cells = placeWord(grid, word, start, dir);
          placed.push({ word, start, direction: dir, cells });
          didPlace = true;
          break;
        }
      }
      if (didPlace) break;
    }
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c]) {
        grid[r][c] = alphabet[Math.floor(Math.random() * 26)];
      }
    }
  }

  return { grid, placed };
}

function canPlace(
  grid: string[][],
  word: string,
  start: Position,
  dir: Direction
): boolean {
  for (let i = 0; i < word.length; i++) {
    const r = start.row + dir[0] * i;
    const c = start.col + dir[1] * i;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    if (grid[r][c] && grid[r][c] !== word[i]) return false;
  }
  return true;
}

function placeWord(
  grid: string[][],
  word: string,
  start: Position,
  dir: Direction
): Position[] {
  const cells: Position[] = [];
  for (let i = 0; i < word.length; i++) {
    const r = start.row + dir[0] * i;
    const c = start.col + dir[1] * i;
    grid[r][c] = word[i];
    cells.push({ row: r, col: c });
  }
  return cells;
}

function posKey(p: Position) {
  return `${p.row},${p.col}`;
}

function getCellsBetween(start: Position, end: Position): Position[] | null {
  const dr = end.row - start.row;
  const dc = end.col - start.col;

  if (dr === 0 && dc === 0) return [{ ...start }];

  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (dr !== 0 && dc !== 0 && absDr !== absDc) return null;

  const steps = Math.max(absDr, absDc);
  const stepR = dr === 0 ? 0 : dr / absDr;
  const stepC = dc === 0 ? 0 : dc / absDc;

  const cells: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    cells.push({ row: start.row + stepR * i, col: start.col + stepC * i });
  }
  return cells;
}

export function useWordSearch() {
  const wordListRef = useRef(WORD_LISTS[Math.floor(Math.random() * WORD_LISTS.length)]);
  const [{ grid, placed }, setGridData] = useState(() =>
    generateGrid(wordListRef.current)
  );
  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [foundCells, setFoundCells] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<Position | null>(null);
  const [selEnd, setSelEnd] = useState<Position | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [lastFoundCells, setLastFoundCells] = useState<Set<string>>(new Set());
  const [showLastFound, setShowLastFound] = useState(false);

  const words = wordListRef.current;

  const startSelect = useCallback((pos: Position) => {
    setSelecting(true);
    setSelStart(pos);
    setSelEnd(pos);
    setSelectedCells(new Set([posKey(pos)]));
  }, []);

  const moveSelect = useCallback(
    (pos: Position) => {
      if (!selecting || !selStart) return;
      setSelEnd(pos);
      const cells = getCellsBetween(selStart, pos);
      if (cells) {
        setSelectedCells(new Set(cells.map(posKey)));
      }
    },
    [selecting, selStart]
  );

  const endSelect = useCallback(() => {
    if (!selecting || !selStart || !selEnd) {
      setSelecting(false);
      setSelectedCells(new Set());
      return;
    }

    const cells = getCellsBetween(selStart, selEnd);
    if (cells) {
      const selectedWord = cells.map((c) => grid[c.row][c.col]).join("");
      const reversedWord = [...selectedWord].reverse().join("");

      for (const pw of placed) {
        if (
          !foundWords.has(pw.word) &&
          (pw.word === selectedWord || pw.word === reversedWord)
        ) {
          const newFoundWords = new Set(foundWords);
          newFoundWords.add(pw.word);
          setFoundWords(newFoundWords);

          const newFoundCells = new Set(foundCells);
          const justFound = new Set<string>();
          pw.cells.forEach((c) => {
            const k = posKey(c);
            newFoundCells.add(k);
            justFound.add(k);
          });
          setFoundCells(newFoundCells);
          setLastFoundCells(justFound);
          setShowLastFound(true);
          setTimeout(() => setShowLastFound(false), 600);
          break;
        }
      }
    }

    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
    setSelectedCells(new Set());
  }, [selecting, selStart, selEnd, grid, placed, foundWords, foundCells]);

  const newGame = useCallback(() => {
    wordListRef.current = WORD_LISTS[Math.floor(Math.random() * WORD_LISTS.length)];
    setGridData(generateGrid(wordListRef.current));
    setFoundWords(new Set());
    setFoundCells(new Set());
    setSelectedCells(new Set());
    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
    setLastFoundCells(new Set());
    setShowLastFound(false);
  }, []);

  const isComplete = foundWords.size === placed.length;

  const getSelectionLine = useCallback((): {
    start: Position;
    end: Position;
  } | null => {
    if (!selecting || !selStart || !selEnd) return null;
    const cells = getCellsBetween(selStart, selEnd);
    if (!cells || cells.length < 2) return null;
    return { start: cells[0], end: cells[cells.length - 1] };
  }, [selecting, selStart, selEnd]);

  return {
    grid,
    words,
    placed,
    foundWords,
    foundCells,
    selectedCells,
    selecting,
    isComplete,
    startSelect,
    moveSelect,
    endSelect,
    newGame,
    getSelectionLine,
    lastFoundCells,
    showLastFound,
  };
}

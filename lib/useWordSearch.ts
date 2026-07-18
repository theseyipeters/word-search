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

const WORDS_PER_GAME = 20;
const WORD_BANK = [
  "ABRAHAM", "ADAM", "ALTAR", "AMEN", "ANGEL", "ANOINT", "APOSTLE", "ARK", "BAPTISM", "BARNABAS",
  "BETHANY", "BETHEL", "BIBLE", "BLESSED", "BLESSING", "CALEB", "CALVARY", "CANAAN", "CHURCH", "COMMAND",
  "COVENANT", "COURAGE", "CROSS", "DAMASCUS", "DANIEL", "DAVID", "DEBORAH", "DELIVER", "DISCIPLE", "EDEN",
  "EGYPT", "ELIJAH", "ELISHA", "ESTHER", "EXODUS", "EZEKIEL", "FAITH", "FASTING", "FORGIVE", "GALILEE",
  "GENESIS", "GIDEON", "GILEAD", "GLORY", "GOSHEN", "GOSPEL", "GRACE", "HANNAH", "HEAVEN", "HEBRON",
  "HOLINESS", "HOLY", "HOPE", "HUMBLE", "ISAAC", "ISAIAH", "ISRAEL", "JACOB", "JERICHO", "JEREMIAH",
  "JESUS", "JOHN", "JONAH", "JORDAN", "JOSEPH", "JOSHUA", "JOY", "JUDAH", "JUSTICE", "KINDNESS",
  "KINGDOM", "LAZARUS", "LIGHT", "LOVE", "MANNA", "MARTHA", "MARY", "MERCY", "MIRACLE", "MOSES",
  "NAOMI", "NAZARETH", "NOAH", "PARDON", "PARABLE", "PAUL", "PEACE", "PETER", "PHILIP", "PRAISE",
  "PRAYER", "PROMISE", "PROPHET", "PSALM", "PSALMS", "REBEKAH", "REDEEM", "REVERE", "REVIVAL", "RUTH",
  "SABBATH", "SALVATION", "SAMARIA", "SAMSON", "SAMUEL", "SARAH", "SAVIOR", "SCRIPTURE", "SERMON", "SERVANT",
  "SHILOH", "SINAI", "SOLOMON", "SPIRIT", "STEPHEN", "TEMPLE", "TIMOTHY", "TRINITY", "TRUTH", "VICTORY",
  "WISDOM", "WITNESS", "WORSHIP", "ZION",
];

export const GRID_SIZE = 14;

type RandomSource = () => number;

type WordSearchOptions = {
  seed?: string;
  onWordFound?: (word: string) => void;
  foundByLabel?: string;
};

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): RandomSource {
  let state = hashSeed(seed) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

export function createRoomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function shuffle<T>(arr: T[], random: RandomSource = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateGrid(words: string[], random: RandomSource = Math.random): {
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
    const dirs = shuffle(DIRECTIONS, random);

    for (const dir of dirs) {
      const positions = shuffle(
        Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => ({
          row: Math.floor(i / GRID_SIZE),
          col: i % GRID_SIZE,
        })),
        random
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
        grid[r][c] = alphabet[Math.floor(random() * 26)];
      }
    }
  }

  return { grid, placed };
}

function puzzleFromSeed(seed?: string) {
  const random = seed ? seededRandom(seed) : Math.random;
  const words = shuffle(WORD_BANK, random).slice(0, WORDS_PER_GAME);
  return {
    words,
    ...generateGrid(words, random),
  };
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

export function useWordSearch(options: WordSearchOptions = {}) {
  const seedRef = useRef(options.seed);
  const [puzzle, setPuzzle] = useState(() => puzzleFromSeed(seedRef.current));
  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [foundCells, setFoundCells] = useState<Set<string>>(new Set());
  const [foundBy, setFoundBy] = useState<Record<string, string>>({});
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<Position | null>(null);
  const [selEnd, setSelEnd] = useState<Position | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [lastFoundCells, setLastFoundCells] = useState<Set<string>>(new Set());
  const [showLastFound, setShowLastFound] = useState(false);

  const { grid, placed, words } = puzzle;

  const markWordFound = useCallback(
    (word: string, foundByLabel = options.foundByLabel) => {
      const placedWord = placed.find((pw) => pw.word === word);
      if (!placedWord) return false;
      if (foundWords.has(word)) return false;

      const nextFoundWords = new Set(foundWords);
      nextFoundWords.add(word);
      setFoundWords(nextFoundWords);

      const justFound = new Set<string>();
      const nextFoundCells = new Set(foundCells);
      placedWord.cells.forEach((c) => {
        const k = posKey(c);
        nextFoundCells.add(k);
        justFound.add(k);
      });
      setFoundCells(nextFoundCells);
      setFoundBy((current) =>
        foundByLabel ? { ...current, [word]: foundByLabel } : current
      );
      setLastFoundCells(justFound);
      setShowLastFound(true);
      setTimeout(() => setShowLastFound(false), 600);
      return true;
    },
    [foundCells, foundWords, options.foundByLabel, placed]
  );

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
          if (markWordFound(pw.word)) {
            options.onWordFound?.(pw.word);
          }
          break;
        }
      }
    }

    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
    setSelectedCells(new Set());
  }, [selecting, selStart, selEnd, grid, placed, foundWords, markWordFound, options]);

  const newGame = useCallback(() => {
    seedRef.current = undefined;
    setPuzzle(puzzleFromSeed());
    setFoundWords(new Set());
    setFoundCells(new Set());
    setFoundBy({});
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
    foundBy,
    selectedCells,
    selecting,
    isComplete,
    startSelect,
    moveSelect,
    endSelect,
    newGame,
    markWordFound,
    getSelectionLine,
    lastFoundCells,
    showLastFound,
  };
}

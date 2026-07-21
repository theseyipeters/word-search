import { getBibleWords, selectBibleWords } from "@/lib/bibleWords";

export type ScrambleDifficulty = "easy" | "normal" | "hard";

export type ScrambleRound = {
  answer: string;
  scrambled: string;
  category: string;
};

export type ScrambleTimerState = {
  gameId: string;
  roundIndex: number;
  secondsLeft: number;
};

type WordEntry = {
  answer: string;
  category: "Bible book" | "Bible person" | "Bible place" | "Bible theme" | "Bible object";
  difficulty: ScrambleDifficulty;
};

export const SCRAMBLE_DIFFICULTIES: Record<
  ScrambleDifficulty,
  { label: string; description: string; seconds: number }
> = {
  easy: {
    label: "Easy",
    description: "Familiar names and words",
    seconds: 35,
  },
  normal: {
    label: "Normal",
    description: "A balanced Bible mix",
    seconds: 30,
  },
  hard: {
    label: "Hard",
    description: "Longer, deeper words",
    seconds: 25,
  },
};

const WORD_BANK: WordEntry[] = [
  { answer: "NOAH", category: "Bible person", difficulty: "easy" },
  { answer: "MOSES", category: "Bible person", difficulty: "easy" },
  { answer: "DAVID", category: "Bible person", difficulty: "easy" },
  { answer: "JESUS", category: "Bible person", difficulty: "easy" },
  { answer: "MARY", category: "Bible person", difficulty: "easy" },
  { answer: "PAUL", category: "Bible person", difficulty: "easy" },
  { answer: "RUTH", category: "Bible person", difficulty: "easy" },
  { answer: "JONAH", category: "Bible person", difficulty: "easy" },
  { answer: "PETER", category: "Bible person", difficulty: "easy" },
  { answer: "SARAH", category: "Bible person", difficulty: "easy" },
  { answer: "ISAAC", category: "Bible person", difficulty: "easy" },
  { answer: "JACOB", category: "Bible person", difficulty: "easy" },
  { answer: "EDEN", category: "Bible place", difficulty: "easy" },
  { answer: "EGYPT", category: "Bible place", difficulty: "easy" },
  { answer: "JORDAN", category: "Bible place", difficulty: "easy" },
  { answer: "ISRAEL", category: "Bible place", difficulty: "easy" },
  { answer: "BIBLE", category: "Bible object", difficulty: "easy" },
  { answer: "CROSS", category: "Bible object", difficulty: "easy" },
  { answer: "ALTAR", category: "Bible object", difficulty: "easy" },
  { answer: "TEMPLE", category: "Bible place", difficulty: "easy" },
  { answer: "GRACE", category: "Bible theme", difficulty: "easy" },
  { answer: "FAITH", category: "Bible theme", difficulty: "easy" },
  { answer: "HOPE", category: "Bible theme", difficulty: "easy" },
  { answer: "PEACE", category: "Bible theme", difficulty: "easy" },
  { answer: "MERCY", category: "Bible theme", difficulty: "easy" },
  { answer: "LIGHT", category: "Bible theme", difficulty: "easy" },
  { answer: "ANGEL", category: "Bible theme", difficulty: "easy" },
  { answer: "PRAYER", category: "Bible theme", difficulty: "easy" },
  { answer: "GOSPEL", category: "Bible theme", difficulty: "easy" },
  { answer: "PSALMS", category: "Bible book", difficulty: "easy" },

  { answer: "ABRAHAM", category: "Bible person", difficulty: "normal" },
  { answer: "SOLOMON", category: "Bible person", difficulty: "normal" },
  { answer: "SAMSON", category: "Bible person", difficulty: "normal" },
  { answer: "ESTHER", category: "Bible person", difficulty: "normal" },
  { answer: "DANIEL", category: "Bible person", difficulty: "normal" },
  { answer: "JOSHUA", category: "Bible person", difficulty: "normal" },
  { answer: "DEBORAH", category: "Bible person", difficulty: "normal" },
  { answer: "ELIJAH", category: "Bible person", difficulty: "normal" },
  { answer: "LAZARUS", category: "Bible person", difficulty: "normal" },
  { answer: "GIDEON", category: "Bible person", difficulty: "normal" },
  { answer: "JERICHO", category: "Bible place", difficulty: "normal" },
  { answer: "GALILEE", category: "Bible place", difficulty: "normal" },
  { answer: "CANAAN", category: "Bible place", difficulty: "normal" },
  { answer: "NAZARETH", category: "Bible place", difficulty: "normal" },
  { answer: "BETHLEHEM", category: "Bible place", difficulty: "normal" },
  { answer: "GENESIS", category: "Bible book", difficulty: "normal" },
  { answer: "EXODUS", category: "Bible book", difficulty: "normal" },
  { answer: "PROVERBS", category: "Bible book", difficulty: "normal" },
  { answer: "MATTHEW", category: "Bible book", difficulty: "normal" },
  { answer: "DISCIPLE", category: "Bible theme", difficulty: "normal" },
  { answer: "MIRACLE", category: "Bible theme", difficulty: "normal" },
  { answer: "COVENANT", category: "Bible theme", difficulty: "normal" },
  { answer: "KINGDOM", category: "Bible theme", difficulty: "normal" },
  { answer: "WORSHIP", category: "Bible theme", difficulty: "normal" },
  { answer: "WISDOM", category: "Bible theme", difficulty: "normal" },
  { answer: "PARABLE", category: "Bible theme", difficulty: "normal" },
  { answer: "BAPTISM", category: "Bible theme", difficulty: "normal" },
  { answer: "APOSTLE", category: "Bible theme", difficulty: "normal" },
  { answer: "CALVARY", category: "Bible place", difficulty: "normal" },
  { answer: "MANNA", category: "Bible object", difficulty: "normal" },

  { answer: "MELCHIZEDEK", category: "Bible person", difficulty: "hard" },
  { answer: "NEBUCHADNEZZAR", category: "Bible person", difficulty: "hard" },
  { answer: "MEPHIBOSHETH", category: "Bible person", difficulty: "hard" },
  { answer: "BARTHOLOMEW", category: "Bible person", difficulty: "hard" },
  { answer: "ZECHARIAH", category: "Bible person", difficulty: "hard" },
  { answer: "ZERUBBABEL", category: "Bible person", difficulty: "hard" },
  { answer: "MORDECAI", category: "Bible person", difficulty: "hard" },
  { answer: "GETHSEMANE", category: "Bible place", difficulty: "hard" },
  { answer: "CAPERNAUM", category: "Bible place", difficulty: "hard" },
  { answer: "THESSALONICA", category: "Bible place", difficulty: "hard" },
  { answer: "MESOPOTAMIA", category: "Bible place", difficulty: "hard" },
  { answer: "PHILIPPI", category: "Bible place", difficulty: "hard" },
  { answer: "DEUTERONOMY", category: "Bible book", difficulty: "hard" },
  { answer: "ECCLESIASTES", category: "Bible book", difficulty: "hard" },
  { answer: "THESSALONIANS", category: "Bible book", difficulty: "hard" },
  { answer: "PHILIPPIANS", category: "Bible book", difficulty: "hard" },
  { answer: "CORINTHIANS", category: "Bible book", difficulty: "hard" },
  { answer: "LAMENTATIONS", category: "Bible book", difficulty: "hard" },
  { answer: "HABAKKUK", category: "Bible book", difficulty: "hard" },
  { answer: "RESURRECTION", category: "Bible theme", difficulty: "hard" },
  { answer: "RECONCILIATION", category: "Bible theme", difficulty: "hard" },
  { answer: "RIGHTEOUSNESS", category: "Bible theme", difficulty: "hard" },
  { answer: "TRANSFIGURATION", category: "Bible theme", difficulty: "hard" },
  { answer: "COMMANDMENTS", category: "Bible theme", difficulty: "hard" },
  { answer: "TABERNACLE", category: "Bible object", difficulty: "hard" },
  { answer: "PENTECOST", category: "Bible theme", difficulty: "hard" },
  { answer: "REDEMPTION", category: "Bible theme", difficulty: "hard" },
  { answer: "DISCIPLESHIP", category: "Bible theme", difficulty: "hard" },
  { answer: "PERSECUTION", category: "Bible theme", difficulty: "hard" },
];

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashSeed(seed) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function scramble(answer: string, random: () => number) {
  let scrambled = answer;
  for (let attempt = 0; attempt < 8 && scrambled === answer; attempt += 1) {
    scrambled = shuffle(answer.split(""), random).join("");
  }
  return scrambled === answer ? `${answer.slice(1)}${answer[0]}` : scrambled;
}

export function createScrambleRounds(
  seed: string,
  difficulty: ScrambleDifficulty,
  count = 10,
  answers?: string[]
): ScrambleRound[] {
  const random = seededRandom(`${seed}:${difficulty}`);
  const entries = answers?.length
    ? getBibleWords(answers)
    : selectBibleWords({ seed, difficulty, count });
  return entries
    .slice(0, count)
    .map((entry) => ({
      answer: entry.answer,
      category: entry.category,
      scrambled: scramble(entry.answer, random),
    }));
}

export function normalizeScrambleGuess(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

export function calculateScramblePoints(
  secondsLeft: number,
  roundSeconds: number,
  wrongAttempts: number,
  usedHint: boolean
) {
  const speedPoints = Math.round((Math.max(0, secondsLeft) / roundSeconds) * 900);
  const penalties = wrongAttempts * 75 + (usedHint ? 150 : 0);
  return Math.max(100, 100 + speedPoints - penalties);
}

export function getScrambleRoundSeconds(
  timer: ScrambleTimerState,
  gameId: string,
  roundIndex: number,
  roundSeconds: number
) {
  return timer.gameId === gameId && timer.roundIndex === roundIndex
    ? timer.secondsLeft
    : roundSeconds;
}

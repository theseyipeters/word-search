import { BIBLE_WORD_HINTS } from "@/lib/bibleWordHints";

export type BibleWordCategory =
  | "Bible book"
  | "Bible person"
  | "Bible place"
  | "Bible theme"
  | "Bible object";

export type BibleWordDifficulty = "easy" | "normal" | "hard";

export type BibleWordEntry = {
  id: string;
  answer: string;
  category: BibleWordCategory;
  difficulty: BibleWordDifficulty;
  hint: string;
  reference?: string;
};

const WORD_GROUPS: Array<{ category: BibleWordCategory; words: string[] }> = [
  {
    category: "Bible book",
    words: [
      "GENESIS", "EXODUS", "LEVITICUS", "NUMBERS", "DEUTERONOMY", "JOSHUA", "JUDGES", "RUTH",
      "SAMUEL", "KINGS", "CHRONICLES", "EZRA", "NEHEMIAH", "ESTHER", "PSALMS", "PROVERBS",
      "ECCLESIASTES", "ISAIAH", "JEREMIAH", "LAMENTATIONS", "EZEKIEL", "DANIEL", "HOSEA", "JOEL",
      "AMOS", "OBADIAH", "JONAH", "MICAH", "NAHUM", "HABAKKUK", "ZEPHANIAH", "HAGGAI",
      "ZECHARIAH", "MALACHI", "MATTHEW", "MARK", "LUKE", "JOHN", "ACTS", "ROMANS",
      "CORINTHIANS", "GALATIANS", "EPHESIANS", "PHILIPPIANS", "COLOSSIANS", "THESSALONIANS",
      "TIMOTHY", "TITUS", "PHILEMON", "HEBREWS", "JAMES", "PETER", "JUDE", "REVELATION",
    ],
  },
  {
    category: "Bible person",
    words: [
      "ADAM", "ABEL", "CAIN", "SETH", "ENOCH", "NOAH", "SHEM", "JAPHETH", "ABRAHAM", "SARAH",
      "HAGAR", "ISAAC", "REBEKAH", "ESAU", "JACOB", "LEAH", "RACHEL", "JOSEPH", "BENJAMIN",
      "MOSES", "AARON", "MIRIAM", "CALEB", "RAHAB", "DEBORAH", "BARAK", "GIDEON", "ABIMELECH",
      "JEPHTHAH", "SAMSON", "DELILAH", "NAOMI", "BOAZ", "HANNAH", "SAMUEL", "SAUL", "JONATHAN",
      "DAVID", "ABSALOM", "SOLOMON", "REHOBOAM", "JEROBOAM", "ELIJAH", "ELISHA", "JEZEBEL",
      "HEZEKIAH", "JOSIAH", "NEHEMIAH", "MORDECAI", "SHADRACH", "MESHACH", "ABEDNEGO",
      "ELIZABETH", "ZACHARIAS", "MARY", "JESUS", "ANDREW", "PHILIP", "BARTHOLOMEW", "THOMAS",
      "THADDAEUS", "SIMON", "JUDAS", "MATTHIAS", "MARTHA", "LAZARUS", "NICODEMUS", "ZACCHAEUS",
      "STEPHEN", "PAUL", "BARNABAS", "SILAS", "LYDIA", "PRISCILLA", "AQUILA", "APOLLOS",
      "CORNELIUS", "DORCAS", "PHOEBE", "ONESIMUS", "MELCHIZEDEK", "NEBUCHADNEZZAR",
      "MEPHIBOSHETH", "ZERUBBABEL",
    ],
  },
  {
    category: "Bible place",
    words: [
      "EDEN", "BABEL", "CANAAN", "EGYPT", "GOSHEN", "SINAI", "MOAB", "EDOM", "ISRAEL", "JUDAH",
      "JERUSALEM", "BETHLEHEM", "NAZARETH", "GALILEE", "SAMARIA", "JERICHO", "JORDAN", "BETHEL",
      "HEBRON", "BEERSHEBA", "DAMASCUS", "NINEVEH", "BABYLON", "SODOM", "GOMORRAH", "GETHSEMANE",
      "CALVARY", "GOLGOTHA", "CAPERNAUM", "BETHANY", "EMMAUS", "CANA", "ANTIOCH", "EPHESUS",
      "CORINTH", "PHILIPPI", "COLOSSE", "ROME", "CRETE", "PATMOS", "TARSHISH", "SHILOH", "GILEAD",
      "JOPPA", "CAESAREA", "SYCHAR", "DECAPOLIS", "THESSALONICA", "MESOPOTAMIA", "ARARAT", "CARMEL",
      "ZION", "OLIVET",
    ],
  },
  {
    category: "Bible theme",
    words: [
      "AMEN", "ANGEL", "ANOINT", "APOSTLE", "BAPTISM", "BLESSED", "BLESSING", "CHURCH", "COMMAND",
      "COMMANDMENTS", "COVENANT", "COURAGE", "DELIVER", "DISCIPLE", "FAITH", "FASTING", "FORGIVE",
      "GLORY", "GOSPEL", "GRACE", "HEAVEN", "HOLINESS", "HOLY", "HOPE", "HUMBLE", "JUSTICE",
      "KINDNESS", "KINGDOM", "LIGHT", "LOVE", "MERCY", "MIRACLE", "PARDON", "PARABLE", "PEACE",
      "PRAISE", "PRAYER", "PROMISE", "PROPHET", "REDEEM", "REDEMPTION", "REPENTANCE", "RESURRECTION",
      "RIGHTEOUSNESS", "SABBATH", "SALVATION", "SAVIOR", "SCRIPTURE", "SERMON", "SERVANT", "SPIRIT",
      "TRINITY", "TRUTH", "VICTORY", "WISDOM", "WITNESS", "WORSHIP", "CREATION", "FLOOD", "PASSOVER",
      "PENTECOST", "TRANSFIGURATION", "CRUCIFIXION", "DISCIPLESHIP", "PERSECUTION", "RECONCILIATION",
      "PROVIDENCE", "SACRIFICE", "OFFERING", "SHEPHERD", "VINEYARD", "MUSTARD", "LEAVEN", "TALENT",
      "WIDOW", "ORPHAN", "PRIEST", "LEVITE", "PHARISEE", "SADDUCEE",
    ],
  },
  {
    category: "Bible object",
    words: [
      "ALTAR", "BIBLE", "CROSS", "MANNA", "TABERNACLE", "TEMPLE", "INCENSE", "CENSER", "LAMPSTAND",
      "SCROLL", "TABLETS", "CROWN", "SCEPTER", "SLING", "STONE", "STAFF", "TUNIC", "ROBE", "SANDALS",
      "CHARIOT", "TRUMPET", "HARP", "LYRE", "SYNAGOGUE", "SANCTUARY", "DENARIUS", "FRANKINCENSE",
      "MYRRH", "BREASTPLATE", "EPHOD", "PITCHER", "BASKET", "NETS", "LOAVES", "CUP", "SWORD",
      "SHIELD", "HELMET", "SCROLLS", "VINE", "FIGTREE", "WELL", "DOVE", "LAMB", "RAM", "OXEN",
    ],
  },
];

function difficultyFor(answer: string): BibleWordDifficulty {
  if (answer.length <= 6) return "easy";
  if (answer.length <= 9) return "normal";
  return "hard";
}

const seen = new Set<string>();

export const BIBLE_WORDS: BibleWordEntry[] = WORD_GROUPS.flatMap(({ category, words }) =>
  words
    .map((answer) => answer.toUpperCase().replace(/[^A-Z]/g, ""))
    .filter((answer) => answer.length >= 4 && !seen.has(answer) && seen.add(answer))
    .map((answer) => {
      const hint = BIBLE_WORD_HINTS[answer];
      if (!hint) {
        throw new Error(`Missing contextual Bible-word hint for ${answer}`);
      }
      return {
        id: answer.toLowerCase(),
        answer,
        category,
        difficulty: difficultyFor(answer),
        hint: hint.clue,
        reference: hint.reference,
      };
    })
);

type SelectionOptions = {
  seed: string;
  count: number;
  difficulty?: BibleWordDifficulty;
  maxLength?: number;
  excludedAnswers?: string[];
};

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

export function eligibleBibleWords(
  difficulty?: BibleWordDifficulty,
  maxLength?: number
) {
  return BIBLE_WORDS.filter(
    (entry) =>
      (!difficulty || entry.difficulty === difficulty) &&
      (!maxLength || entry.answer.length <= maxLength)
  );
}

export function selectBibleWords({
  seed,
  count,
  difficulty,
  maxLength,
  excludedAnswers = [],
}: SelectionOptions) {
  const excluded = new Set(excludedAnswers);
  const pool = eligibleBibleWords(difficulty, maxLength).filter(
    (entry) => !excluded.has(entry.answer)
  );
  return shuffle(pool, seededRandom(seed)).slice(0, count);
}

export function getBibleWords(answers: string[]) {
  const byAnswer = new Map(BIBLE_WORDS.map((entry) => [entry.answer, entry]));
  return answers
    .map((answer) => byAnswer.get(answer))
    .filter((entry): entry is BibleWordEntry => Boolean(entry));
}

type CycleOptions = Omit<SelectionOptions, "excludedAnswers"> & {
  game: "word-search" | "word-scramble";
};

export function takeBibleWordCycle({
  game,
  seed,
  count,
  difficulty,
  maxLength,
}: CycleOptions) {
  const pool = eligibleBibleWords(difficulty, maxLength);
  if (typeof window === "undefined") {
    return selectBibleWords({ seed, count, difficulty, maxLength });
  }

  const cycleName = difficulty || "all";
  const storageKey = `guidde:${game}:bible-word-cycle:v1:${cycleName}`;
  let used: string[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(stored)) {
      used = stored.filter((answer): answer is string => typeof answer === "string");
    }
  } catch {
    used = [];
  }

  const eligibleAnswers = new Set(pool.map((entry) => entry.answer));
  used = [...new Set(used.filter((answer) => eligibleAnswers.has(answer)))];
  let selected = selectBibleWords({
    seed,
    count,
    difficulty,
    maxLength,
    excludedAnswers: used,
  });
  let nextCycleUsed = [...used, ...selected.map((entry) => entry.answer)];

  if (selected.length < count) {
    const immediatelyPrevious = used.slice(-count);
    const newCycleWords = selectBibleWords({
      seed: `${seed}:new-cycle`,
      count: count - selected.length,
      difficulty,
      maxLength,
      excludedAnswers: [
        ...immediatelyPrevious,
        ...selected.map((entry) => entry.answer),
      ],
    });
    selected = [...selected, ...newCycleWords];
    nextCycleUsed = newCycleWords.map((entry) => entry.answer);
  }

  localStorage.setItem(
    storageKey,
    JSON.stringify(nextCycleUsed)
  );
  return selected;
}

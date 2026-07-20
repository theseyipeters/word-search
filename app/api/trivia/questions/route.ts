import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TriviaQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  reference: string;
  kind: string;
};
type Difficulty = "easy" | "normal" | "hard";
type QuestionPayload = {
  questions: TriviaQuestion[];
  source: "ai";
  model: string;
};
type QuestionRequest = {
  roomId?: unknown;
  difficulty?: unknown;
  exclude?: unknown;
};

const QUESTIONS_PER_BATTLE = 10;
const CANDIDATES_PER_GENERATION = 16;
const MAX_CLIENT_HISTORY = 400;
const MAX_PROMPT_HISTORY = 100;
const MAX_SERVER_HISTORY = 1000;
const DEFAULT_MODEL = "gpt-5.6-luna";

const questionCache = new Map<string, QuestionPayload>();
const generationInFlight = new Map<string, Promise<QuestionPayload>>();
const recentQuestionSignatures: string[] = [];

const coverageGroups = [
  "Torah and the wilderness: Genesis, Exodus, Leviticus, Numbers, Deuteronomy",
  "Israel's history: Joshua, Judges, Ruth, Samuel, Kings, Chronicles, Ezra, Nehemiah, Esther",
  "Wisdom and poetry: Job, Psalms, Proverbs, Ecclesiastes, Song of Songs",
  "Major prophets: Isaiah, Jeremiah, Lamentations, Ezekiel, Daniel",
  "Minor prophets: Hosea through Malachi",
  "Jesus' life and teaching: Matthew, Mark, Luke, John",
  "The early church: Acts and the New Testament letters",
  "New Testament people, places, journeys, parables, miracles, and events",
];

function normalizeDifficulty(value: unknown): Difficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function cleanRoomId(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : "solo";
}

function questionSignature(question: Pick<TriviaQuestion, "question"> | string) {
  const value = typeof question === "string" ? question : question.question;
  return value
    .toLowerCase()
    .replace(/["'.,?!:;()\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionTokens(value: string) {
  const ignored = new Set([
    "a", "an", "and", "are", "at", "did", "do", "does", "fill", "for",
    "from", "gap", "happened", "how", "in", "is", "of", "on", "the",
    "this", "to", "was", "what", "when", "where", "which", "who", "why",
  ]);
  return new Set(
    questionSignature(value)
      .split(" ")
      .filter((token) => token.length > 2 && !ignored.has(token))
  );
}

function questionsAreSimilar(first: string, second: string) {
  const firstSignature = questionSignature(first);
  const secondSignature = questionSignature(second);
  if (firstSignature === secondSignature) return true;

  const firstTokens = questionTokens(firstSignature);
  const secondTokens = questionTokens(secondSignature);
  if (Math.min(firstTokens.size, secondTokens.size) < 3) return false;

  let overlap = 0;
  firstTokens.forEach((token) => {
    if (secondTokens.has(token)) overlap += 1;
  });
  return overlap / Math.min(firstTokens.size, secondTokens.size) >= 0.78;
}

function uniqueFreshQuestions(
  candidates: TriviaQuestion[],
  excludedQuestions: string[]
) {
  const accepted: TriviaQuestion[] = [];
  const comparisonPool = [...excludedQuestions, ...recentQuestionSignatures];

  for (const candidate of candidates) {
    if (
      comparisonPool.some((previous) =>
        questionsAreSimilar(candidate.question, previous)
      ) ||
      accepted.some((previous) =>
        questionsAreSimilar(candidate.question, previous.question)
      )
    ) continue;
    accepted.push(candidate);
  }

  return accepted;
}

function rememberQuestions(questions: TriviaQuestion[]) {
  for (const question of questions) {
    recentQuestionSignatures.push(questionSignature(question));
  }
  if (recentQuestionSignatures.length > MAX_SERVER_HISTORY) {
    recentQuestionSignatures.splice(
      0,
      recentQuestionSignatures.length - MAX_SERVER_HISTORY
    );
  }
}

function isTriviaQuestion(value: unknown): value is TriviaQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<TriviaQuestion>;

  return (
    typeof question.question === "string" &&
    question.question.trim().length >= 12 &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every(
      (option) => typeof option === "string" && option.trim().length > 0
    ) &&
    new Set(question.options.map((option) => option.toLowerCase().trim())).size === 4 &&
    Number.isInteger(question.correctIndex) &&
    Number(question.correctIndex) >= 0 &&
    Number(question.correctIndex) <= 3 &&
    typeof question.reference === "string" &&
    question.reference.trim().length > 0 &&
    typeof question.kind === "string" &&
    question.kind.trim().length > 0
  );
}

function extractResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const output = payload.output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((content) => {
      if (!content || typeof content !== "object") return "";
      const value = content as { text?: unknown };
      return typeof value.text === "string" ? value.text : "";
    })
    .join("");
}

function seededNumber(seed: string) {
  let value = 2166136261;
  for (const char of seed) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value >>> 0);
}

function coverageBrief(seed: string) {
  const start = seededNumber(seed) % coverageGroups.length;
  return [0, 1, 3, 5]
    .map((offset) => coverageGroups[(start + offset) % coverageGroups.length])
    .join("\n- ");
}

function difficultyGuidance(difficulty: Difficulty) {
  if (difficulty === "easy") {
    return "Use familiar stories, well-known people, direct wording, and clearly distinct distractors. Avoid obscure names and trick questions.";
  }
  if (difficulty === "hard") {
    return "Use deeper but verifiable Bible knowledge, lesser-known events, exact speakers, sequence, locations, and plausible distractors. Questions must remain fair.";
  }
  return "Mix familiar and moderately challenging Bible knowledge with direct wording and plausible distractors.";
}

function questionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        minItems: CANDIDATES_PER_GENERATION,
        maxItems: CANDIDATES_PER_GENERATION,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "string" },
            },
            correctIndex: { type: "integer", minimum: 0, maximum: 3 },
            reference: { type: "string" },
            kind: { type: "string" },
          },
          required: ["question", "options", "correctIndex", "reference", "kind"],
        },
      },
    },
    required: ["questions"],
  };
}

async function requestCandidateBatch(
  apiKey: string,
  model: string,
  roomId: string,
  difficulty: Difficulty,
  excludedQuestions: string[],
  attempt: number
) {
  const avoidList = excludedQuestions.slice(-MAX_PROMPT_HISTORY);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 8000,
      input: [
        {
          role: "system",
          content:
            "You are the question editor for a family-friendly Bible trivia game. Use the 66-book Protestant Bible canon as the source of truth. Every answer must be directly supported by the cited passage. Never invent a quotation, event, person, place, or reference. Return only the requested JSON.",
        },
        {
          role: "user",
          content: `Create exactly ${CANDIDATES_PER_GENERATION} candidate Bible trivia questions for a new battle.

Battle seed: ${roomId}-${attempt}
Difficulty: ${difficulty}
Difficulty guidance: ${difficultyGuidance(difficulty)}

Prioritize a varied selection from these Bible areas:
- ${coverageBrief(`${roomId}-${attempt}`)}

Editorial requirements:
- Before returning, verify every correct answer against its Bible reference.
- Use at least 8 distinct Bible books and include both Testaments.
- Use no more than 2 questions from the same Bible book.
- Mix people, places, events, quotes, fill-in-the-blank, sequence, miracles, parables, journeys, objects, and cause/effect.
- Questions must test textual Bible knowledge, not denominational interpretation or opinion.
- Quotes must be short, identifiable, and paired with the correct speaker and reference.
- Give 4 concise, unique, plausible options with exactly one correct answer.
- Vary the location of correctIndex across 0, 1, 2, and 3.
- Do not repeat or closely paraphrase any avoided question.

Avoided questions from earlier battles:
${avoidList.length ? avoidList.map((question) => `- ${question}`).join("\n") : "- None yet"}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bible_trivia_candidates",
          strict: true,
          schema: questionSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI question generation failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const responseText = extractResponseText(payload);
  if (!responseText) throw new Error("OpenAI returned an empty question set");

  const parsed = JSON.parse(responseText) as { questions?: unknown };
  if (!Array.isArray(parsed.questions)) {
    throw new Error("OpenAI returned an invalid question set");
  }

  return parsed.questions.filter(isTriviaQuestion);
}

async function generateQuestions(
  roomId: string,
  difficulty: Difficulty,
  clientHistory: string[]
): Promise<QuestionPayload> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const excludedQuestions = [
    ...clientHistory,
    ...recentQuestionSignatures,
  ].slice(-MAX_CLIENT_HISTORY);
  let accepted: TriviaQuestion[] = [];

  for (let attempt = 1; attempt <= 2 && accepted.length < QUESTIONS_PER_BATTLE; attempt += 1) {
    const candidates = await requestCandidateBatch(
      apiKey,
      model,
      roomId,
      difficulty,
      [...excludedQuestions, ...accepted.map((question) => question.question)],
      attempt
    );
    accepted = [
      ...accepted,
      ...uniqueFreshQuestions(candidates, [
        ...excludedQuestions,
        ...accepted.map((question) => question.question),
      ]),
    ];
  }

  if (accepted.length < QUESTIONS_PER_BATTLE) {
    throw new Error("OpenAI could not produce ten sufficiently distinct questions");
  }

  const questions = accepted.slice(0, QUESTIONS_PER_BATTLE);
  rememberQuestions(questions);
  return { questions, source: "ai", model };
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((question): question is string => typeof question === "string")
    .map((question) => question.trim().slice(0, 220))
    .filter(Boolean)
    .slice(-MAX_CLIENT_HISTORY);
}

export async function POST(request: NextRequest) {
  let body: QuestionRequest;
  try {
    body = (await request.json()) as QuestionRequest;
  } catch {
    return NextResponse.json(
      { error: "The question request was invalid." },
      { status: 400 }
    );
  }

  const roomId = cleanRoomId(body.roomId);
  const difficulty = normalizeDifficulty(body.difficulty);
  const clientHistory = normalizeHistory(body.exclude);
  const cacheKey = `${roomId}:${difficulty}`;
  const cached = questionCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  try {
    let generation = generationInFlight.get(cacheKey);
    if (!generation) {
      generation = generateQuestions(roomId, difficulty, clientHistory);
      generationInFlight.set(cacheKey, generation);
    }
    const payload = await generation;
    questionCache.set(cacheKey, payload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Trivia question generation failed", error);
    return NextResponse.json(
      {
        error:
          "Fresh AI questions could not be generated right now. Please try again.",
      },
      { status: 502 }
    );
  } finally {
    generationInFlight.delete(cacheKey);
  }
}

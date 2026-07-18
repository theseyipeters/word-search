import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type TriviaQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  reference: string;
  kind?: string;
};
type Difficulty = "easy" | "normal" | "hard";

const fallbackQuestions: TriviaQuestion[] = [
  {
    question: "Who led the Israelites out of Egypt?",
    options: ["David", "Moses", "Solomon", "Elijah"],
    correctIndex: 1,
    reference: "Exodus",
  },
  {
    question: "What did David use to defeat Goliath?",
    options: ["A sword", "A spear", "A sling and stone", "A bow"],
    correctIndex: 2,
    reference: "1 Samuel 17",
  },
  {
    question: "Who was swallowed by a great fish?",
    options: ["Jonah", "Noah", "Peter", "Joseph"],
    correctIndex: 0,
    reference: "Jonah 1",
  },
  {
    question: "Where was Jesus born?",
    options: ["Nazareth", "Bethlehem", "Jerusalem", "Capernaum"],
    correctIndex: 1,
    reference: "Luke 2",
  },
  {
    question: "Who built the ark?",
    options: ["Abraham", "Moses", "Noah", "Jacob"],
    correctIndex: 2,
    reference: "Genesis 6",
  },
  {
    question: "Which disciple denied Jesus three times?",
    options: ["John", "Thomas", "Peter", "Andrew"],
    correctIndex: 2,
    reference: "Luke 22",
  },
  {
    question: "What is the first book of the Bible?",
    options: ["Exodus", "Genesis", "Matthew", "Psalms"],
    correctIndex: 1,
    reference: "Genesis",
  },
  {
    question: "Who interpreted Pharaoh's dreams in Egypt?",
    options: ["Joseph", "Daniel", "Samuel", "Isaiah"],
    correctIndex: 0,
    reference: "Genesis 41",
  },
  {
    question: "How many days was Jesus in the wilderness being tempted?",
    options: ["7", "12", "30", "40"],
    correctIndex: 3,
    reference: "Matthew 4",
  },
  {
    question: "Who was the mother of Jesus?",
    options: ["Martha", "Mary", "Elizabeth", "Ruth"],
    correctIndex: 1,
    reference: "Matthew 1",
  },
  {
    question: "Who said, \"Here am I; send me\"?",
    options: ["Isaiah", "Jeremiah", "Samuel", "Ezekiel"],
    correctIndex: 0,
    reference: "Isaiah 6:8",
    kind: "who-said-it",
  },
  {
    question: "Fill in the gap: \"The Lord is my ______; I shall not want.\"",
    options: ["shield", "shepherd", "light", "song"],
    correctIndex: 1,
    reference: "Psalm 23:1",
    kind: "fill-gap",
  },
  {
    question: "Which event happened first?",
    options: ["The Red Sea parted", "David became king", "Daniel entered the lions' den", "Jesus fed five thousand"],
    correctIndex: 0,
    reference: "Exodus 14",
    kind: "sequence",
  },
  {
    question: "Who said, \"Am I my brother's keeper?\"",
    options: ["Cain", "Esau", "Joseph", "Absalom"],
    correctIndex: 0,
    reference: "Genesis 4:9",
    kind: "who-said-it",
  },
  {
    question: "Fill in the gap: Zacchaeus climbed a ______ tree to see Jesus.",
    options: ["fig", "olive", "sycamore", "cedar"],
    correctIndex: 2,
    reference: "Luke 19:4",
    kind: "fill-gap",
  },
  {
    question: "Which Bible occurrence involved fire falling from heaven on an altar?",
    options: ["Elijah on Mount Carmel", "Moses at Sinai", "Gideon's fleece", "Jacob at Bethel"],
    correctIndex: 0,
    reference: "1 Kings 18",
    kind: "occurrence",
  },
  {
    question: "Who said, \"Speak, Lord, for your servant is listening\"?",
    options: ["Samuel", "Saul", "Solomon", "Nathan"],
    correctIndex: 0,
    reference: "1 Samuel 3:10",
    kind: "who-said-it",
  },
  {
    question: "Fill in the gap: Jesus said, \"I am the way, the ______ and the life.\"",
    options: ["truth", "gate", "vine", "bread"],
    correctIndex: 0,
    reference: "John 14:6",
    kind: "fill-gap",
  },
  {
    question: "Which event happened at Pentecost?",
    options: ["The Spirit came on the believers", "The temple was rebuilt", "Paul was shipwrecked", "Jericho's walls fell"],
    correctIndex: 0,
    reference: "Acts 2",
    kind: "occurrence",
  },
  {
    question: "Who asked, \"What must I do to inherit eternal life?\"",
    options: ["A rich ruler", "Nicodemus", "Pilate", "Barnabas"],
    correctIndex: 0,
    reference: "Luke 18:18",
    kind: "who-said-it",
  },
];
const hardFallbackQuestions: TriviaQuestion[] = [
  {
    question: "Who said, \"Is your servant a dog, that he should do this great thing?\"",
    options: ["Hazael", "Jehu", "Naaman", "Ben-Hadad"],
    correctIndex: 0,
    reference: "2 Kings 8:13",
    kind: "who-said-it",
  },
  {
    question: "Fill in the gap: Eutychus fell from the ______ story while Paul was speaking.",
    options: ["second", "third", "fourth", "upper"],
    correctIndex: 1,
    reference: "Acts 20:9",
    kind: "fill-gap",
  },
  {
    question: "Which occurrence involved a borrowed axe head floating?",
    options: ["Elisha by the Jordan", "Elijah at Cherith", "Moses at Marah", "Joshua at Ai"],
    correctIndex: 0,
    reference: "2 Kings 6:1-7",
    kind: "occurrence",
  },
  {
    question: "Who was the father of Tola, the judge of Israel?",
    options: ["Puah", "Gilead", "Abdon", "Hillel"],
    correctIndex: 0,
    reference: "Judges 10:1",
    kind: "person-identity",
  },
  {
    question: "Who said, \"Come, see my zeal for the Lord\"?",
    options: ["Jehu", "Josiah", "Hezekiah", "Elijah"],
    correctIndex: 0,
    reference: "2 Kings 10:16",
    kind: "who-said-it",
  },
  {
    question: "Fill in the gap: Paul left Trophimus sick at ______.",
    options: ["Miletus", "Troas", "Corinth", "Crete"],
    correctIndex: 0,
    reference: "2 Timothy 4:20",
    kind: "fill-gap",
  },
  {
    question: "Which event happened first in David's life?",
    options: ["He spared Saul in a cave", "He brought the ark to Jerusalem", "He defeated Goliath", "He fled from Absalom"],
    correctIndex: 2,
    reference: "1 Samuel 17",
    kind: "sequence",
  },
  {
    question: "Which prophet named his son Maher-Shalal-Hash-Baz?",
    options: ["Isaiah", "Jeremiah", "Hosea", "Ezekiel"],
    correctIndex: 0,
    reference: "Isaiah 8:3",
    kind: "person-identity",
  },
  {
    question: "Where did Paul reason daily in the school of Tyrannus?",
    options: ["Ephesus", "Athens", "Corinth", "Philippi"],
    correctIndex: 0,
    reference: "Acts 19:9",
    kind: "location",
  },
  {
    question: "Which Bible occurrence involved Agabus binding his own hands and feet?",
    options: ["A prophecy about Paul's arrest", "A famine prophecy", "A warning to Peter", "A vision in Joppa"],
    correctIndex: 0,
    reference: "Acts 21:10-11",
    kind: "occurrence",
  },
];

const questionCache = new Map<string, TriviaQuestion[]>();
const usedQuestionSignatures = new Set<string>();

function questionSignature(question: Pick<TriviaQuestion, "question">) {
  return question.question
    .toLowerCase()
    .replace(/["'.,?!:;()\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueQuestions(questions: TriviaQuestion[]) {
  const seen = new Set<string>();
  const unique: TriviaQuestion[] = [];

  for (const question of questions) {
    const signature = questionSignature(question);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    unique.push(question);
  }

  return unique;
}

function fallbackSet(roomId: string) {
  return fallbackSetForDifficulty(roomId, "normal");
}

function normalizeDifficulty(value: string | null): Difficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function difficultyGuidance(difficulty: Difficulty) {
  if (difficulty === "easy") {
    return "Easy difficulty: use familiar Bible stories, well-known people, direct wording, and clearly distinct distractors. Avoid obscure names or rare references.";
  }

  if (difficulty === "hard") {
    return "Hard difficulty: use deeper Bible knowledge, lesser-known events, exact speakers, subtle sequence questions, obscure-but-fair references, and highly plausible distractors. Avoid giveaway wording.";
  }

  return "Normal difficulty: mix familiar and moderately challenging Bible knowledge with fair but plausible distractors.";
}

function fallbackSetForDifficulty(roomId: string, difficulty: Difficulty) {
  const source =
    difficulty === "hard"
      ? hardFallbackQuestions
      : difficulty === "easy"
        ? fallbackQuestions.slice(0, 14)
        : fallbackQuestions;
  const start = Math.abs(
    [...roomId].reduce((total, char) => total + char.charCodeAt(0), 0)
  ) % source.length;
  const rotated = [
    ...source.slice(start),
    ...source.slice(0, start),
  ];

  return uniqueQuestions(rotated).slice(0, 10);
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

function isValidQuestion(value: unknown): value is TriviaQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<TriviaQuestion>;

  return (
    typeof question.question === "string" &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === "string") &&
    typeof question.correctIndex === "number" &&
    question.correctIndex >= 0 &&
    question.correctIndex <= 3 &&
    typeof question.reference === "string"
  );
}

async function generateQuestions(roomId: string, difficulty: Difficulty): Promise<TriviaQuestion[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackSetForDifficulty(roomId, difficulty);
  const avoidList = [...usedQuestionSignatures].slice(-80);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You create accurate, family-friendly Bible trivia. Return only valid JSON. Do not repeat questions or make near-duplicates.",
        },
        {
          role: "user",
          content: `Create exactly 10 Bible trivia questions for a multiplayer game room. Room seed: ${roomId}. Difficulty: ${difficulty}.

Requirements:
- ${difficultyGuidance(difficulty)}
- Absolutely no repeated questions and no near-duplicates.
- Avoid these previously used question signatures: ${avoidList.join(" | ") || "none"}.
- Mix these formats: who said this quote, fill in the gap, Bible occurrence/event, sequence/order, location, person identity, and cause/effect.
- Include at least 2 "who said" quote questions.
- Include at least 2 fill-in-the-gap questions using [_] or a blank.
- Include at least 2 Bible occurrence/event questions.
- Use both Old Testament and New Testament.
- Make the distractor options plausible, not silly.
- Each question must have 4 concise options, one correctIndex from 0 to 3, a short Bible reference, and a kind label.`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bible_trivia_questions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              questions: {
                type: "array",
                minItems: 10,
                maxItems: 10,
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
          },
        },
      },
    }),
  });

  if (!response.ok) return fallbackSetForDifficulty(roomId, difficulty);

  const payload = (await response.json()) as Record<string, unknown>;
  const parsed = JSON.parse(extractResponseText(payload)) as {
    questions?: unknown[];
  };
  const questions = uniqueQuestions(parsed.questions?.filter(isValidQuestion) || [])
    .filter((question) => !usedQuestionSignatures.has(questionSignature(question)))
    .slice(0, 10);

  return questions?.length === 10 ? questions : fallbackSetForDifficulty(roomId, difficulty);
}

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId") || "solo";
  const difficulty = normalizeDifficulty(request.nextUrl.searchParams.get("difficulty"));
  const cacheKey = `${roomId}:${difficulty}`;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!refresh && questionCache.has(cacheKey)) {
    return NextResponse.json({ questions: questionCache.get(cacheKey) || fallbackSetForDifficulty(roomId, difficulty) });
  }

  try {
    const questions = await generateQuestions(roomId, difficulty);
    questions.forEach((question) =>
      usedQuestionSignatures.add(questionSignature(question))
    );
    questionCache.set(cacheKey, questions);
    return NextResponse.json({ questions });
  } catch {
    const questions = fallbackSetForDifficulty(roomId, difficulty);
    questions.forEach((question) =>
      usedQuestionSignatures.add(questionSignature(question))
    );
    questionCache.set(cacheKey, questions);
    return NextResponse.json({ questions });
  }
}

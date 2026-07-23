import { NextResponse, type NextRequest } from "next/server";
import englishWords from "an-array-of-english-words";
import {
  normalizeWordboundLetter,
  normalizeWordboundWord,
} from "@/lib/wordbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ValidationResult = {
  valid: boolean;
  word: string;
  definition?: string;
  reason?: string;
};

const validationCache = new Map<string, ValidationResult>();
const gameDictionary = new Set<string>(englishWords);
const MAX_CACHE_SIZE = 2_000;
const DICTIONARY_TIMEOUT_MS = 4_500;

function remember(key: string, result: ValidationResult) {
  if (validationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = validationCache.keys().next().value;
    if (typeof oldestKey === "string") validationCache.delete(oldestKey);
  }
  validationCache.set(key, result);
  return result;
}

function invalid(word: string, reason: string) {
  return { valid: false, word, reason } satisfies ValidationResult;
}

function firstDefinition(payload: unknown) {
  if (!Array.isArray(payload)) return null;

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const meanings = (entry as { meanings?: unknown }).meanings;
    if (!Array.isArray(meanings)) continue;

    for (const meaning of meanings) {
      if (!meaning || typeof meaning !== "object") continue;
      const partOfSpeech = (meaning as { partOfSpeech?: unknown }).partOfSpeech;
      if (
        typeof partOfSpeech === "string" &&
        partOfSpeech.toLowerCase().includes("proper noun")
      ) {
        continue;
      }

      const definitions = (meaning as { definitions?: unknown }).definitions;
      if (!Array.isArray(definitions)) continue;

      for (const item of definitions) {
        if (!item || typeof item !== "object") continue;
        const definition = (item as { definition?: unknown }).definition;
        if (typeof definition === "string" && definition.trim()) {
          return definition.trim().slice(0, 220);
        }
      }
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  let body: { word?: unknown; startLetter?: unknown; endLetter?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      invalid("", "That answer could not be read."),
      { status: 400 }
    );
  }

  const rawWord = typeof body.word === "string" ? body.word.trim() : "";
  const word = normalizeWordboundWord(rawWord);
  const startLetter = normalizeWordboundLetter(
    typeof body.startLetter === "string" ? body.startLetter : ""
  ).toLowerCase();
  const endLetter = normalizeWordboundLetter(
    typeof body.endLetter === "string" ? body.endLetter : ""
  ).toLowerCase();

  if (!startLetter || !endLetter) {
    return NextResponse.json(
      invalid(word, "The round letters are missing."),
      { status: 400 }
    );
  }

  if (!/^[a-z]+$/.test(rawWord.toLowerCase()) || rawWord.length !== word.length) {
    return NextResponse.json(
      invalid(word, "Use letters only—no spaces, names, or punctuation."),
      { status: 200 }
    );
  }

  if (word.length < 3) {
    return NextResponse.json(
      invalid(word, "Words must have at least three letters."),
      { status: 200 }
    );
  }

  if (!word.startsWith(startLetter) || !word.endsWith(endLetter)) {
    return NextResponse.json(
      invalid(
        word,
        `Your word must start with ${startLetter.toUpperCase()} and end with ${endLetter.toUpperCase()}.`
      ),
      { status: 200 }
    );
  }

  const cached = validationCache.get(word);
  if (cached) return NextResponse.json(cached);

  const isKnownWord = gameDictionary.has(word);
  const acceptedWithoutDefinition = () =>
    remember(word, {
      valid: true,
      word,
      definition: "Valid English word. Its definition is temporarily unavailable.",
    });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DICTIONARY_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      }
    );

    if (response.status === 404) {
      if (isKnownWord) {
        return NextResponse.json(acceptedWithoutDefinition());
      }
      return NextResponse.json(
        remember(word, invalid(word, "We couldn’t find that word in the dictionary."))
      );
    }

    if (!response.ok) {
      throw new Error(`Dictionary returned ${response.status}`);
    }

    const definition = firstDefinition(await response.json());
    if (!definition) {
      if (isKnownWord) {
        return NextResponse.json(acceptedWithoutDefinition());
      }
      return NextResponse.json(
        remember(word, invalid(word, "That entry isn’t accepted for this game."))
      );
    }

    return NextResponse.json(
      remember(word, { valid: true, word, definition })
    );
  } catch {
    if (isKnownWord) {
      return NextResponse.json(acceptedWithoutDefinition());
    }
    return NextResponse.json(
      invalid(word, "The dictionary is taking a break. Please try again."),
      { status: 503 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

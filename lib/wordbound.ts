export const WORDBOUND_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const WORDBOUND_ROUNDS = 5;
export const WORDBOUND_SECONDS = 30;

export function normalizeWordboundWord(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 30);
}

export function normalizeWordboundLetter(value: string) {
  const letter = value.trim().toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : "";
}

export function calculateWordboundPoints(secondsLeft: number) {
  return 100 + Math.max(0, Math.floor(secondsLeft)) * 10;
}

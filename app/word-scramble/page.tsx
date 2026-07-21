import { WordScrambleRaceGame } from "@/components/WordScrambleRaceGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Word Scramble Race",
  description:
    "Unscramble Bible words against the clock in solo play or a live multiplayer race.",
};

export default function WordScramblePage() {
  return <WordScrambleRaceGame />;
}

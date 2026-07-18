import { WordSearchGame } from "@/components/WordSearchGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Word Search",
  description:
    "Race friends in a multiplayer Bible word search and score points for every hidden word you find.",
};

export default function WordSearchPage() {
  return <WordSearchGame />;
}

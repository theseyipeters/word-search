import { TriviaBattleGame } from "@/components/TriviaBattleGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trivia Battle",
  description:
    "Battle friends with AI-generated Bible trivia questions, difficulty levels, speed bonuses, and a live leaderboard.",
};

export default function TriviaBattlePage() {
  return <TriviaBattleGame />;
}

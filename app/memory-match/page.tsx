import { MemoryMatchGame } from "@/components/MemoryMatchGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memory Match",
  description:
    "Play multiplayer Memory Match, flip Bible-themed cards, find pairs, and compete for the highest score.",
};

export default function MemoryMatchPage() {
  return <MemoryMatchGame />;
}

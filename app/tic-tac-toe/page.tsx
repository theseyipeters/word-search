import { TicTacToeGame } from "@/components/TicTacToeGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tic Tac Toe",
  description:
    "Play multiplayer Tic Tac Toe with room invites, turn tracking, rematches, and a clean game board.",
};

export default function TicTacToePage() {
  return <TicTacToeGame />;
}

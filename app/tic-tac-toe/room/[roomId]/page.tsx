import { TicTacToeGame } from "@/components/TicTacToeGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tic Tac Toe Room",
  description:
    "Join a multiplayer Tic Tac Toe room, take turns, and start rematches with friends.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function TicTacToeRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <TicTacToeGame roomId={decodeURIComponent(roomId)} />;
}

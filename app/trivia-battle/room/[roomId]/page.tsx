import { TriviaBattleGame } from "@/components/TriviaBattleGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trivia Battle Room",
  description:
    "Join a multiplayer Bible trivia battle with AI-generated questions, difficulty levels, and live scoring.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function TriviaBattleRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <TriviaBattleGame roomId={decodeURIComponent(roomId)} />;
}

import { WordSearchGame } from "@/components/WordSearchGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Word Search Room",
  description:
    "Join a multiplayer Bible word search room and race friends to find hidden words.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function WordSearchRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <WordSearchGame roomId={decodeURIComponent(roomId)} />;
}

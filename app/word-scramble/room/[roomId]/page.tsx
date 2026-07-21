import { WordScrambleRaceGame } from "@/components/WordScrambleRaceGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Word Scramble Race Room",
  description:
    "Join a live Word Scramble Race room and solve the same Bible words before your friends.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function WordScrambleRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  return <WordScrambleRaceGame roomId={decodeURIComponent(roomId)} />;
}

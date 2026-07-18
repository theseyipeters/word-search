import { MemoryMatchGame } from "@/components/MemoryMatchGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memory Match Room",
  description:
    "Join a multiplayer Memory Match room, flip cards, find pairs, and compete for the best score.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function MemoryMatchRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <MemoryMatchGame roomId={decodeURIComponent(roomId)} />;
}

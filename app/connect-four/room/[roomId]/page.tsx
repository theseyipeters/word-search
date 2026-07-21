import { ConnectFourGame } from "@/components/ConnectFourGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect Four Room",
  description:
    "Join a multiplayer Connect Four room, take turns dropping discs, and race to connect four.",
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function ConnectFourRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  return <ConnectFourGame roomId={decodeURIComponent(roomId)} />;
}

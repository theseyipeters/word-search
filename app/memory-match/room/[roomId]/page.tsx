import { MemoryMatchGame } from "@/components/MemoryMatchGame";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function MemoryMatchRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <MemoryMatchGame roomId={decodeURIComponent(roomId)} />;
}

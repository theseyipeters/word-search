import { TriviaBattleGame } from "@/components/TriviaBattleGame";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function TriviaBattleRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <TriviaBattleGame roomId={decodeURIComponent(roomId)} />;
}

import { WordSearchGame } from "@/components/WordSearchGame";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function WordSearchRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <WordSearchGame roomId={decodeURIComponent(roomId)} />;
}

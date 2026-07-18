import { TicTacToeGame } from "@/components/TicTacToeGame";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function TicTacToeRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return <TicTacToeGame roomId={decodeURIComponent(roomId)} />;
}

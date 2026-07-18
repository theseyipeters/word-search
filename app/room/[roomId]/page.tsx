import { redirect } from "next/navigation";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  redirect(`/word-search/room/${encodeURIComponent(roomId)}`);
}

import { WordboundGame } from "@/components/WordboundGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wordbound Room",
  description:
    "Join a live Wordbound room, choose a letter, and race to connect the bookends.",
  openGraph: {
    title: "Join a Wordbound room",
    description: "Two letters. One word between them.",
    images: [
      {
        url: "/wordbound-og.png",
        width: 1731,
        height: 909,
        alt: "Wordbound — connect T and F with the word thief",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Join a Wordbound room",
    description: "Two letters. One word between them.",
    images: ["/wordbound-og.png"],
  },
};

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function WordboundRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  return <WordboundGame roomId={decodeURIComponent(roomId)} />;
}

import { WordboundGame } from "@/components/WordboundGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wordbound",
  description:
    "Choose the bookend letters, then race to find a real English word that connects them.",
  openGraph: {
    title: "Wordbound",
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
    title: "Wordbound",
    description: "Two letters. One word between them.",
    images: ["/wordbound-og.png"],
  },
};

export default function WordboundPage() {
  return <WordboundGame />;
}

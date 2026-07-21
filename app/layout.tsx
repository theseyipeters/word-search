import type { Metadata, Viewport } from "next";
import { Jost, Oxygen } from "next/font/google";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
});

const oxygen = Oxygen({
  subsets: ["latin"], 
  weight:"700",
  variable:"--font-oxygen"
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Bible Games Hub",
    template: "%s | Bible Games Hub",
  },
  description:
    "Play Bible-inspired games together, including Word Search, Tic Tac Toe, Memory Match, Trivia Battle, Connect Four, and Word Scramble Race.",
  applicationName: "Bible Games Hub",
  keywords: [
    "Bible games",
    "multiplayer games",
    "Bible trivia",
    "word search",
    "tic tac toe",
    "memory match",
    "connect four",
    "word scramble",
    "party games",
  ],
  authors: [{ name: "Bible Games Hub" }],
  creator: "Bible Games Hub",
  publisher: "Bible Games Hub",
  openGraph: {
    title: "Bible Games Hub",
    description:
      "Play Bible-inspired games together, including Word Search, Tic Tac Toe, Memory Match, Trivia Battle, Connect Four, and Word Scramble Race.",
    type: "website",
    siteName: "Bible Games Hub",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Play, connect, and grow together with Bible games",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bible Games Hub",
    description:
      "Play Bible-inspired games together, including Word Search, Tic Tac Toe, Memory Match, Trivia Battle, Connect Four, and Word Scramble Race.",
    images: ["/og.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Bible Games Hub",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jost.variable} ${oxygen.variable}`}>
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}

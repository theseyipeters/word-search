import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

const jost = localFont({
  src: "../public/social/Oxygen-Bold.woff2",
  variable: "--font-jost",
  weight: "700",
  display: "swap",
});

const oxygen = localFont({
  src: "../public/social/Oxygen-Bold.woff2",
  variable: "--font-oxygen",
  weight: "700",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Bible Games Hub",
    template: "%s | Bible Games Hub",
  },
  description:
    "Play fast multiplayer games together, including Word Search, Trivia Battle, Connect Four, Word Scramble Race, and Wordbound.",
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
    "word game",
    "wordbound",
    "party games",
  ],
  authors: [{ name: "Bible Games Hub" }],
  creator: "Bible Games Hub",
  publisher: "Bible Games Hub",
  openGraph: {
    title: "Bible Games Hub",
    description:
      "Play fast multiplayer games together, including Word Search, Trivia Battle, Connect Four, Word Scramble Race, and Wordbound.",
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
      "Play fast multiplayer games together, including Word Search, Trivia Battle, Connect Four, Word Scramble Race, and Wordbound.",
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

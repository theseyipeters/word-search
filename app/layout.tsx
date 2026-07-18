import type { Metadata } from "next";
import { Jost, Oxygen } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Word Search",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={oxygen.variable}>{children}</body>
    </html>
  );
}

import { ConnectFourGame } from "@/components/ConnectFourGame";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect Four",
  description:
    "Play Connect Four against the computer or invite a friend for a live five-game match.",
};

export default function ConnectFourPage() {
  return <ConnectFourGame />;
}

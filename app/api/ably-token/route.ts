import { NextResponse, type NextRequest } from "next/server";
import * as Ably from "ably/promises";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  const clientId =
    request.nextUrl.searchParams.get("clientId") ||
    `player-${crypto.randomUUID()}`;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ABLY_API_KEY in the server environment." },
      { status: 500 }
    );
  }

  const client = new Ably.Rest(apiKey);
  const tokenRequest = await client.auth.createTokenRequest({
    clientId,
    ttl: 60 * 60 * 1000,
    capability: JSON.stringify({
      "word-search:*": ["publish", "subscribe", "presence"],
      "tic-tac-toe:*": ["publish", "subscribe", "presence"],
      "memory-match:*": ["publish", "subscribe", "presence"],
      "trivia-battle:*": ["publish", "subscribe", "presence"],
      "connect-four:*": ["publish", "subscribe", "presence"],
      "word-scramble:*": ["publish", "subscribe", "presence"],
      "wordbound:*": ["publish", "subscribe", "presence"],
    }),
  });

  return NextResponse.json(tokenRequest);
}

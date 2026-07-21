import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const LOCAL_INGEST_KEY = "guidde-local-game-metrics";

function analyticsConfig() {
  const isDevelopment = process.env.NODE_ENV !== "production";
  return {
    endpoint:
      process.env.GUIDDE_GAME_EVENTS_URL ||
      (isDevelopment ? "http://localhost:3000/api/v1/game-events" : undefined),
    ingestKey:
      process.env.GAME_METRICS_INGEST_KEY ||
      (isDevelopment ? LOCAL_INGEST_KEY : undefined),
    isDevelopment,
  };
}

function pointsBackToPlay(request: NextRequest, endpoint?: string) {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { endpoint, ingestKey } = analyticsConfig();
  const selfReferential = pointsBackToPlay(request, endpoint);
  return NextResponse.json({
    configured: Boolean(endpoint && ingestKey && !selfReferential),
    endpoint: endpoint || null,
    ...(selfReferential ? { error: "Analytics endpoint points back to Play" } : {}),
  });
}

export async function POST(request: NextRequest) {
  const { endpoint, ingestKey } = analyticsConfig();

  if (!endpoint || !ingestKey) {
    console.error(
      "[GAME_EVENT_CONFIG_ERROR] Set GUIDDE_GAME_EVENTS_URL and GAME_METRICS_INGEST_KEY.",
    );
    return NextResponse.json(
      { accepted: false, configured: false },
      { status: 503 },
    );
  }

  if (pointsBackToPlay(request, endpoint)) {
    console.error(
      "[GAME_EVENT_CONFIG_ERROR] GUIDDE_GAME_EVENTS_URL points back to the Play app.",
    );
    return NextResponse.json(
      { accepted: false, error: "Analytics endpoint points back to Play" },
      { status: 503 },
    );
  }

  try {
    const body = await request.text();
    if (body.length > 32_000) {
      return NextResponse.json({ error: "Event is too large" }, { status: 413 });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-guidde-game-key": ingestKey,
      },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("[GAME_EVENT_FORWARD_ERROR]", response.status);
      return NextResponse.json({ accepted: false }, { status: 502 });
    }

    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.error("[GAME_EVENT_FORWARD_ERROR]", error);
    return NextResponse.json({ accepted: false }, { status: 502 });
  }
}

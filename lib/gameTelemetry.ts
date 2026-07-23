export const GAME_KEYS = [
  "word-search",
  "tic-tac-toe",
  "memory-match",
  "trivia-battle",
  "connect-four",
  "word-scramble",
  "wordbound",
] as const;

export type GameKey = (typeof GAME_KEYS)[number];
export type GameMode = "single" | "multiplayer";
export type GameEventType =
  | "game_viewed"
  | "single_game_started"
  | "room_created"
  | "room_joined"
  | "game_started"
  | "game_completed"
  | "rematch_started";

type GameEventProperties = Record<
  string,
  string | number | boolean | null | string[] | number[]
>;

type TrackGameEventOptions = {
  mode?: GameMode | null;
  sessionId?: string | null;
  roomId?: string | null;
  properties?: GameEventProperties;
};

const ANONYMOUS_ID_KEY = "guidde-play-anonymous-id";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getAnonymousId() {
  if (typeof window === "undefined") return "server-render";
  const existing = localStorage.getItem(ANONYMOUS_ID_KEY);
  if (existing) return existing;
  const next = createId();
  localStorage.setItem(ANONYMOUS_ID_KEY, next);
  return next;
}

function activeSessionKey(game: GameKey, roomId?: string | null) {
  return `guidde-play-active-session:${game}:${roomId || "single"}`;
}

function startedAtKey(sessionId: string) {
  return `guidde-play-session-started:${sessionId}`;
}

function completedKey(sessionId: string) {
  return `guidde-play-session-completed:${sessionId}`;
}

export function trackGameEvent(
  game: GameKey,
  eventType: GameEventType,
  options: TrackGameEventOptions = {},
) {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    eventId: createId(),
    eventType,
    game,
    mode: options.mode ?? null,
    sessionId: options.sessionId ?? null,
    roomId: options.roomId ?? null,
    anonymousId: getAnonymousId(),
    clientTimestamp: new Date().toISOString(),
    properties: options.properties ?? {},
  });

  fetch("/api/game-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok && process.env.NODE_ENV !== "production") {
        console.warn(`[GAME_ANALYTICS] Event was not recorded (${response.status}).`);
      }
    })
    .catch(() => {
      // Analytics must never interrupt a game.
    });
}

export function trackGameView(game: GameKey, roomId?: string) {
  trackGameEvent(game, "game_viewed", {
    mode: roomId ? "multiplayer" : null,
    roomId: roomId || null,
  });
}

export function trackRoomCreated(game: GameKey, roomId: string) {
  const sessionId = createId();
  sessionStorage.setItem(activeSessionKey(game, roomId), sessionId);
  trackGameEvent(game, "room_created", {
    mode: "multiplayer",
    sessionId,
    roomId,
  });
  return sessionId;
}

export function trackRoomJoined(
  game: GameKey,
  roomId: string,
  isHost: boolean,
) {
  const joinedKey = `guidde-play-room-joined:${game}:${roomId}`;
  if (sessionStorage.getItem(joinedKey)) return;
  sessionStorage.setItem(joinedKey, "1");
  trackGameEvent(game, "room_joined", {
    mode: "multiplayer",
    roomId,
    properties: { isHost },
  });
}

export function trackGameStarted(
  game: GameKey,
  mode: GameMode,
  roomId?: string,
  properties: GameEventProperties = {},
) {
  const sessionId = createId();
  sessionStorage.setItem(activeSessionKey(game, roomId), sessionId);
  sessionStorage.setItem(startedAtKey(sessionId), String(Date.now()));
  trackGameEvent(game, mode === "single" ? "single_game_started" : "game_started", {
    mode,
    sessionId,
    roomId: roomId || null,
    properties,
  });
  return sessionId;
}

export function trackGameCompleted(
  game: GameKey,
  mode: GameMode,
  roomId?: string,
  properties: GameEventProperties = {},
) {
  const sessionId = sessionStorage.getItem(activeSessionKey(game, roomId));
  if (!sessionId || sessionStorage.getItem(completedKey(sessionId))) return;

  sessionStorage.setItem(completedKey(sessionId), "1");
  const startedAt = Number(sessionStorage.getItem(startedAtKey(sessionId)) || Date.now());
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  trackGameEvent(game, "game_completed", {
    mode,
    sessionId,
    roomId: roomId || null,
    properties: { ...properties, durationSeconds },
  });
}

export function trackRematchStarted(
  game: GameKey,
  mode: GameMode,
  roomId?: string,
  properties: GameEventProperties = {},
) {
  trackGameEvent(game, "rematch_started", {
    mode,
    roomId: roomId || null,
    properties,
  });
  return trackGameStarted(game, mode, roomId, properties);
}

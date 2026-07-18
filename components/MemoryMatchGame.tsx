"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import { useRouter } from "next/navigation";
import { createRoomId } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";

type Player = {
  id: string;
  name: string;
};
type Card = {
  id: number;
  value: string;
};
type FlipEvent = {
  cardId: number;
  playerId: string;
  playerName: string;
};
type ResetEvent = {
  resetId: string;
  playerName: string;
};
type GameState = {
  flipped: number[];
  matched: number[];
  matchedBy: Record<number, string>;
  scores: Record<string, number>;
  locked: boolean;
  currentTurnId: string | null;
};

const CARD_VALUES = ["FAITH", "GRACE", "HOPE", "PEACE", "TRUTH", "MERCY", "LIGHT", "JOY"];

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashSeed(seed) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function createDeck(seed: string): Card[] {
  const random = seededRandom(seed);
  const cards = CARD_VALUES.flatMap((value, index) => [
    { id: index * 2, value },
    { id: index * 2 + 1, value },
  ]);

  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards.map((card, index) => ({ ...card, id: index }));
}

function emptyGameState(): GameState {
  return {
    flipped: [],
    matched: [],
    matchedBy: {},
    scores: {},
    locked: false,
    currentTurnId: null,
  };
}

function getOrCreatePlayer(): Player {
  const existingId = localStorage.getItem("games-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) return { id: existingId, name: existingName };

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  localStorage.setItem("games-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name };
}

function nextTurnAfter(playerId: string, turnPlayers: Player[]) {
  if (turnPlayers.length < 2) return playerId;
  const index = turnPlayers.findIndex((player) => player.id === playerId);
  if (index < 0) return turnPlayers[0].id;
  return turnPlayers[(index + 1) % turnPlayers.length].id;
}

function useMemoryRoom(
  roomId: string | undefined,
  onFlip: (event: FlipEvent) => void,
  onReset: (event: ResetEvent) => void
) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [channel, setChannel] =
    useState<Ably.Types.RealtimeChannelPromise | null>(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    setPlayer(getOrCreatePlayer());
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !player) return;

    const client = new Ably.Realtime({
      authUrl: `/api/ably-token?clientId=${encodeURIComponent(player.id)}`,
      clientId: player.id,
      closeOnUnload: true,
    });
    const roomChannel = client.channels.get(`memory-match:${roomId}`, {
      params: { rewind: "100" },
    });
    let mounted = true;

    const refreshPresence = async () => {
      try {
        const members = await roomChannel.presence.get();
        if (!mounted) return;
        setPlayers(
          members
            .map((member) => {
              const data = member.data as Partial<Player> | undefined;
              return { id: member.clientId, name: data?.name || "Player" };
            })
            .sort((a, b) => a.id.localeCompare(b.id))
        );
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Presence failed");
      }
    };

    const handleFlip = (message: Ably.Types.Message) => {
      const data = message.data as Partial<FlipEvent>;
      if (
        typeof data.cardId === "number" &&
        typeof data.playerId === "string"
      ) {
        onFlip({
          cardId: data.cardId,
          playerId: data.playerId,
          playerName: data.playerName || "Player",
        });
      }
    };

    const handleReset = (message: Ably.Types.Message) => {
      const data = message.data as Partial<ResetEvent>;
      if (typeof data.resetId === "string") {
        onReset({ resetId: data.resetId, playerName: data.playerName || "Player" });
      }
    };

    client.connection.on((change) => {
      if (!mounted) return;
      setConnectionState(change.current);
      if (change.reason) setError(change.reason.message);
    });

    roomChannel
      .subscribe("flip", handleFlip)
      .then(() => roomChannel.subscribe("reset", handleReset))
      .then(() => roomChannel.presence.subscribe(refreshPresence))
      .then(() => roomChannel.presence.enter({ name: player.name }))
      .then(refreshPresence)
      .then(() => {
        if (mounted) {
          setChannel(roomChannel);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Could not join room");
        }
      });

    return () => {
      mounted = false;
      roomChannel.unsubscribe("flip", handleFlip);
      roomChannel.unsubscribe("reset", handleReset);
      roomChannel.presence.unsubscribe(refreshPresence);
      roomChannel.presence.leave().catch(() => {});
      client.close();
    };
  }, [onFlip, onReset, player?.id, roomId]);

  const publishFlip = useCallback(
    async (cardId: number) => {
      if (!channel || !player) return;
      await channel.publish("flip", {
        cardId,
        playerId: player.id,
        playerName: player.name,
      } satisfies FlipEvent);
    },
    [channel, player]
  );

  const publishReset = useCallback(async () => {
    if (!channel || !player) return;
    await channel.publish("reset", {
      resetId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      playerName: player.name,
    } satisfies ResetEvent);
  }, [channel, player]);

  const updatePlayerName = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 18);
      if (!cleanName) return;
      localStorage.setItem("games-player-name", cleanName);
      setPlayer((current) => (current ? { ...current, name: cleanName } : current));
      channel?.presence.update({ name: cleanName }).catch(() => {});
    },
    [channel]
  );

  return {
    connectionState,
    error,
    player,
    players,
    publishFlip,
    publishReset,
    updatePlayerName,
  };
}

export function MemoryMatchGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [deckSeed, setDeckSeed] = useState(() => roomId || createRoomId());
  const [state, setState] = useState<GameState>(() => emptyGameState());
  const [feed, setFeed] = useState<string[]>([]);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<GameState>(emptyGameState());
  const isMultiplayer = Boolean(roomId);

  const deck = useMemo(() => createDeck(deckSeed), [deckSeed]);
  const turnPlayersRef = useRef<Player[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyReset = useCallback((event: ResetEvent) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    const nextState = emptyGameState();
    setDeckSeed(event.resetId);
    stateRef.current = nextState;
    setState(nextState);
    setFeed((events) => [`${event.playerName} started a new match`, ...events].slice(0, 5));
  }, []);

  const applyFlip = useCallback(
    (event: FlipEvent) => {
      const current = stateRef.current;
      const turnPlayers = turnPlayersRef.current.slice(0, 2);
      const isAllowedPlayer =
        turnPlayers.length === 0 ||
        turnPlayers.some((player) => player.id === event.playerId);

      if (!isAllowedPlayer) return;
      if (current.locked || current.matched.includes(event.cardId)) return;
      if (current.flipped.includes(event.cardId)) return;
      if (current.currentTurnId && current.currentTurnId !== event.playerId) return;
      if (current.flipped.length >= 2) return;

      const flipped = [...current.flipped, event.cardId];
      let next: GameState = {
        ...current,
        flipped,
        currentTurnId: current.currentTurnId || event.playerId,
      };
      let feedText =
        flipped.length === 1 ? `${event.playerName} flipped a card` : null;
      let mismatch: { cards: number[]; playerId: string } | null = null;

      if (flipped.length === 2) {
        const [firstId, secondId] = flipped;
        const isMatch = deck[firstId]?.value === deck[secondId]?.value;

        if (isMatch) {
          feedText = `${event.playerName} matched ${deck[firstId].value}`;
          next = {
            ...next,
            flipped: [],
            matched: [...current.matched, firstId, secondId],
            matchedBy: {
              ...current.matchedBy,
              [firstId]: event.playerName,
              [secondId]: event.playerName,
            },
            scores: {
              ...current.scores,
              [event.playerName]: (current.scores[event.playerName] || 0) + 1,
            },
          };
        } else {
          feedText = `${event.playerName} missed`;
          mismatch = { cards: flipped, playerId: event.playerId };
          next = {
            ...next,
            locked: true,
          };
        }
      }

      stateRef.current = next;
      setState(next);

      if (feedText) {
        setFeed((events) => [feedText, ...events].slice(0, 5));
      }

      if (mismatch) {
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => {
          const currentState = stateRef.current;
          if (currentState.flipped.join(",") !== mismatch.cards.join(",")) return;

          const nextState = {
            ...currentState,
            flipped: [],
            locked: false,
            currentTurnId: nextTurnAfter(
              mismatch.playerId,
              turnPlayersRef.current.slice(0, 2)
            ),
          };
          stateRef.current = nextState;
          setState(nextState);
        }, 850);
      }
    },
    [deck]
  );

  const {
    connectionState,
    error,
    player,
    players,
    publishFlip,
    publishReset,
    updatePlayerName,
  } = useMemoryRoom(roomId, applyFlip, applyReset);

  const localPlayers = useMemo(
    () => [
      { id: "local-1", name: "Player 1" },
      { id: "local-2", name: "Player 2" },
    ],
    []
  );
  const turnPlayers = isMultiplayer ? players.slice(0, 2) : localPlayers;

  useEffect(() => {
    turnPlayersRef.current = turnPlayers;
  }, [turnPlayers]);

  useEffect(() => {
    if (state.currentTurnId || turnPlayers.length === 0) return;
    setState((current) => {
      if (current.currentTurnId) return current;
      const next = { ...current, currentTurnId: turnPlayers[0].id };
      stateRef.current = next;
      return next;
    });
  }, [state.currentTurnId, turnPlayers]);

  const currentPlayer = turnPlayers.find((roomPlayer) => roomPlayer.id === state.currentTurnId);
  const isComplete = state.matched.length === deck.length;
  const scoreRows = useMemo(() => {
    const rows = new Map<string, { name: string; score: number }>();
    turnPlayers.forEach((roomPlayer) => {
      rows.set(roomPlayer.name, {
        name: roomPlayer.name,
        score: state.scores[roomPlayer.name] || 0,
      });
    });
    Object.entries(state.scores).forEach(([name, score]) => {
      if (!rows.has(name)) rows.set(name, { name, score });
    });
    return [...rows.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [state.scores, turnPlayers]);
  const myTurn = !isMultiplayer || (player && state.currentTurnId === player.id);
  const connectionLabel = !isMultiplayer
    ? null
    : error
      ? "Offline"
      : connectionState === "connected"
        ? "Live"
        : "Connecting";

  const handleCreateRoom = useCallback(() => {
    router.push(`/memory-match/room/${createRoomId()}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleCardClick = useCallback(
    (cardId: number) => {
      if (state.locked || state.matched.includes(cardId) || state.flipped.includes(cardId) || isComplete) return;

      if (!isMultiplayer) {
        const localPlayer =
          turnPlayers.find((turnPlayer) => turnPlayer.id === state.currentTurnId) || localPlayers[0];
        applyFlip({ cardId, playerId: localPlayer.id, playerName: localPlayer.name });
        return;
      }

      if (!player || !myTurn) return;
      publishFlip(cardId).catch(() => {});
    },
    [applyFlip, isComplete, isMultiplayer, localPlayers, myTurn, player, publishFlip, state.currentTurnId, state.flipped, state.locked, state.matched, turnPlayers]
  );

  const handleReset = useCallback(() => {
    if (!isMultiplayer) {
      applyReset({ resetId: createRoomId(), playerName: "Player 1" });
      setFeed([]);
      return;
    }
    publishReset().catch(() => {});
  }, [applyReset, isMultiplayer, publishReset]);

  const handleBackToMenu = useCallback(() => {
    router.push("/");
  }, [router]);

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Memory Match</p>
          <h1 style={styles.title}>
            {isComplete ? "All pairs found" : `${currentPlayer?.name || "Player"}'s turn`}
          </h1>
        </div>
        <div style={styles.headerRight}>
          {connectionLabel && (
            <span
              style={{
                ...styles.statusBadge,
                ...(connectionLabel === "Live" ? styles.statusLive : {}),
              }}
            >
              {connectionLabel}
            </span>
          )}
          <button onClick={toggle} style={styles.secondaryBtn}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {!isMultiplayer && (
            <button onClick={handleCreateRoom} style={styles.primaryBtn}>
              Create Room
            </button>
          )}
          <button onClick={handleReset} style={styles.primaryBtn}>
            Rematch
          </button>
        </div>
      </header>

      {isMultiplayer && (
        <section style={styles.roomPanel}>
          <div>
            <strong>Room {roomId}</strong>
            <p style={styles.muted}>
              {player?.name || "Joining"} · {players.length} player
              {players.length === 1 ? "" : "s"}
            </p>
          </div>
          <div style={styles.roomActions}>
            <input
              aria-label="Player name"
              defaultValue={player?.name || ""}
              onBlur={(event) => updatePlayerName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="Your name"
              style={styles.nameInput}
            />
            <button onClick={handleCopyInvite} style={styles.secondaryBtn}>
              {copiedInvite ? "Copied" : "Copy Invite"}
            </button>
          </div>
        </section>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.gameArea}>
        <div style={styles.board}>
          {deck.map((card) => {
            const isVisible = state.flipped.includes(card.id) || state.matched.includes(card.id);
            return (
              <button
                key={card.id}
                onClick={() => handleCardClick(card.id)}
                style={{
                  ...styles.card,
                  ...(isVisible ? styles.cardVisible : {}),
                  ...(state.matched.includes(card.id) ? styles.cardMatched : {}),
                }}
              >
                {isVisible ? card.value : ""}
              </button>
            );
          })}
        </div>

        <aside style={styles.sidePanel}>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Scores</h2>
            <div style={styles.scoreRows}>
              {scoreRows.map((row, index) => (
                <div key={row.name} style={styles.scoreRow}>
                  <span style={styles.rank}>{index + 1}</span>
                  <span style={styles.playerName}>{row.name}</span>
                  <strong>{row.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Activity</h2>
            {feed.length === 0 ? (
              <p style={styles.muted}>Waiting for the first flip</p>
            ) : (
              <div style={styles.feed}>
                {feed.map((event, index) => (
                  <p key={`${event}-${index}`} style={styles.feedItem}>
                    {event}
                  </p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>

      {isComplete && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalEyebrow}>Game Over</p>
            <h2 style={styles.modalTitle}>All pairs found</h2>
            <div style={styles.modalActions}>
              <button onClick={handleReset} style={styles.primaryBtn}>
                Rematch
              </button>
              <button onClick={handleBackToMenu} style={styles.secondaryBtn}>
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    width: "min(100% - 32px, 1040px)",
    margin: "0 auto",
    padding: "28px 0",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
  title: {
    marginTop: "4px",
    fontSize: "clamp(1.8rem, 6vw, 3rem)",
    lineHeight: 1,
    fontWeight: 800,
  },
  statusBadge: {
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "0.75rem",
    fontWeight: 800,
    background: "var(--bg-tertiary)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
  },
  statusLive: {
    background: "#dff8e8",
    borderColor: "#a8e7bd",
    color: "#176b35",
  },
  primaryBtn: {
    minHeight: "40px",
    padding: "0 16px",
    borderRadius: "8px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "0.9rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryBtn: {
    minHeight: "40px",
    padding: "0 14px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "0.9rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  roomPanel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "14px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    flexWrap: "wrap",
  },
  roomActions: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  nameInput: {
    width: "150px",
    height: "40px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "0.9rem",
    fontWeight: 700,
  },
  muted: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  error: {
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #f2b8b5",
    background: "#fff1f0",
    color: "#8c1d18",
    fontSize: "0.85rem",
  },
  gameArea: {
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: "24px",
    flexWrap: "wrap",
  },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gridTemplateRows: "repeat(4, 1fr)",
    gap: "8px",
    width: "min(100%, 560px)",
    aspectRatio: "1",
  },
  card: {
    appearance: "none",
    WebkitAppearance: "none",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    padding: "8px",
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: "8px",
    border: "2px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "transparent",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "clamp(0.7rem, 2.8vw, 1.1rem)",
    fontWeight: 900,
    cursor: "pointer",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  cardVisible: {
    color: "var(--text)",
    background: "var(--bg)",
  },
  cardMatched: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  sidePanel: {
    flex: "1 1 240px",
    maxWidth: "300px",
    minWidth: "240px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  panel: {
    padding: "14px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
  },
  panelTitle: {
    marginBottom: "12px",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
  scoreRows: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  scoreRow: {
    display: "grid",
    gridTemplateColumns: "28px 1fr auto",
    alignItems: "center",
    gap: "8px",
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  rank: {
    width: "22px",
    height: "22px",
    borderRadius: "999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontSize: "0.72rem",
    fontWeight: 900,
  },
  playerName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 800,
  },
  feed: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  feedItem: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    lineHeight: 1.35,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "rgba(0,0,0,0.62)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 100,
  },
  modal: {
    width: "min(100%, 360px)",
    padding: "28px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    boxShadow: "0 24px 48px var(--shadow)",
    textAlign: "center",
  },
  modalEyebrow: {
    color: "var(--text-secondary)",
    fontSize: "0.78rem",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginBottom: "8px",
  },
  modalTitle: {
    fontSize: "2rem",
    lineHeight: 1,
    fontWeight: 900,
    marginBottom: "22px",
  },
  modalActions: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
};

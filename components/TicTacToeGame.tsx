"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import { useRouter } from "next/navigation";
import { createRoomId } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";

type Mark = "X" | "O";
type Cell = Mark | null;
type Player = {
  id: string;
  name: string;
};
type MoveEvent = {
  cell: number;
  symbol: Mark;
  playerId: string;
  playerName: string;
};
type ResetEvent = {
  resetId: string;
  playerName: string;
};
type FeedEvent = {
  text: string;
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

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

function getWinner(board: Cell[]) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { symbol: board[a] as Mark, line };
    }
  }
  return null;
}

function nextTurn(board: Cell[]): Mark {
  const xCount = board.filter((cell) => cell === "X").length;
  const oCount = board.filter((cell) => cell === "O").length;
  return xCount <= oCount ? "X" : "O";
}

function useTicTacToeRoom(roomId: string | undefined, onMove: (move: MoveEvent) => void, onReset: (reset: ResetEvent) => void) {
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
    const roomChannel = client.channels.get(`tic-tac-toe:${roomId}`, {
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

    const handleMove = (message: Ably.Types.Message) => {
      const data = message.data as Partial<MoveEvent>;
      if (
        typeof data.cell === "number" &&
        (data.symbol === "X" || data.symbol === "O") &&
        typeof data.playerId === "string"
      ) {
        onMove({
          cell: data.cell,
          symbol: data.symbol,
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
      .subscribe("move", handleMove)
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
      roomChannel.unsubscribe("move", handleMove);
      roomChannel.unsubscribe("reset", handleReset);
      roomChannel.presence.unsubscribe(refreshPresence);
      roomChannel.presence.leave().catch(() => {});
      client.close();
    };
  }, [onMove, onReset, player?.id, roomId]);

  const publishMove = useCallback(
    async (cell: number, symbol: Mark) => {
      if (!channel || !player) return;
      await channel.publish("move", {
        cell,
        symbol,
        playerId: player.id,
        playerName: player.name,
      } satisfies MoveEvent);
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
    channel,
    connectionState,
    error,
    player,
    players,
    publishMove,
    publishReset,
    updatePlayerName,
  };
}

export function TicTacToeGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [localTurn, setLocalTurn] = useState<Mark>("X");
  const isMultiplayer = Boolean(roomId);

  const applyMove = useCallback((move: MoveEvent) => {
    setBoard((current) => {
      if (current[move.cell] || getWinner(current)) return current;
      if (nextTurn(current) !== move.symbol) return current;
      const next = [...current];
      next[move.cell] = move.symbol;
      return next;
    });
    setFeed((events) => [
      { text: `${move.playerName} placed ${move.symbol}` },
      ...events,
    ].slice(0, 5));
  }, []);

  const applyReset = useCallback((reset: ResetEvent) => {
    setBoard(Array(9).fill(null));
    setLocalTurn("X");
    setFeed((events) => [
      { text: `${reset.playerName} started a rematch` },
      ...events,
    ].slice(0, 5));
  }, []);

  const {
    connectionState,
    error,
    player,
    players,
    publishMove,
    publishReset,
    updatePlayerName,
  } = useTicTacToeRoom(roomId, applyMove, applyReset);

  const assignments = useMemo(() => {
    const map = new Map<string, Mark>();
    players.slice(0, 2).forEach((roomPlayer, index) => {
      map.set(roomPlayer.id, index === 0 ? "X" : "O");
    });
    return map;
  }, [players]);

  const winner = getWinner(board);
  const turn = nextTurn(board);
  const isDraw = !winner && board.every(Boolean);
  const mySymbol = player ? assignments.get(player.id) : undefined;
  const isMyTurn = !isMultiplayer || mySymbol === turn;
  const playerX = players.find((roomPlayer) => assignments.get(roomPlayer.id) === "X");
  const playerO = players.find((roomPlayer) => assignments.get(roomPlayer.id) === "O");
  const connectionLabel = !isMultiplayer
    ? null
    : error
      ? "Offline"
      : connectionState === "connected"
        ? "Live"
        : "Connecting";

  const handleCreateRoom = useCallback(() => {
    router.push(`/tic-tac-toe/room/${createRoomId()}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleCellClick = useCallback(
    (cell: number) => {
      if (board[cell] || winner || isDraw) return;

      if (!isMultiplayer) {
        setBoard((current) => {
          if (current[cell] || getWinner(current)) return current;
          const next = [...current];
          next[cell] = localTurn;
          return next;
        });
        setLocalTurn((current) => (current === "X" ? "O" : "X"));
        return;
      }

      if (!mySymbol || !isMyTurn) return;
      publishMove(cell, mySymbol).catch(() => {});
    },
    [board, isDraw, isMultiplayer, isMyTurn, localTurn, mySymbol, publishMove, winner]
  );

  const handleReset = useCallback(() => {
    if (!isMultiplayer) {
      setBoard(Array(9).fill(null));
      setLocalTurn("X");
      setFeed([]);
      return;
    }
    publishReset().catch(() => {});
  }, [isMultiplayer, publishReset]);

  const handleBackToMenu = useCallback(() => {
    router.push("/");
  }, [router]);

  const statusText = winner
    ? `${winner.symbol} wins`
    : isDraw
      ? "Draw"
      : isMultiplayer
        ? mySymbol
          ? isMyTurn
            ? `Your turn (${mySymbol})`
            : `${turn}'s turn`
          : "Watching"
        : `${localTurn}'s turn`;

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Tic Tac Toe</p>
          <h1 style={styles.title}>{statusText}</h1>
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
            {isMultiplayer ? "Rematch" : "Reset"}
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
        <div style={styles.board} aria-label="Tic Tac Toe board">
          {board.map((cell, index) => {
            const isWinningCell = winner?.line.includes(index);
            return (
              <button
                key={index}
                onClick={() => handleCellClick(index)}
                style={{
                  ...styles.cell,
                  ...(isWinningCell ? styles.winningCell : {}),
                }}
                aria-label={`Cell ${index + 1}`}
              >
                {cell}
              </button>
            );
          })}
        </div>

        <aside style={styles.sidePanel}>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Players</h2>
            <div style={styles.playerRows}>
              <div style={styles.playerRow}>
                <span style={styles.symbol}>X</span>
                <span style={styles.playerName}>{playerX?.name || "Waiting"}</span>
              </div>
              <div style={styles.playerRow}>
                <span style={styles.symbol}>O</span>
                <span style={styles.playerName}>{playerO?.name || "Waiting"}</span>
              </div>
            </div>
          </section>

          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Activity</h2>
            {feed.length === 0 ? (
              <p style={styles.muted}>Waiting for the first move</p>
            ) : (
              <div style={styles.feed}>
                {feed.map((event, index) => (
                  <p key={`${event.text}-${index}`} style={styles.feedItem}>
                    {event.text}
                  </p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>

      {(winner || isDraw) && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalEyebrow}>Game Over</p>
            <h2 style={styles.modalTitle}>
              {winner ? `${winner.symbol} wins` : "It's a draw"}
            </h2>
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
    width: "min(100% - 32px, 980px)",
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
    gridTemplateColumns: "repeat(3, 1fr)",
    gridTemplateRows: "repeat(3, 1fr)",
    gridAutoRows: "1fr",
    gap: "8px",
    width: "min(100%, 460px)",
    aspectRatio: "1",
    alignItems: "stretch",
  },
  cell: {
    appearance: "none",
    WebkitAppearance: "none",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    padding: 0,
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: "8px",
    border: "2px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "clamp(3rem, 16vw, 6rem)",
    fontWeight: 900,
    lineHeight: 1,
    cursor: "pointer",
    outlineOffset: "2px",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  winningCell: {
    background: "var(--accent)",
    color: "var(--accent-text)",
    borderColor: "var(--accent)",
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
  playerRows: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  playerRow: {
    display: "grid",
    gridTemplateColumns: "34px 1fr",
    alignItems: "center",
    gap: "10px",
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  symbol: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    borderRadius: "999px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontSize: "0.85rem",
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createRoomId,
  GRID_SIZE,
  useWordSearch,
  type Position,
} from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";
import { useTimer } from "@/lib/useTimer";
import ui from "./WordSearchGame.module.css";

type WordSearchGameProps = {
  roomId?: string;
};

type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};

type FoundWordEvent = {
  word: string;
  playerId?: string;
  playerName: string;
  points?: number;
};

type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

function posFromEvent(
  e: React.MouseEvent | React.TouchEvent,
  gridRef: React.RefObject<HTMLDivElement | null>
): Position | null {
  const rect = gridRef.current?.getBoundingClientRect();
  if (!rect) return null;

  let clientX: number, clientY: number;
  if ("touches" in e) {
    if (e.touches.length === 0) return null;
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const cellSize = rect.width / GRID_SIZE;
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return null;
  return { row, col };
}

function getOrCreatePlayer(): Player {
  const existingId = sessionStorage.getItem("word-search-player-id");
  const existingName = localStorage.getItem("word-search-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name =
    existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("word-search-player-id", id);
  localStorage.setItem("word-search-player-name", name);
  return { id, name, ready: false, isHost: false };
}

function useAblyRoom(
  roomId: string | undefined,
  onFoundWord: (word: string, playerName: string, points: number) => void
) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [channel, setChannel] =
    useState<Ably.Types.RealtimeChannelPromise | null>(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const roomPlayer = getOrCreatePlayer();
    const roomHost =
      sessionStorage.getItem(`word-search-room-host:${roomId}`) === roomPlayer.id;
    setPlayer({ ...roomPlayer, isHost: roomHost });
    setIsHost(roomHost);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !player) return;

    const client = new Ably.Realtime({
      authUrl: `/api/ably-token?clientId=${encodeURIComponent(player.id)}`,
      clientId: player.id,
      closeOnUnload: true,
    });
    const roomChannel = client.channels.get(`word-search:${roomId}`, {
      params: { rewind: "100" },
    });

    let mounted = true;
    const handleRoomMessage = (message: Ably.Types.Message) => {
      if (message.name === "game-started") {
        if (mounted) setGameStarted(true);
        return;
      }

      if (message.name === "word-found") {
        const data = message.data as Partial<FoundWordEvent>;
        if (typeof data.word === "string") {
          onFoundWord(
            data.word,
            data.playerName || "Player",
            data.points || data.word.length
          );
        }
      }
    };

    const refreshPresence = async () => {
      try {
        const members = await roomChannel.presence.get();
        if (!mounted) return;
        setPlayers(
          members.map((member) => {
            const data = member.data as Partial<Player> | undefined;
            return {
              id: member.clientId,
              name: data?.name || "Player",
              ready: Boolean(data?.ready),
              isHost: Boolean(data?.isHost),
            };
          })
        );
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Presence failed");
      }
    };

    client.connection.on((change) => {
      if (!mounted) return;
      setConnectionState(change.current);
      if (change.reason) setError(change.reason.message);
    });

    roomChannel
      .subscribe(handleRoomMessage)
      .then(() => roomChannel.presence.subscribe(refreshPresence))
      .then(() =>
        roomChannel.presence.enter({
          name: player.name,
          ready: player.ready,
          isHost: player.isHost,
        })
      )
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
      roomChannel.unsubscribe(handleRoomMessage);
      roomChannel.presence.unsubscribe(refreshPresence);
      roomChannel.presence.leave().catch(() => {});
      client.close();
    };
  }, [onFoundWord, player?.id, roomId]);

  const publishFoundWord = useCallback(
    async (word: string) => {
      if (!channel || !player) return;
      await channel.publish("word-found", {
        word,
        playerId: player.id,
        playerName: player.name,
        points: word.length,
      } satisfies FoundWordEvent);
    },
    [channel, player]
  );

  const updatePlayerName = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 18);
      if (!cleanName) return;

      localStorage.setItem("word-search-player-name", cleanName);
      setPlayer((current) => {
        if (!current) return current;
        channel?.presence
          .update({
            name: cleanName,
            ready: current.ready,
            isHost: current.isHost,
          })
          .catch(() => {});
        return { ...current, name: cleanName };
      });
    },
    [channel]
  );

  const updateReady = useCallback(
    async (ready: boolean) => {
      if (!channel || !player) return;
      await channel.presence.update({
        name: player.name,
        ready,
        isHost: player.isHost,
      });
      setPlayer((current) => (current ? { ...current, ready } : current));
    },
    [channel, player]
  );

  const startRoomGame = useCallback(async () => {
    if (!channel || !isHost) return;
    await channel.publish("game-started", { startedAt: Date.now() });
    setGameStarted(true);
  }, [channel, isHost]);

  return {
    connectionState,
    error,
    gameStarted,
    isHost,
    player,
    players,
    publishFoundWord,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function WordSearchGame({ roomId }: WordSearchGameProps) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const roomPublishRef = useRef<((word: string) => Promise<void>) | null>(null);
  const markWordFoundRef =
    useRef<((word: string, foundByLabel?: string) => boolean) | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [remoteWord, setRemoteWord] = useState<FoundWordEvent | null>(null);
  const [recentEvents, setRecentEvents] = useState<FoundWordEvent[]>([]);
  const [gateView, setGateView] = useState<GateView>("mode");
  const isMultiplayer = Boolean(roomId);

  const handleRemoteFoundWord = useCallback(
    (word: string, playerName: string, points: number) => {
      const didAdd = markWordFoundRef.current?.(word, playerName);
      if (!didAdd) return;
      const event = { word, playerName, points };
      setRemoteWord(event);
      setRecentEvents((events) => [event, ...events].slice(0, 5));
    },
    []
  );

  const { theme, toggle } = useTheme();
  const {
    connectionState,
    error,
    gameStarted: roomGameStarted,
    isHost,
    player,
    players,
    publishFoundWord,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useAblyRoom(roomId, handleRemoteFoundWord);

  const {
    grid,
    placed,
    foundWords,
    foundCells,
    foundBy,
    selectedCells,
    isComplete,
    startSelect,
    moveSelect,
    endSelect,
    newGame,
    markWordFound,
    getSelectionLine,
    lastFoundCells,
    showLastFound,
  } = useWordSearch({
    seed: roomId,
    foundByLabel: isMultiplayer ? player?.name || "You" : undefined,
    onWordFound: (word) => {
      if (isMultiplayer) {
        const event = {
          word,
          playerId: player?.id,
          playerName: player?.name || "You",
          points: word.length,
        };
        setRemoteWord(event);
        setRecentEvents((events) => [event, ...events].slice(0, 5));
        roomPublishRef.current?.(word);
      }
    },
  });

  const hasGameStarted = isMultiplayer
    ? roomGameStarted
    : gateView === "playing";
  const { formatted, reset } = useTimer(isComplete, !hasGameStarted);

  useEffect(() => {
    roomPublishRef.current = publishFoundWord;
  }, [publishFoundWord]);

  useEffect(() => {
    markWordFoundRef.current = markWordFound;
  }, [markWordFound]);

  useEffect(() => {
    if (!roomId || typeof window === "undefined") return;
    setInviteUrl(window.location.href);
  }, [roomId]);

  useEffect(() => {
    if (!remoteWord) return;
    const timer = setTimeout(() => setRemoteWord(null), 2500);
    return () => clearTimeout(timer);
  }, [remoteWord]);

  const handleNewGame = useCallback(() => {
    if (isMultiplayer) {
      const nextRoomId = createRoomId();
      const roomPlayer = getOrCreatePlayer();
      sessionStorage.setItem(`word-search-room-host:${nextRoomId}`, roomPlayer.id);
      router.push(`/word-search/room/${nextRoomId}`);
      return;
    }
    newGame();
    reset();
  }, [isMultiplayer, newGame, reset, router]);

  const handleCreateRoom = useCallback(() => {
    const nextRoomId = createRoomId();
    const roomPlayer = getOrCreatePlayer();
    sessionStorage.setItem(`word-search-room-host:${nextRoomId}`, roomPlayer.id);
    router.push(`/word-search/room/${nextRoomId}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, [inviteUrl]);

  const handleStartSinglePlayer = useCallback(() => {
    newGame();
    reset();
    setGateView("playing");
  }, [newGame, reset]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = posFromEvent(e, gridRef);
      if (pos) startSelect(pos);
    },
    [startSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = posFromEvent(e, gridRef);
      if (pos) moveSelect(pos);
    },
    [moveSelect]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const pos = posFromEvent(e, gridRef);
      if (pos) startSelect(pos);
    },
    [startSelect]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const pos = posFromEvent(e, gridRef);
      if (pos) moveSelect(pos);
    },
    [moveSelect]
  );

  const selLine = getSelectionLine();
  const placedWords = placed.map((p) => p.word);
  const leaderboard = useMemo(() => {
    const scores = new Map<
      string,
      {
        name: string;
        score: number;
        online: boolean;
      }
    >();

    players.forEach((roomPlayer) => {
      scores.set(roomPlayer.name, {
        name: roomPlayer.name,
        score: 0,
        online: true,
      });
    });

    if (player) {
      scores.set(player.name, {
        name: player.name,
        score: scores.get(player.name)?.score || 0,
        online: true,
      });
    }

    Object.entries(foundBy).forEach(([word, name]) => {
      const current = scores.get(name) || {
        name,
        score: 0,
        online: false,
      };
      scores.set(name, {
        ...current,
        score: current.score + word.length,
      });
    });

    return [...scores.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
  }, [foundBy, player, players]);
  const connectionLabel = useMemo(() => {
    if (!isMultiplayer) return null;
    if (error) return "Offline";
    if (connectionState === "connected") return "Live";
    return "Connecting";
  }, [connectionState, error, isMultiplayer]);

  const lobbyPlayers = useMemo(() => {
    const byId = new Map(players.map((roomPlayer) => [roomPlayer.id, roomPlayer]));
    if (player) byId.set(player.id, player);
    return [...byId.values()].sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [player, players]);
  const everybodyReady =
    lobbyPlayers.length >= 2 && lobbyPlayers.every((roomPlayer) => roomPlayer.ready);
  const waitingMessage =
    lobbyPlayers.length < 2
      ? "Invite at least one more player to continue."
      : everybodyReady
        ? "Everyone is ready. Let the game begin!"
        : "The game unlocks when everyone is ready.";

  const gateNavigation = (
    <header className={ui.gateNav}>
      <Link href="/" aria-label="Guidde games home" className={ui.gateLogoLink}>
        <Image
          src="/guidde2.svg"
          alt="Guidde"
          width={230}
          height={79}
          className={ui.gateLogo}
          priority
        />
      </Link>
      <Link href="/" className={ui.menuLink}>
        <span aria-hidden="true">←</span> Back to menu
      </Link>
    </header>
  );

  if (!isMultiplayer && gateView === "mode") {
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.modeGate}>
          <div className={ui.gateHeading}>
            <p className={ui.kicker}>Word Search</p>
            <h1>How would you like to play?</h1>
            <p>
              Find hidden Bible words at your own pace or race together in a
              shared room.
            </p>
          </div>

          <div className={ui.modeChoices}>
            <button
              type="button"
              className={`${ui.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={ui.choiceNumber}>01</span>
              <span className={ui.choiceArt} aria-hidden="true">
                <span>F</span><span>A</span><span>I</span><span>T</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Single player</strong>
                <small>Relax, focus, and beat your own time.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true">↗</span>
            </button>

            <button
              type="button"
              className={`${ui.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={ui.choiceNumber}>02</span>
              <span className={ui.choiceArt} aria-hidden="true">
                <span>Y</span><span>O</span><span>U</span><span>+</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Create a room and race your friends live.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true">↗</span>
            </button>
          </div>

          <div className={ui.gateSteps} aria-label="Game setup progress">
            <span className={ui.activeStep}>1. Choose mode</span>
            <span>2. Get ready</span>
            <span>3. Play</span>
          </div>
        </main>
      </div>
    );
  }

  if (!isMultiplayer && gateView !== "playing") {
    const isSingleSetup = gateView === "single-setup";
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.setupGate}>
          <button
            type="button"
            className={ui.stepBack}
            onClick={() => setGateView("mode")}
          >
            ← Change game mode
          </button>

          <section
            className={`${ui.setupCard} ${
              isSingleSetup ? ui.singleSetup : ui.multiplayerSetup
            }`}
          >
            <div className={ui.setupCopy}>
              <p className={ui.kicker}>
                {isSingleSetup ? "Single player" : "Multiplayer"}
              </p>
              <h1>{isSingleSetup ? "Ready when you are." : "Bring everyone in."}</h1>
              <p>
                {isSingleSetup
                  ? "You’ll have 20 hidden Bible words to find. Your timer begins as soon as you start."
                  : "Create a private room, invite your friends, and begin once every player is ready."}
              </p>
              <div className={ui.setupDetails}>
                <span><strong>20</strong> hidden words</span>
                <span><strong>{isSingleSetup ? "1" : "2+"}</strong> players</span>
                <span><strong>Live</strong> timer</span>
              </div>
              <button
                type="button"
                className={ui.primaryAction}
                onClick={isSingleSetup ? handleStartSinglePlayer : handleCreateRoom}
              >
                {isSingleSetup ? "Start game" : "Create room"}
                <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className={ui.setupArt} aria-hidden="true">
              {Array.from("FAITHGRACEHOPELOVEXX").map((letter, index) => (
                <span key={`${letter}-${index}`} className={index >= 5 && index <= 9 ? ui.artFound : undefined}>
                  {letter}
                </span>
              ))}
            </div>
          </section>

          <div className={ui.gateSteps} aria-label="Game setup progress">
            <span>1. Choose mode</span>
            <span className={ui.activeStep}>2. Get ready</span>
            <span>3. Play</span>
          </div>
        </main>
      </div>
    );
  }

  if (isMultiplayer && !roomGameStarted) {
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.waitingGate}>
          <section className={ui.waitingIntro}>
            <div>
              <p className={ui.kicker}>Room {roomId?.toUpperCase()}</p>
              <h1>Waiting for roommates.</h1>
              <p>
                Share the invite, choose your player name, and let everyone mark
                themselves ready.
              </p>
            </div>

            <div className={ui.inviteBox}>
              <span>Private room code</span>
              <div>
                <strong>{roomId?.toUpperCase()}</strong>
                <button type="button" onClick={handleCopyInvite} disabled={!inviteUrl}>
                  {copiedInvite ? "Copied!" : "Copy invite"}
                </button>
              </div>
            </div>

            <div className={ui.connectionLine} role="status">
              <span
                className={`${ui.connectionDot} ${
                  connectionLabel === "Live" ? ui.connectionLive : ""
                }`}
              />
              {connectionLabel === "Live"
                ? "Room is live"
                : connectionLabel === "Offline"
                  ? "Room is offline"
                  : "Connecting to room"}
            </div>
          </section>

          <section className={ui.rosterCard}>
            <div className={ui.rosterHeader}>
              <div>
                <span>Players</span>
                <strong>{lobbyPlayers.length}</strong>
              </div>
              <span className={ui.readyCount}>
                {lobbyPlayers.filter((roomPlayer) => roomPlayer.ready).length} ready
              </span>
            </div>

            <label className={ui.nameField}>
              <span>Your player name</span>
              <input
                key={player?.name || "joining"}
                aria-label="Your player name"
                defaultValue={player?.name || ""}
                onBlur={(event) => updatePlayerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                placeholder="Joining room…"
                disabled={!player}
              />
            </label>

            <div className={ui.playerList} aria-live="polite">
              {lobbyPlayers.map((roomPlayer) => (
                <div className={ui.playerRow} key={roomPlayer.id}>
                  <span className={ui.playerAvatar} aria-hidden="true">
                    {roomPlayer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={ui.playerIdentity}>
                    <strong>
                      {roomPlayer.id === player?.id ? "You" : roomPlayer.name}
                    </strong>
                    <small>{roomPlayer.isHost ? "Host" : "Player"}</small>
                  </span>
                  <span
                    className={`${ui.playerStatus} ${
                      roomPlayer.ready ? ui.playerReady : ""
                    }`}
                  >
                    {roomPlayer.ready ? "Ready" : "Not ready"}
                  </span>
                </div>
              ))}
            </div>

            {error && <p className={ui.lobbyError}>{error}</p>}

            <button
              type="button"
              className={`${ui.readyAction} ${player?.ready ? ui.isReady : ""}`}
              onClick={() => updateReady(!player?.ready)}
              disabled={!player || connectionLabel !== "Live"}
            >
              {player?.ready ? "I’m ready ✓" : "I’m ready"}
            </button>

            {isHost ? (
              <button
                type="button"
                className={ui.startRoomAction}
                onClick={startRoomGame}
                disabled={!everybodyReady}
              >
                Start game <span aria-hidden="true">→</span>
              </button>
            ) : (
              <div className={ui.guestMessage}>
                {player?.ready
                  ? "You’re ready. Waiting for the host to start."
                  : "Mark yourself ready when you’re set."}
              </div>
            )}

            <p className={ui.waitingRule}>{waitingMessage}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={ui.playPage} style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link href="/" className={ui.gameMenuLink}>
            <span aria-hidden="true">←</span> Menu
          </Link>
          <div>
            <h1 style={styles.title}>Word Search</h1>
            <span style={styles.subtitle}>
              {foundWords.size}/{placedWords.length} found
            </span>
          </div>
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
        </div>
        <div style={styles.headerRight}>
          <span style={styles.timer}>{formatted}</span>
          <button onClick={toggle} style={styles.themeBtn} title="Toggle theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button onClick={handleNewGame} style={styles.newGameBtn}>
            {isMultiplayer ? "New Room" : "New Game"}
          </button>
        </div>
      </header>

      {isMultiplayer && (
        <section style={styles.roomPanel}>
          <div>
            <strong style={styles.roomTitle}>Room {roomId}</strong>
            <p style={styles.roomText}>
              {player?.name || "Joining"} · {players.length || 1} player
              {(players.length || 1) === 1 ? "" : "s"}
            </p>
          </div>
          <div style={styles.roomActions}>
            <input
              aria-label="Player name"
              defaultValue={player?.name || ""}
              onBlur={(event) => updatePlayerName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="Your name"
              style={styles.nameInput}
            />
            <button onClick={handleCopyInvite} style={styles.copyBtn}>
              {copiedInvite ? "Copied" : "Copy Invite"}
            </button>
          </div>
        </section>
      )}

      {error && <div style={styles.error}>{error}</div>}
      {remoteWord && (
        <div style={styles.toast}>
          {remoteWord.playerName} found "{remoteWord.word}" +{remoteWord.points || 1}
        </div>
      )}

      <div style={styles.gameArea}>
        <div
          ref={gridRef}
          style={styles.grid}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endSelect}
          onMouseLeave={endSelect}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={endSelect}
        >
          {selLine && (
            <svg style={styles.svgOverlay}>
              <line
                x1={`${((selLine.start.col + 0.5) / GRID_SIZE) * 100}%`}
                y1={`${((selLine.start.row + 0.5) / GRID_SIZE) * 100}%`}
                x2={`${((selLine.end.col + 0.5) / GRID_SIZE) * 100}%`}
                y2={`${((selLine.end.row + 0.5) / GRID_SIZE) * 100}%`}
                stroke="var(--highlight-line)"
                strokeWidth={`calc(100% / ${GRID_SIZE} - 4px)`}
                strokeLinecap="round"
              />
            </svg>
          )}
          {grid.map((row, r) =>
            row.map((letter, c) => {
              const key = `${r},${c}`;
              const isFound = foundCells.has(key);
              const isSelected = selectedCells.has(key);
              const isJustFound = showLastFound && lastFoundCells.has(key);

              return (
                <div
                  key={key}
                  style={{
                    ...styles.cell,
                    ...(isSelected ? styles.cellSelected : {}),
                    ...(isFound && !isSelected ? styles.cellFound : {}),
                    ...(isJustFound ? styles.cellJustFound : {}),
                  }}
                >
                  <span
                    style={{
                      ...styles.cellLetter,
                      ...(isSelected ? { color: "var(--cell-selected-text)" } : {}),
                      ...(isFound && !isSelected
                        ? { color: "var(--cell-found-text)" }
                        : {}),
                    }}
                  >
                    {letter}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div style={styles.sidePanel}>
          {isMultiplayer && (
            <section style={styles.leaderboard}>
              <div style={styles.panelHeader}>
                <h2 style={styles.wordListTitle}>Leaderboard</h2>
                <span style={styles.scoreRule}>letters = points</span>
              </div>
              <div style={styles.scoreRows}>
                {leaderboard.map((entry, index) => (
                  <div key={entry.name} style={styles.scoreRow}>
                    <span style={styles.rank}>{index + 1}</span>
                    <span style={styles.scoreName}>{entry.name}</span>
                    <strong style={styles.scoreValue}>{entry.score}</strong>
                  </div>
                ))}
              </div>
              <div style={styles.activityFeed}>
                {recentEvents.length === 0 ? (
                  <p style={styles.emptyFeed}>Waiting for the first find</p>
                ) : (
                  recentEvents.map((event, index) => (
                    <p key={`${event.word}-${index}`} style={styles.feedItem}>
                      {event.playerName} found "{event.word}" +{event.points || 1}
                    </p>
                  ))
                )}
              </div>
            </section>
          )}

          <div style={styles.wordList}>
            <h2 style={styles.wordListTitle}>Words</h2>
            <div style={styles.words}>
              {placedWords.map((word) => {
                const isFound = foundWords.has(word);
                return (
                  <span
                    key={word}
                    style={{
                      ...styles.word,
                      ...(isFound ? styles.wordFound : {}),
                    }}
                    title={foundBy[word] ? `Found by ${foundBy[word]}` : undefined}
                  >
                    {word}
                    {isMultiplayer && foundBy[word] ? (
                      <small style={styles.foundBy}>Found by {foundBy[word]}</small>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {isComplete && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalEmoji}>&#10024;</div>
            <h2 style={styles.modalTitle}>Puzzle Complete!</h2>
            <p style={styles.modalText}>
              You found all {placedWords.length} words in {formatted}
            </p>
            <button onClick={handleNewGame} style={styles.modalBtn}>
              {isMultiplayer ? "Start New Room" : "Play Again"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    width: "min(100% - 32px, 1180px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "28px 0 64px",
    maxWidth: "none",
    margin: "0 auto",
    gap: "22px",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    gap: "16px",
    flexWrap: "wrap",
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: "18px",
    background: "var(--bg-secondary)",
  },
  headerLeft: {
    display: "flex",
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
  title: {
    fontSize: "clamp(1.4rem, 4vw, 1.8rem)",
    fontWeight: 700,
  },
  subtitle: {
    display: "block",
    marginTop: "2px",
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    fontWeight: 400,
  },
  statusBadge: {
    padding: "4px 8px",
    borderRadius: "999px",
    fontSize: "0.75rem",
    fontWeight: 700,
    background: "var(--bg-tertiary)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
  },
  statusLive: {
    background: "#dff8e8",
    borderColor: "#a8e7bd",
    color: "#176b35",
  },
  timer: {
    fontFamily: "var(--font-oxygen), 'Oxygen', monospace",
    fontSize: "1rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
    minWidth: "52px",
  },
  themeBtn: {
    height: "40px",
    padding: "0 12px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 600,
  },
  roomBtn: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  newGameBtn: {
    padding: "8px 18px",
    borderRadius: "999px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  roomPanel: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: "18px",
    background: "var(--bg-secondary)",
  },
  roomActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  roomTitle: {
    fontSize: "0.95rem",
  },
  roomText: {
    marginTop: "2px",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
  },
  nameInput: {
    width: "150px",
    height: "38px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
  },
  copyBtn: {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
  },
  error: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #f2b8b5",
    background: "#fff1f0",
    color: "#8c1d18",
    fontSize: "0.85rem",
  },
  toast: {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 14px",
    borderRadius: "8px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontWeight: 700,
    zIndex: 120,
    boxShadow: "0 12px 32px var(--shadow)",
  },
  gameArea: {
    display: "flex",
    gap: "24px",
    width: "100%",
    alignItems: "flex-start",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  sidePanel: {
    flex: "1 1 220px",
    minWidth: "220px",
    maxWidth: "300px",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },
  leaderboard: {
    padding: "18px",
    borderRadius: "18px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "12px",
    marginBottom: "12px",
  },
  scoreRule: {
    color: "var(--text-secondary)",
    fontSize: "0.72rem",
    fontWeight: 700,
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
    minHeight: "36px",
    padding: "7px 8px",
    borderRadius: "8px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
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
    fontWeight: 800,
  },
  scoreName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.9rem",
    fontWeight: 700,
  },
  scoreValue: {
    fontSize: "1rem",
    fontWeight: 800,
  },
  activityFeed: {
    marginTop: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  emptyFeed: {
    color: "var(--text-secondary)",
    fontSize: "0.78rem",
  },
  feedItem: {
    color: "var(--text-secondary)",
    fontSize: "0.78rem",
    lineHeight: 1.35,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
    gap: "2px",
    width: "min(100%, 560px)",
    aspectRatio: "1",
    background: "var(--border)",
    borderRadius: "24px",
    overflow: "hidden",
    border: "2px solid var(--border)",
    position: "relative",
    touchAction: "none",
  },
  svgOverlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 1,
  },
  cell: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--cell-bg)",
    cursor: "pointer",
    transition: "background 0.15s ease",
    position: "relative",
    zIndex: 2,
    aspectRatio: "1",
  },
  cellSelected: {
    background: "var(--cell-selected)",
  },
  cellFound: {
    background: "var(--cell-found)",
  },
  cellJustFound: {
    animation: "pulse 0.6s ease",
  },
  cellLetter: {
    fontSize: "clamp(0.7rem, 2.5vw, 1rem)",
    fontWeight: 600,
    color: "var(--text)",
    lineHeight: 1,
    pointerEvents: "none",
    transition: "color 0.15s ease",
  },
  wordList: {
    width: "100%",
  },
  wordListTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    marginBottom: "12px",
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  words: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  word: {
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.06em",
    background: "var(--bg-tertiary)",
    color: "var(--text)",
    transition: "all 0.3s ease",
    border: "1px solid var(--border)",
  },
  foundBy: {
    display: "block",
    marginTop: "2px",
    fontSize: "0.65rem",
    letterSpacing: 0,
    color: "var(--text-secondary)",
  },
  wordFound: {
    textDecoration: "line-through",
    color: "var(--word-found)",
    background: "transparent",
    borderColor: "transparent",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    animation: "fadeIn 0.3s ease",
  },
  modal: {
    background: "var(--bg-secondary)",
    borderRadius: "24px",
    padding: "48px 40px",
    textAlign: "center",
    maxWidth: "380px",
    width: "90%",
    border: "1px solid var(--border)",
    boxShadow: "0 24px 48px var(--shadow)",
  },
  modalEmoji: {
    fontSize: "3rem",
    marginBottom: "16px",
  },
  modalTitle: {
    fontSize: "1.6rem",
    fontWeight: 700,
    marginBottom: "8px",
  },
  modalText: {
    color: "var(--text-secondary)",
    marginBottom: "24px",
    fontSize: "1rem",
  },
  modalBtn: {
    padding: "12px 32px",
    borderRadius: "12px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

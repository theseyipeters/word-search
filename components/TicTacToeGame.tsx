"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createRoomId } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";
import ui from "./TicTacToeGame.module.css";

type Mark = "X" | "O";
type Cell = Mark | null;
type ScoreState = {
  X: number;
  O: number;
  draws: number;
};
type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};
type MoveEvent = {
  cell: number;
  symbol: Mark;
  round: number;
  playerId: string;
  playerName: string;
};
type ResetEvent = {
  resetId: string;
  playerName: string;
  round: number;
  starter: Mark;
  scores: ScoreState;
};
type StartEvent = {
  round: number;
  starter: Mark;
  playerXId: string;
  playerOId: string;
  scores: ScoreState;
};
type FeedEvent = {
  text: string;
};
type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

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
  const existingId = sessionStorage.getItem("tic-tac-toe-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("tic-tac-toe-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
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

function nextTurn(board: Cell[], starter: Mark): Mark {
  const xCount = board.filter((cell) => cell === "X").length;
  const oCount = board.filter((cell) => cell === "O").length;
  if (starter === "O") return oCount <= xCount ? "O" : "X";
  return xCount <= oCount ? "X" : "O";
}

function isScoreState(value: unknown): value is ScoreState {
  if (!value || typeof value !== "object") return false;
  const scores = value as Partial<ScoreState>;
  return (
    typeof scores.X === "number" &&
    typeof scores.O === "number" &&
    typeof scores.draws === "number"
  );
}

function useTicTacToeRoom(
  roomId: string | undefined,
  onMove: (move: MoveEvent) => void,
  onReset: (reset: ResetEvent) => void,
  onStart: (start: StartEvent) => void
) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [channel, setChannel] =
    useState<Ably.Types.RealtimeChannelPromise | null>(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [startEvent, setStartEvent] = useState<StartEvent | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const roomPlayer = getOrCreatePlayer();
    const roomHost =
      sessionStorage.getItem(`tic-tac-toe-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`tic-tac-toe:${roomId}`, {
      params: { rewind: "100" },
    });
    let mounted = true;

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

    const handleRoomMessage = (message: Ably.Types.Message) => {
      if (message.name === "game-started") {
        const data = message.data as Partial<StartEvent>;
        if (
          typeof data.round === "number" &&
          (data.starter === "X" || data.starter === "O") &&
          typeof data.playerXId === "string" &&
          typeof data.playerOId === "string" &&
          isScoreState(data.scores)
        ) {
          const start = data as StartEvent;
          setStartEvent(start);
          onStart(start);
        }
        return;
      }

      if (message.name === "move") {
        const data = message.data as Partial<MoveEvent>;
        if (
          typeof data.cell === "number" &&
          (data.symbol === "X" || data.symbol === "O") &&
          typeof data.round === "number" &&
          typeof data.playerId === "string"
        ) {
          onMove({
            cell: data.cell,
            symbol: data.symbol,
            round: data.round,
            playerId: data.playerId,
            playerName: data.playerName || "Player",
          });
        }
        return;
      }

      if (message.name === "reset") {
        const data = message.data as Partial<ResetEvent>;
        if (
          typeof data.resetId === "string" &&
          typeof data.round === "number" &&
          (data.starter === "X" || data.starter === "O") &&
          isScoreState(data.scores)
        ) {
          onReset({
            resetId: data.resetId,
            playerName: data.playerName || "Player",
            round: data.round,
            starter: data.starter,
            scores: data.scores,
          });
        }
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
  }, [onMove, onReset, onStart, player?.id, roomId]);

  const publishMove = useCallback(
    async (cell: number, symbol: Mark, round: number) => {
      if (!channel || !player) return;
      await channel.publish("move", {
        cell,
        symbol,
        round,
        playerId: player.id,
        playerName: player.name,
      } satisfies MoveEvent);
    },
    [channel, player]
  );

  const publishReset = useCallback(
    async (round: number, starter: Mark, scores: ScoreState) => {
      if (!channel || !player) return;
      await channel.publish("reset", {
        resetId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2),
        playerName: player.name,
        round,
        starter,
        scores,
      } satisfies ResetEvent);
    },
    [channel, player]
  );

  const updatePlayerName = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 18);
      if (!cleanName) return;
      localStorage.setItem("games-player-name", cleanName);
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

  const startRoomGame = useCallback(
    async (playerXId: string, playerOId: string) => {
      if (!channel || !isHost) return;
      const start: StartEvent = {
        round: 1,
        starter: "X",
        playerXId,
        playerOId,
        scores: { X: 0, O: 0, draws: 0 },
      };
      await channel.publish("game-started", start);
    },
    [channel, isHost]
  );

  return {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishMove,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function TicTacToeGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [match, setMatch] = useState<{
    board: Cell[];
    round: number;
    starter: Mark;
    scores: ScoreState;
  }>({
    board: Array(9).fill(null),
    round: 1,
    starter: "X",
    scores: { X: 0, O: 0, draws: 0 },
  });
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [gateView, setGateView] = useState<GateView>("mode");
  const [showResult, setShowResult] = useState(false);
  const isMultiplayer = Boolean(roomId);

  const applyStart = useCallback((start: StartEvent) => {
    setMatch({
      board: Array(9).fill(null),
      round: start.round,
      starter: start.starter,
      scores: start.scores,
    });
    setFeed([{ text: `${start.starter} opens round ${start.round}` }]);
  }, []);

  const applyMove = useCallback((move: MoveEvent) => {
    setMatch((current) => {
      if (move.round !== current.round) return current;
      if (current.board[move.cell] || getWinner(current.board)) return current;
      if (nextTurn(current.board, current.starter) !== move.symbol) return current;
      const next = [...current.board];
      next[move.cell] = move.symbol;
      return { ...current, board: next };
    });
    setFeed((events) => [
      { text: `${move.playerName} placed ${move.symbol}` },
      ...events,
    ].slice(0, 5));
  }, []);

  const applyReset = useCallback((reset: ResetEvent) => {
    setMatch({
      board: Array(9).fill(null),
      round: reset.round,
      starter: reset.starter,
      scores: reset.scores,
    });
    setFeed((events) => [
      {
        text:
          reset.round === 1 && reset.scores.X === 0 && reset.scores.O === 0
            ? `${reset.playerName} started a new five-game match`
            : `${reset.playerName} started game ${reset.round} · ${reset.starter} opens`,
      },
      ...events,
    ].slice(0, 5));
  }, []);

  const {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishMove,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useTicTacToeRoom(roomId, applyMove, applyReset, applyStart);

  const assignments = useMemo(() => {
    const map = new Map<string, Mark>();
    if (startEvent) {
      map.set(startEvent.playerXId, "X");
      map.set(startEvent.playerOId, "O");
    }
    return map;
  }, [startEvent]);

  const {
    board,
    round: roundNumber,
    scores: completedScores,
    starter: startingMark,
  } = match;
  const winner = useMemo(() => getWinner(board), [board]);
  const turn = nextTurn(board, startingMark);
  const isDraw = !winner && board.every(Boolean);
  const isRoundComplete = Boolean(winner) || isDraw;
  const displayScores = useMemo<ScoreState>(() => {
    if (winner) {
      return {
        ...completedScores,
        [winner.symbol]: completedScores[winner.symbol] + 1,
      };
    }
    if (isDraw) return { ...completedScores, draws: completedScores.draws + 1 };
    return completedScores;
  }, [completedScores, isDraw, winner]);
  const isMatchComplete = isRoundComplete && roundNumber >= 5;
  const matchWinner: Mark | null =
    displayScores.X === displayScores.O
      ? null
      : displayScores.X > displayScores.O
        ? "X"
        : "O";
  const strikeClass = winner
    ? {
        "0,1,2": ui.strikeRowTop,
        "3,4,5": ui.strikeRowMiddle,
        "6,7,8": ui.strikeRowBottom,
        "0,3,6": ui.strikeColumnLeft,
        "1,4,7": ui.strikeColumnMiddle,
        "2,5,8": ui.strikeColumnRight,
        "0,4,8": ui.strikeDiagonalDown,
        "2,4,6": ui.strikeDiagonalUp,
      }[winner.line.join(",")]
    : "";
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
    const nextRoomId = createRoomId();
    const roomPlayer = getOrCreatePlayer();
    sessionStorage.setItem(`tic-tac-toe-room-host:${nextRoomId}`, roomPlayer.id);
    router.push(`/tic-tac-toe/room/${nextRoomId}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleStartSinglePlayer = useCallback(() => {
    setMatch({
      board: Array(9).fill(null),
      round: 1,
      starter: "X",
      scores: { X: 0, O: 0, draws: 0 },
    });
    setFeed([]);
    setGateView("playing");
  }, []);

  useEffect(() => {
    if (!isRoundComplete) {
      setShowResult(false);
      return;
    }
    const timer = setTimeout(() => setShowResult(true), winner ? 950 : 420);
    return () => clearTimeout(timer);
  }, [isRoundComplete, roundNumber, winner]);

  const handleCellClick = useCallback(
    (cell: number) => {
      if (board[cell] || winner || isDraw) return;

      if (!isMultiplayer) {
        setMatch((current) => {
          if (current.board[cell] || getWinner(current.board)) return current;
          const next = [...current.board];
          next[cell] = nextTurn(current.board, current.starter);
          return { ...current, board: next };
        });
        return;
      }

      if (!mySymbol || !isMyTurn) return;
      publishMove(cell, mySymbol, roundNumber).catch(() => {});
    },
    [board, isDraw, isMultiplayer, isMyTurn, mySymbol, publishMove, roundNumber, winner]
  );

  const handleReset = useCallback(() => {
    const nextRound = isMatchComplete ? 1 : roundNumber + 1;
    const nextStarter: Mark = isMatchComplete
      ? "X"
      : startingMark === "X"
        ? "O"
        : "X";
    const nextScores: ScoreState = isMatchComplete
      ? { X: 0, O: 0, draws: 0 }
      : displayScores;
    if (!isMultiplayer) {
      setMatch({
        board: Array(9).fill(null),
        round: nextRound,
        starter: nextStarter,
        scores: nextScores,
      });
      setFeed([
        {
          text: isMatchComplete
            ? "A new five-game match started"
            : `${nextStarter} opens game ${nextRound}`,
        },
      ]);
      return;
    }
    publishReset(nextRound, nextStarter, nextScores).catch(() => {});
  }, [
    displayScores,
    isMatchComplete,
    isMultiplayer,
    publishReset,
    roundNumber,
    startingMark,
  ]);

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
        : `${turn}'s turn`;

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
      ? "Invite one more player to continue."
      : everybodyReady
        ? "Both sides are ready. Start the match!"
        : "The match unlocks when everyone is ready.";

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
            <p className={ui.kicker}>Tic Tac Toe</p>
            <h1>Choose your match.</h1>
            <p>
              Take both turns on one screen or invite an opponent for a live
              head-to-head match.
            </p>
          </div>

          <div className={ui.modeChoices}>
            <button
              type="button"
              className={`${ui.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={ui.choiceNumber}>01</span>
              <span className={ui.miniBoard} aria-hidden="true">
                <span>X</span><span /><span>O</span>
                <span /><span>X</span><span />
                <span>O</span><span /><span />
              </span>
              <span className={ui.choiceCopy}>
                <strong>Single player</strong>
                <small>Play both X and O on this device.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true">↗</span>
            </button>

            <button
              type="button"
              className={`${ui.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={ui.choiceNumber}>02</span>
              <span className={ui.miniBoard} aria-hidden="true">
                <span>X</span><span>O</span><span />
                <span /><span>X</span><span />
                <span /><span>O</span><span />
              </span>
              <span className={ui.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Create a room and take turns live.</small>
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
              <h1>{isSingleSetup ? "Make the first move." : "Challenge a friend."}</h1>
              <p>
                {isSingleSetup
                  ? "Play a five-game match. X opens game one, then every game switches the opening turn between X and O."
                  : "Create a private room for a five-game match, invite your opponent, and start once both of you are ready."}
              </p>
              <div className={ui.setupDetails}>
                <span><strong>5</strong> games</span>
                <span><strong>{isSingleSetup ? "1" : "2+"}</strong> players</span>
                <span><strong>X / O</strong> alternate</span>
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

            <div className={ui.setupBoard} aria-hidden="true">
              <span>X</span><span /><span>O</span>
              <span /><span>X</span><span />
              <span>O</span><span /><span>X</span>
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

  if (isMultiplayer && !startEvent) {
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.waitingGate}>
          <section className={ui.waitingIntro}>
            <div>
              <p className={ui.kicker}>Room {roomId?.toUpperCase()}</p>
              <h1>Waiting for your opponent.</h1>
              <p>
                Share the room, choose your player name, and mark yourself ready.
                The host starts once everyone is set.
              </p>
            </div>

            <div className={ui.inviteBox}>
              <span>Private room code</span>
              <div>
                <strong>{roomId?.toUpperCase()}</strong>
                <button type="button" onClick={handleCopyInvite}>
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
              {lobbyPlayers.map((roomPlayer, index) => (
                <div className={ui.playerRow} key={roomPlayer.id}>
                  <span className={ui.playerAvatar} aria-hidden="true">
                    {index === 0 ? "X" : index === 1 ? "O" : "•"}
                  </span>
                  <span className={ui.playerIdentity}>
                    <strong>
                      {roomPlayer.id === player?.id ? "You" : roomPlayer.name}
                    </strong>
                    <small>{roomPlayer.isHost ? "Host" : index < 2 ? "Player" : "Spectator"}</small>
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
                onClick={() =>
                  startRoomGame(lobbyPlayers[0].id, lobbyPlayers[1].id)
                }
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
    <main className={ui.playPage} style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLead}>
          <Link href="/" className={ui.gameMenuLink}>
            <span aria-hidden="true">←</span> Menu
          </Link>
          <div>
            <p style={styles.eyebrow}>
              Tic Tac Toe · Game {roundNumber} of 5 · {startingMark} opened
            </p>
            <h1 style={styles.title}>{statusText}</h1>
          </div>
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
              key={player?.name || "joining"}
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
                disabled={
                  Boolean(cell) ||
                  Boolean(winner) ||
                  isDraw ||
                  (isMultiplayer && (!mySymbol || !isMyTurn))
                }
                style={{
                  ...styles.cell,
                  ...(isWinningCell ? styles.winningCell : {}),
                }}
                aria-label={`Cell ${index + 1}${cell ? `, ${cell}` : ", empty"}`}
              >
                {cell}
              </button>
            );
          })}
          {winner && (
            <span
              className={`${ui.winStrike} ${strikeClass || ""}`}
              aria-hidden="true"
            />
          )}
        </div>

        <aside style={styles.sidePanel}>
          <section style={styles.panel}>
            <div style={styles.panelHeadingRow}>
              <h2 style={styles.panelTitle}>Match score</h2>
              <span style={styles.gameCount}>Game {roundNumber}/5</span>
            </div>
            <div style={styles.playerRows}>
              <div style={styles.playerRow}>
                <span style={styles.symbol}>X</span>
                <span style={styles.playerName}>
                  {isMultiplayer ? playerX?.name || "Waiting" : "Player X"}
                </span>
                <strong style={styles.playerScore}>{displayScores.X}</strong>
              </div>
              <div style={styles.playerRow}>
                <span style={styles.symbol}>O</span>
                <span style={styles.playerName}>
                  {isMultiplayer ? playerO?.name || "Waiting" : "Player O"}
                </span>
                <strong style={styles.playerScore}>{displayScores.O}</strong>
              </div>
            </div>
            <p style={styles.drawCount}>{displayScores.draws} draw{displayScores.draws === 1 ? "" : "s"}</p>
          </section>

          <section style={styles.roundPanel}>
            <span style={styles.roundLabel}>Opening turns</span>
            <div style={styles.roundSequence}>
              {(["X", "O", "X", "O", "X"] as Mark[]).map((mark, index) => {
                return (
                  <span
                    key={index}
                    style={{
                      ...styles.roundBubble,
                      ...(index + 1 === roundNumber ? styles.currentRound : {}),
                    }}
                  >
                    {mark}
                  </span>
                );
              })}
            </div>
            <p style={styles.muted}>The first move alternates every round.</p>
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

      {showResult && isRoundComplete && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalEyebrow}>
              {isMatchComplete ? "Match complete" : `Game ${roundNumber} of 5`}
            </p>
            <h2 style={styles.modalTitle}>
              {isMatchComplete
                ? matchWinner
                  ? `${matchWinner} wins the match`
                  : "The match is tied"
                : winner
                  ? `${winner.symbol} wins this game`
                  : "This game is a draw"}
            </h2>
            <div style={styles.modalScore}>
              <span>X <strong>{displayScores.X}</strong></span>
              <span>Draws <strong>{displayScores.draws}</strong></span>
              <span>O <strong>{displayScores.O}</strong></span>
            </div>
            <div style={styles.modalActions}>
              <button onClick={handleReset} style={styles.primaryBtn}>
                {isMatchComplete
                  ? "Play new match"
                  : `Game ${roundNumber + 1} · ${startingMark === "X" ? "O" : "X"} starts`}
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
    width: "min(100% - 32px, 1120px)",
    margin: "0 auto",
    padding: "28px 0 64px",
    display: "flex",
    flexDirection: "column",
    gap: "22px",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: "18px",
    background: "var(--bg-secondary)",
  },
  headerLead: {
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
    borderRadius: "999px",
    border: "none",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryBtn: {
    minHeight: "40px",
    padding: "0 14px",
    borderRadius: "999px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
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
    borderRadius: "18px",
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
    borderRadius: "12px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
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
    gap: "32px",
    flexWrap: "wrap",
  },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gridTemplateRows: "repeat(3, 1fr)",
    gridAutoRows: "1fr",
    gap: "9px",
    width: "min(100%, 500px)",
    aspectRatio: "1",
    alignItems: "stretch",
    padding: "12px",
    borderRadius: "28px",
    background: "#191919",
    boxShadow: "0 28px 64px var(--shadow)",
    position: "relative",
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
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.09)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
    fontSize: "clamp(3rem, 16vw, 6rem)",
    fontWeight: 900,
    lineHeight: 1,
    cursor: "pointer",
    outlineOffset: "2px",
    userSelect: "none",
    WebkitUserSelect: "none",
    transition: "transform 150ms ease, background 150ms ease",
    position: "relative",
    zIndex: 1,
  },
  winningCell: {
    background: "#dfff65",
    color: "#171717",
    borderColor: "#dfff65",
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
    padding: "18px",
    borderRadius: "18px",
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
  panelHeadingRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
  },
  gameCount: {
    color: "var(--text-secondary)",
    fontSize: "0.7rem",
    fontWeight: 800,
  },
  playerRows: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  playerRow: {
    display: "grid",
    gridTemplateColumns: "34px 1fr auto",
    alignItems: "center",
    gap: "10px",
    padding: "8px",
    borderRadius: "12px",
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
  playerScore: {
    minWidth: "28px",
    fontSize: "1.2rem",
    fontWeight: 900,
    textAlign: "right",
  },
  drawCount: {
    marginTop: "10px",
    color: "var(--text-secondary)",
    fontSize: "0.72rem",
    fontWeight: 700,
    textAlign: "right",
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
  roundPanel: {
    padding: "18px",
    borderRadius: "18px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
  },
  roundLabel: {
    display: "block",
    marginBottom: "12px",
    color: "var(--text-secondary)",
    fontSize: "0.72rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  roundSequence: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
  },
  roundBubble: {
    width: "34px",
    height: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
    borderRadius: "50%",
    background: "var(--bg)",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    fontWeight: 900,
  },
  currentRound: {
    background: "#dfff65",
    color: "#171717",
    borderColor: "#dfff65",
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
    borderRadius: "24px",
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
  modalScore: {
    marginBottom: "22px",
    padding: "12px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "8px",
    borderRadius: "14px",
    background: "var(--bg)",
    color: "var(--text-secondary)",
    fontSize: "0.72rem",
  },
  modalActions: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
};

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createRoomCode } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";
import {
  trackGameCompleted,
  trackGameStarted,
  trackGameView,
  trackRematchStarted,
  trackRoomCreated,
  trackRoomJoined,
} from "@/lib/gameTelemetry";
import { ArrowIcon } from "./ArrowIcon";
import { RoomJoinForm } from "./RoomJoinForm";
import shell from "./TicTacToeGame.module.css";
import ui from "./ConnectFourGame.module.css";

type Disc = "lime" | "violet";
type Cell = Disc | null;
type ScoreState = {
  lime: number;
  violet: number;
  draws: number;
};
type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};
type MoveEvent = {
  column: number;
  disc: Disc;
  round: number;
  playerId: string;
  playerName: string;
};
type ResetEvent = {
  resetId: string;
  playerName: string;
  round: number;
  starter: Disc;
  scores: ScoreState;
};
type StartEvent = {
  round: number;
  starter: Disc;
  playerLimeId: string;
  playerVioletId: string;
  scores: ScoreState;
};
type FeedEvent = { text: string };
type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

const ROWS = 6;
const COLUMNS = 7;
const CELL_COUNT = ROWS * COLUMNS;
const EMPTY_SCORES: ScoreState = { lime: 0, violet: 0, draws: 0 };
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

function emptyBoard(): Cell[] {
  return Array<Cell>(CELL_COUNT).fill(null);
}

function getOrCreatePlayer(): Player {
  const existingId = sessionStorage.getItem("connect-four-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("connect-four-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
}

function discLabel(disc: Disc) {
  return disc === "lime" ? "Lime" : "Violet";
}

function otherDisc(disc: Disc): Disc {
  return disc === "lime" ? "violet" : "lime";
}

function getLandingIndex(board: Cell[], column: number) {
  if (column < 0 || column >= COLUMNS) return null;
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    const index = row * COLUMNS + column;
    if (!board[index]) return index;
  }
  return null;
}

function getWinner(board: Cell[]) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const index = row * COLUMNS + column;
      const disc = board[index];
      if (!disc) continue;

      for (const [rowStep, columnStep] of DIRECTIONS) {
        const line: number[] = [];
        for (let offset = 0; offset < 4; offset += 1) {
          const nextRow = row + rowStep * offset;
          const nextColumn = column + columnStep * offset;
          if (
            nextRow < 0 ||
            nextRow >= ROWS ||
            nextColumn < 0 ||
            nextColumn >= COLUMNS
          ) {
            break;
          }
          const nextIndex = nextRow * COLUMNS + nextColumn;
          if (board[nextIndex] !== disc) break;
          line.push(nextIndex);
        }
        if (line.length === 4) return { disc, line };
      }
    }
  }
  return null;
}

function nextTurn(board: Cell[], starter: Disc): Disc {
  const limeCount = board.filter((cell) => cell === "lime").length;
  const violetCount = board.filter((cell) => cell === "violet").length;
  if (starter === "violet") return violetCount <= limeCount ? "violet" : "lime";
  return limeCount <= violetCount ? "lime" : "violet";
}

function boardAfterMove(board: Cell[], column: number, disc: Disc) {
  const landingIndex = getLandingIndex(board, column);
  if (landingIndex === null) return null;
  const next = [...board];
  next[landingIndex] = disc;
  return { board: next, landingIndex };
}

function availableColumns(board: Cell[]) {
  return Array.from({ length: COLUMNS }, (_, column) => column).filter(
    (column) => getLandingIndex(board, column) !== null
  );
}

function chooseComputerColumn(board: Cell[]) {
  const available = availableColumns(board);
  if (available.length === 0) return null;

  for (const column of available) {
    const move = boardAfterMove(board, column, "violet");
    if (move && getWinner(move.board)?.disc === "violet") return column;
  }

  for (const column of available) {
    const move = boardAfterMove(board, column, "lime");
    if (move && getWinner(move.board)?.disc === "lime") return column;
  }

  const safeColumns = available.filter((column) => {
    const cpuMove = boardAfterMove(board, column, "violet");
    if (!cpuMove) return false;
    return !availableColumns(cpuMove.board).some((replyColumn) => {
      const reply = boardAfterMove(cpuMove.board, replyColumn, "lime");
      return reply && getWinner(reply.board)?.disc === "lime";
    });
  });
  const candidates = safeColumns.length > 0 ? safeColumns : available;
  const centerOrder = [3, 2, 4, 1, 5, 0, 6];
  const bestRank = Math.min(...candidates.map((column) => centerOrder.indexOf(column)));
  const best = candidates.filter((column) => centerOrder.indexOf(column) === bestRank);
  return best[Math.floor(Math.random() * best.length)];
}

function isScoreState(value: unknown): value is ScoreState {
  if (!value || typeof value !== "object") return false;
  const scores = value as Partial<ScoreState>;
  return (
    typeof scores.lime === "number" &&
    typeof scores.violet === "number" &&
    typeof scores.draws === "number"
  );
}

function useConnectFourRoom(
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
      sessionStorage.getItem(`connect-four-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`connect-four:${roomId}`, {
      params: { rewind: "150" },
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
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Presence failed");
        }
      }
    };

    const handleRoomMessage = (message: Ably.Types.Message) => {
      if (message.name === "game-started") {
        const data = message.data as Partial<StartEvent>;
        if (
          typeof data.round === "number" &&
          (data.starter === "lime" || data.starter === "violet") &&
          typeof data.playerLimeId === "string" &&
          typeof data.playerVioletId === "string" &&
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
          typeof data.column === "number" &&
          (data.disc === "lime" || data.disc === "violet") &&
          typeof data.round === "number" &&
          typeof data.playerId === "string"
        ) {
          onMove({
            column: data.column,
            disc: data.disc,
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
          (data.starter === "lime" || data.starter === "violet") &&
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
      .catch((reason) => {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Could not join room");
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
    async (column: number, disc: Disc, round: number) => {
      if (!channel || !player) return;
      await channel.publish("move", {
        column,
        disc,
        round,
        playerId: player.id,
        playerName: player.name,
      } satisfies MoveEvent);
    },
    [channel, player]
  );

  const publishReset = useCallback(
    async (round: number, starter: Disc, scores: ScoreState) => {
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
    async (playerLimeId: string, playerVioletId: string) => {
      if (!channel || !isHost) return;
      const start: StartEvent = {
        round: 1,
        starter: "lime",
        playerLimeId,
        playerVioletId,
        scores: EMPTY_SCORES,
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

const PREVIEW_LIME = new Set([38, 39, 40, 31]);
const PREVIEW_VIOLET = new Set([35, 36, 37, 30]);

function ConnectBoardPreview({ large = false }: { large?: boolean }) {
  return (
    <span
      className={large ? ui.setupConnectBoard : ui.miniConnectBoard}
      aria-hidden="true"
    >
      {Array.from({ length: CELL_COUNT }, (_, index) => {
        const disc = PREVIEW_LIME.has(index)
          ? "lime"
          : PREVIEW_VIOLET.has(index)
            ? "violet"
            : null;
        return (
          <span className={ui.previewSlot} key={index}>
            {disc && <span className={`${ui.previewDisc} ${ui[disc]}`} />}
          </span>
        );
      })}
    </span>
  );
}

export function ConnectFourGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [match, setMatch] = useState<{
    board: Cell[];
    round: number;
    starter: Disc;
    scores: ScoreState;
    lastMoveIndex: number | null;
  }>({
    board: emptyBoard(),
    round: 1,
    starter: "lime",
    scores: EMPTY_SCORES,
    lastMoveIndex: null,
  });
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [gateView, setGateView] = useState<GateView>("mode");
  const [showResult, setShowResult] = useState(false);
  const [cpuThinking, setCpuThinking] = useState(false);
  const isMultiplayer = Boolean(roomId);

  const applyStart = useCallback((start: StartEvent) => {
    setMatch({
      board: emptyBoard(),
      round: start.round,
      starter: start.starter,
      scores: start.scores,
      lastMoveIndex: null,
    });
    setFeed([{ text: `${discLabel(start.starter)} opens game ${start.round}` }]);
  }, []);

  const applyMove = useCallback((move: MoveEvent) => {
    setMatch((current) => {
      if (move.round !== current.round || getWinner(current.board)) return current;
      if (nextTurn(current.board, current.starter) !== move.disc) return current;
      const result = boardAfterMove(current.board, move.column, move.disc);
      if (!result) return current;
      return {
        ...current,
        board: result.board,
        lastMoveIndex: result.landingIndex,
      };
    });
    setFeed((events) => [
      { text: `${move.playerName} dropped in column ${move.column + 1}` },
      ...events,
    ].slice(0, 5));
  }, []);

  const applyReset = useCallback((reset: ResetEvent) => {
    setMatch({
      board: emptyBoard(),
      round: reset.round,
      starter: reset.starter,
      scores: reset.scores,
      lastMoveIndex: null,
    });
    setFeed((events) => [
      {
        text:
          reset.round === 1 && reset.scores.lime === 0 && reset.scores.violet === 0
            ? `${reset.playerName} started a new five-game match`
            : `${reset.playerName} started game ${reset.round}`,
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
  } = useConnectFourRoom(roomId, applyMove, applyReset, applyStart);

  useEffect(() => {
    trackGameView("connect-four", roomId);
  }, [roomId]);

  useEffect(() => {
    if (roomId && player) trackRoomJoined("connect-four", roomId, isHost);
  }, [isHost, player, roomId]);

  const assignments = useMemo(() => {
    const map = new Map<string, Disc>();
    if (startEvent) {
      map.set(startEvent.playerLimeId, "lime");
      map.set(startEvent.playerVioletId, "violet");
    }
    return map;
  }, [startEvent]);

  const { board, round, starter, scores, lastMoveIndex } = match;
  const winner = useMemo(() => getWinner(board), [board]);
  const turn = nextTurn(board, starter);
  const isDraw = !winner && board.every(Boolean);
  const isRoundComplete = Boolean(winner) || isDraw;
  const displayScores = useMemo<ScoreState>(() => {
    if (winner) return { ...scores, [winner.disc]: scores[winner.disc] + 1 };
    if (isDraw) return { ...scores, draws: scores.draws + 1 };
    return scores;
  }, [isDraw, scores, winner]);
  const isMatchComplete = isRoundComplete && round >= 5;
  const matchWinner: Disc | null =
    displayScores.lime === displayScores.violet
      ? null
      : displayScores.lime > displayScores.violet
        ? "lime"
        : "violet";

  useEffect(() => {
    if (!isMatchComplete || (isMultiplayer && !isHost)) return;
    trackGameCompleted("connect-four", isMultiplayer ? "multiplayer" : "single", roomId, {
      playerCount: isMultiplayer ? Math.max(players.length, 2) : 2,
      winner: matchWinner || "draw",
      limeWins: displayScores.lime,
      violetWins: displayScores.violet,
      draws: displayScores.draws,
      roundsPlayed: round,
    });
  }, [displayScores.draws, displayScores.lime, displayScores.violet, isHost, isMatchComplete, isMultiplayer, matchWinner, players.length, roomId, round]);
  const myDisc = player ? assignments.get(player.id) : undefined;
  const isMyTurn = !isMultiplayer || myDisc === turn;
  const playerLime = players.find(
    (roomPlayer) => assignments.get(roomPlayer.id) === "lime"
  );
  const playerViolet = players.find(
    (roomPlayer) => assignments.get(roomPlayer.id) === "violet"
  );
  const connectionLabel = !isMultiplayer
    ? null
    : error
      ? "Offline"
      : connectionState === "connected"
        ? "Live"
        : "Connecting";

  const handleCreateRoom = useCallback(() => {
    const nextRoomId = createRoomCode();
    const roomPlayer = getOrCreatePlayer();
    sessionStorage.setItem(`connect-four-room-host:${nextRoomId}`, roomPlayer.id);
    trackRoomCreated("connect-four", nextRoomId);
    router.push(`/connect-four/room/${nextRoomId}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      setCopiedInvite(false);
    }
  }, []);

  const handleStartSinglePlayer = useCallback(() => {
    trackGameStarted("connect-four", "single", undefined, { playerCount: 2 });
    setMatch({
      board: emptyBoard(),
      round: 1,
      starter: "lime",
      scores: EMPTY_SCORES,
      lastMoveIndex: null,
    });
    setFeed([{ text: "You open game 1" }]);
    setGateView("playing");
  }, []);

  useEffect(() => {
    if (!isRoundComplete) {
      setShowResult(false);
      return;
    }
    const timer = setTimeout(() => setShowResult(true), winner ? 1050 : 420);
    return () => clearTimeout(timer);
  }, [isRoundComplete, round, winner]);

  useEffect(() => {
    if (
      isMultiplayer ||
      gateView !== "playing" ||
      turn !== "violet" ||
      isRoundComplete
    ) {
      setCpuThinking(false);
      return;
    }

    setCpuThinking(true);
    const timer = setTimeout(() => {
      const column = chooseComputerColumn(board);
      if (column === null) {
        setCpuThinking(false);
        return;
      }
      setMatch((current) => {
        if (
          getWinner(current.board) ||
          nextTurn(current.board, current.starter) !== "violet"
        ) {
          return current;
        }
        const result = boardAfterMove(current.board, column, "violet");
        if (!result) return current;
        return {
          ...current,
          board: result.board,
          lastMoveIndex: result.landingIndex,
        };
      });
      setFeed((events) => [
        { text: `Guidde CPU dropped in column ${column + 1}` },
        ...events,
      ].slice(0, 5));
      setCpuThinking(false);
    }, 650);

    return () => clearTimeout(timer);
  }, [board, gateView, isMultiplayer, isRoundComplete, turn]);

  const handleColumnSelect = useCallback(
    (column: number) => {
      if (getLandingIndex(board, column) === null || isRoundComplete) return;

      if (!isMultiplayer) {
        if (turn !== "lime" || cpuThinking) return;
        setMatch((current) => {
          if (
            getWinner(current.board) ||
            nextTurn(current.board, current.starter) !== "lime"
          ) {
            return current;
          }
          const result = boardAfterMove(current.board, column, "lime");
          if (!result) return current;
          return {
            ...current,
            board: result.board,
            lastMoveIndex: result.landingIndex,
          };
        });
        setFeed((events) => [
          { text: `You dropped in column ${column + 1}` },
          ...events,
        ].slice(0, 5));
        return;
      }

      if (!myDisc || !isMyTurn) return;
      publishMove(column, myDisc, round).catch(() => {});
    },
    [board, cpuThinking, isMultiplayer, isMyTurn, isRoundComplete, myDisc, publishMove, round, turn]
  );

  const handleReset = useCallback(() => {
    const nextRound = isMatchComplete ? 1 : round + 1;
    const nextStarter = isMatchComplete ? "lime" : otherDisc(starter);
    const nextScores = isMatchComplete ? EMPTY_SCORES : displayScores;

    if (isMatchComplete && (!isMultiplayer || isHost)) {
      trackRematchStarted(
        "connect-four",
        isMultiplayer ? "multiplayer" : "single",
        roomId,
        { playerCount: isMultiplayer ? Math.max(players.length, 2) : 2 },
      );
    }

    if (!isMultiplayer) {
      setMatch({
        board: emptyBoard(),
        round: nextRound,
        starter: nextStarter,
        scores: nextScores,
        lastMoveIndex: null,
      });
      setFeed([{
        text: isMatchComplete
          ? "A new five-game match started"
          : `${discLabel(nextStarter)} opens game ${nextRound}`,
      }]);
      return;
    }
    publishReset(nextRound, nextStarter, nextScores).catch(() => {});
  }, [displayScores, isHost, isMatchComplete, isMultiplayer, players.length, publishReset, roomId, round, starter]);

  const statusText = winner
    ? `${discLabel(winner.disc)} connects four!`
    : isDraw
      ? "The board is full"
      : !isMultiplayer
        ? turn === "lime"
          ? "Your turn"
          : cpuThinking
            ? "Guidde is thinking…"
            : "Guidde’s turn"
        : myDisc
          ? isMyTurn
            ? "Your turn"
            : `${discLabel(turn)}’s turn`
          : "Watching the match";

  const lobbyPlayers = useMemo(() => {
    const byId = new Map(players.map((roomPlayer) => [roomPlayer.id, roomPlayer]));
    if (player) byId.set(player.id, player);
    return [...byId.values()].sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [player, players]);
  const contenders = lobbyPlayers.slice(0, 2);
  const everybodyReady =
    contenders.length === 2 && contenders.every((roomPlayer) => roomPlayer.ready);
  const handleStartRoomGame = useCallback(async () => {
    await startRoomGame(contenders[0].id, contenders[1].id);
    trackGameStarted("connect-four", "multiplayer", roomId, {
      playerCount: contenders.length,
    });
  }, [contenders, roomId, startRoomGame]);
  const waitingMessage =
    contenders.length < 2
      ? "Invite one more player to continue."
      : everybodyReady
        ? "Both players are ready. Drop the first disc!"
        : "The match unlocks when both players are ready.";

  const gateNavigation = (
    <header className={shell.gateNav}>
      <Link href="/" aria-label="Guidde games home" className={shell.gateLogoLink}>
        <Image
          src="/guidde3.svg"
          alt="Guidde"
          width={230}
          height={79}
          className={shell.gateLogo}
          priority
        />
      </Link>
      <Link href="/" className={shell.menuLink}>
        <span aria-hidden="true"><ArrowIcon direction="left" /></span> Back to menu
      </Link>
    </header>
  );

  if (!isMultiplayer && gateView === "mode") {
    return (
      <div className={shell.gatePage}>
        {gateNavigation}
        <main className={shell.modeGate}>
          <div className={shell.gateHeading}>
            <p className={shell.kicker}>Connect Four</p>
            <h1>Choose your match.</h1>
            <p>
              Outsmart the computer or invite a friend for a live race to four.
              Every disc matters.
            </p>
          </div>

          <div className={shell.modeChoices}>
            <button
              type="button"
              className={`${shell.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={shell.choiceNumber}>01</span>
              <ConnectBoardPreview />
              <span className={shell.choiceCopy}>
                <strong>Solo challenge</strong>
                <small>Play Lime against the Guidde computer.</small>
              </span>
              <span className={shell.choiceArrow} aria-hidden="true"><ArrowIcon direction="up-right" /></span>
            </button>

            <button
              type="button"
              className={`${shell.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={shell.choiceNumber}>02</span>
              <ConnectBoardPreview />
              <span className={shell.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Create a room and trade live turns.</small>
              </span>
              <span className={shell.choiceArrow} aria-hidden="true"><ArrowIcon direction="up-right" /></span>
            </button>
          </div>

          <div className={shell.gateSteps} aria-label="Game setup progress">
            <span className={shell.activeStep}>1. Choose mode</span>
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
      <div className={shell.gatePage}>
        {gateNavigation}
        <main className={shell.setupGate}>
          <button
            type="button"
            className={shell.stepBack}
            onClick={() => setGateView("mode")}
          >
            <ArrowIcon direction="left" /> Change game mode
          </button>

          <section
            className={`${shell.setupCard} ${
              isSingleSetup ? ui.singleSetup : ui.multiplayerSetup
            }`}
          >
            <div className={shell.setupCopy}>
              <p className={shell.kicker}>
                {isSingleSetup ? "Solo challenge" : "Multiplayer"}
              </p>
              <h1>{isSingleSetup ? "Drop into battle." : "Challenge a friend."}</h1>
              <p>
                {isSingleSetup
                  ? "You are Lime. Build a row of four before the computer does. The opening turn switches after every game."
                  : "Create a private room or join with a four-digit code. Take turns dropping discs and play a five-game match."}
              </p>
              <div className={shell.setupDetails}>
                <span><strong>5</strong> games</span>
                <span><strong>{isSingleSetup ? "1 + CPU" : "2"}</strong> players</span>
                <span><strong>4</strong> to win</span>
              </div>
              <button
                type="button"
                className={shell.primaryAction}
                onClick={isSingleSetup ? handleStartSinglePlayer : handleCreateRoom}
              >
                {isSingleSetup ? "Start game" : "Create room"}
                <span aria-hidden="true"><ArrowIcon /></span>
              </button>
              {!isSingleSetup && <RoomJoinForm gamePath="/connect-four" />}
            </div>

            <ConnectBoardPreview large />
          </section>

          <div className={shell.gateSteps} aria-label="Game setup progress">
            <span>1. Choose mode</span>
            <span className={shell.activeStep}>2. Get ready</span>
            <span>3. Play</span>
          </div>
        </main>
      </div>
    );
  }

  if (isMultiplayer && !startEvent) {
    return (
      <div className={shell.gatePage}>
        {gateNavigation}
        <main className={shell.waitingGate}>
          <section className={shell.waitingIntro}>
            <div>
              <p className={shell.kicker}>Room {roomId?.toUpperCase()}</p>
              <h1>Waiting for your opponent.</h1>
              <p>
                Share the room, choose your player name, and mark yourself ready.
                The host starts once both players are set.
              </p>
            </div>

            <div className={shell.inviteBox}>
              <span>Private room code</span>
              <div>
                <strong>{roomId?.toUpperCase()}</strong>
                <button type="button" onClick={handleCopyInvite}>
                  {copiedInvite ? "Copied!" : "Copy invite"}
                </button>
              </div>
            </div>

            <div className={shell.connectionLine} role="status">
              <span
                className={`${shell.connectionDot} ${
                  connectionLabel === "Live" ? shell.connectionLive : ""
                }`}
              />
              {connectionLabel === "Live"
                ? "Room is live"
                : connectionLabel === "Offline"
                  ? "Room is offline"
                  : "Connecting to room"}
            </div>
          </section>

          <section className={shell.rosterCard}>
            <div className={shell.rosterHeader}>
              <div>
                <span>Players</span>
                <strong>{lobbyPlayers.length}</strong>
              </div>
              <span className={shell.readyCount}>
                {contenders.filter((roomPlayer) => roomPlayer.ready).length}/2 ready
              </span>
            </div>

            <label className={shell.nameField}>
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

            <div className={shell.playerList} aria-live="polite">
              {lobbyPlayers.map((roomPlayer, index) => (
                <div className={shell.playerRow} key={roomPlayer.id}>
                  <span
                    className={`${shell.playerAvatar} ${
                      index === 0
                        ? ui.limeAvatar
                        : index === 1
                          ? ui.violetAvatar
                          : ui.spectatorAvatar
                    }`}
                    aria-hidden="true"
                  />
                  <span className={shell.playerIdentity}>
                    <strong>
                      {roomPlayer.id === player?.id ? "You" : roomPlayer.name}
                    </strong>
                    <small>
                      {roomPlayer.isHost
                        ? "Host · Lime"
                        : index === 1
                          ? "Player · Violet"
                          : "Spectator"}
                    </small>
                  </span>
                  <span
                    className={`${shell.playerStatus} ${
                      roomPlayer.ready ? shell.playerReady : ""
                    }`}
                  >
                    {roomPlayer.ready ? "Ready" : "Not ready"}
                  </span>
                </div>
              ))}
            </div>

            {error && <p className={shell.lobbyError}>{error}</p>}

            <button
              type="button"
              className={`${shell.readyAction} ${player?.ready ? shell.isReady : ""}`}
              onClick={() => updateReady(!player?.ready)}
              disabled={!player || connectionLabel !== "Live"}
            >
              {player?.ready ? "I’m ready ✓" : "I’m ready"}
            </button>

            {isHost ? (
              <button
                type="button"
                className={shell.startRoomAction}
                onClick={() => void handleStartRoomGame()}
                disabled={!everybodyReady}
              >
                Start game <span aria-hidden="true"><ArrowIcon /></span>
              </button>
            ) : (
              <div className={`${shell.guestMessage} ${ui.guestMessage}`}>
                {player?.ready
                  ? "You’re ready. Waiting for the host to start."
                  : "Mark yourself ready when you’re set."}
              </div>
            )}

            <p className={shell.waitingRule}>{waitingMessage}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <main className={`${shell.playPage} ${ui.playPage}`}>
      <header className={ui.playHeader}>
        <div className={ui.headerLead}>
          <Link href="/" className={shell.gameMenuLink}>
            <span aria-hidden="true"><ArrowIcon direction="left" /></span> Menu
          </Link>
          <div>
            <p className={ui.eyebrow}>
              Connect Four · Game {round} of 5 · {discLabel(starter)} opened
            </p>
            <h1>{statusText}</h1>
          </div>
        </div>
        <div className={ui.headerActions}>
          {connectionLabel && (
            <span className={`${ui.liveBadge} ${connectionLabel === "Live" ? ui.live : ""}`}>
              {connectionLabel}
            </span>
          )}
          <button type="button" onClick={toggle} className={ui.secondaryButton}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {isMultiplayer && (
        <section className={ui.roomBar}>
          <div>
            <strong>Room {roomId}</strong>
            <p>{player?.name || "Joining"} · {players.length} connected</p>
          </div>
          <div className={ui.roomActions}>
            <input
              key={player?.name || "joining"}
              aria-label="Player name"
              defaultValue={player?.name || ""}
              onBlur={(event) => updatePlayerName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="Your name"
            />
            <button type="button" onClick={handleCopyInvite} className={ui.secondaryButton}>
              {copiedInvite ? "Copied" : "Copy invite"}
            </button>
          </div>
        </section>
      )}

      {error && <div className={ui.errorBanner}>{error}</div>}

      <section className={ui.gameArea}>
        <div className={ui.boardStage}>
          <div className={ui.turnStrip} aria-live="polite">
            <span className={`${ui.turnDisc} ${ui[turn]}`} aria-hidden="true" />
            <span>{statusText}</span>
            <small>Choose a column</small>
          </div>

          <div className={ui.dropRail} aria-label="Choose a column">
            {Array.from({ length: COLUMNS }, (_, column) => {
              const isFull = getLandingIndex(board, column) === null;
              const isDisabled =
                isFull ||
                isRoundComplete ||
                (isMultiplayer && (!myDisc || !isMyTurn)) ||
                (!isMultiplayer && (turn !== "lime" || cpuThinking));
              return (
                <button
                  type="button"
                  key={column}
                  onClick={() => handleColumnSelect(column)}
                  disabled={isDisabled}
                  aria-label={isFull ? `Column ${column + 1}, full` : `Drop in column ${column + 1}`}
                >
                  <span className={`${ui.railDisc} ${ui[turn]}`} aria-hidden="true" />
                  <small>{column + 1}</small>
                </button>
              );
            })}
          </div>

          <div className={ui.board} role="grid" aria-label="Connect Four board">
            {board.map((cell, index) => {
              const row = Math.floor(index / COLUMNS);
              const column = index % COLUMNS;
              const isWinningCell = winner?.line.includes(index);
              return (
                <span
                  key={index}
                  role="gridcell"
                  aria-label={`Row ${row + 1}, column ${column + 1}${cell ? `, ${discLabel(cell)} disc` : ", empty"}`}
                  className={`${ui.slot} ${isWinningCell ? ui.winningSlot : ""}`}
                >
                  {cell && (
                    <span
                      className={`${ui.disc} ${ui[cell]} ${
                        index === lastMoveIndex ? ui.lastMove : ""
                      }`}
                      style={{ "--drop-rows": row + 1 } as React.CSSProperties}
                    />
                  )}
                </span>
              );
            })}
          </div>
          <p className={ui.boardHint}>Connect four across, down, or diagonally.</p>
        </div>

        <aside className={ui.sidePanel}>
          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Match score</h2>
              <span>Game {round}/5</span>
            </div>
            <div className={ui.scoreRows}>
              <div className={turn === "lime" && !isRoundComplete ? ui.activePlayer : ""}>
                <span className={`${ui.scoreDisc} ${ui.lime}`} />
                <span>{isMultiplayer ? playerLime?.name || "Lime" : "You"}</span>
                <strong>{displayScores.lime}</strong>
              </div>
              <div className={turn === "violet" && !isRoundComplete ? ui.activePlayer : ""}>
                <span className={`${ui.scoreDisc} ${ui.violet}`} />
                <span>{isMultiplayer ? playerViolet?.name || "Violet" : "Guidde CPU"}</span>
                <strong>{displayScores.violet}</strong>
              </div>
            </div>
            <p className={ui.drawCount}>
              {displayScores.draws} draw{displayScores.draws === 1 ? "" : "s"}
            </p>
          </section>

          <section className={`${ui.panel} ${ui.openingPanel}`}>
            <div className={ui.panelHeading}>
              <h2>Opening turns</h2>
            </div>
            <div className={ui.roundSequence}>
              {(["lime", "violet", "lime", "violet", "lime"] as Disc[]).map(
                (disc, index) => (
                  <span
                    key={index}
                    className={`${ui.roundBubble} ${ui[disc]} ${
                      index + 1 === round ? ui.currentRound : ""
                    }`}
                    aria-label={`Game ${index + 1}: ${discLabel(disc)} opens`}
                  />
                )
              )}
            </div>
            <p>The opening color alternates every game.</p>
          </section>

          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Activity</h2>
            </div>
            {feed.length === 0 ? (
              <p className={ui.muted}>Waiting for the first move</p>
            ) : (
              <div className={ui.feed}>
                {feed.map((event, index) => (
                  <p key={`${event.text}-${index}`}>{event.text}</p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>

      {showResult && isRoundComplete && (
        <div className={ui.overlay}>
          <div className={ui.resultModal} role="dialog" aria-modal="true" aria-labelledby="connect-four-result">
            <p className={ui.modalEyebrow}>
              {isMatchComplete ? "Match complete" : `Game ${round} of 5`}
            </p>
            <h2 id="connect-four-result">
              {isMatchComplete
                ? matchWinner
                  ? `${discLabel(matchWinner)} wins the match`
                  : "The match is tied"
                : winner
                  ? `${discLabel(winner.disc)} connected four`
                  : "This game is a draw"}
            </h2>
            <div className={ui.modalScore}>
              <span>Lime <strong>{displayScores.lime}</strong></span>
              <span>Draws <strong>{displayScores.draws}</strong></span>
              <span>Violet <strong>{displayScores.violet}</strong></span>
            </div>
            <div className={ui.modalActions}>
              <button type="button" onClick={handleReset} className={ui.primaryButton}>
                {isMatchComplete
                  ? "Play new match"
                  : `Game ${round + 1} · ${discLabel(otherDisc(starter))} starts`}
              </button>
              <button type="button" onClick={() => router.push("/")} className={ui.secondaryButton}>
                Back to menu
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SCRAMBLE_DIFFICULTIES,
  calculateScramblePoints,
  createScrambleRounds,
  getScrambleRoundSeconds,
  normalizeScrambleGuess,
  type ScrambleDifficulty,
} from "@/lib/wordScramble";
import { createRoomCode, createRoomId } from "@/lib/useWordSearch";
import { useTheme } from "@/lib/useTheme";
import { RoomJoinForm } from "./RoomJoinForm";
import shell from "./TriviaBattleGame.module.css";
import ui from "./WordScrambleRaceGame.module.css";

type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};

type SolveEvent = {
  solveId: string;
  gameId: string;
  roundIndex: number;
  points: number;
  playerId: string;
  playerName: string;
};

type AdvanceEvent = {
  gameId: string;
  roundIndex: number;
  playerName: string;
};

type StartEvent = {
  gameId: string;
  difficulty: ScrambleDifficulty;
  playerIds: string[];
};

type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

const ROUND_COUNT = 10;

function normalizeDifficulty(value: string | null): ScrambleDifficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function getInitialDifficulty(): ScrambleDifficulty {
  if (typeof window === "undefined") return "normal";
  return normalizeDifficulty(new URLSearchParams(window.location.search).get("difficulty"));
}

function getOrCreatePlayer(): Player {
  const existingId = sessionStorage.getItem("word-scramble-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("word-scramble-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
}

function isDifficulty(value: unknown): value is ScrambleDifficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

function useWordScrambleRoom(
  roomId: string | undefined,
  onSolve: (event: SolveEvent) => void,
  onAdvance: (event: AdvanceEvent) => void,
  onStart: (event: StartEvent) => void
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
      sessionStorage.getItem(`word-scramble-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`word-scramble:${roomId}`, {
      params: { rewind: "300" },
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
          typeof data.gameId === "string" &&
          isDifficulty(data.difficulty) &&
          Array.isArray(data.playerIds) &&
          data.playerIds.every((id) => typeof id === "string")
        ) {
          const start = data as StartEvent;
          setStartEvent(start);
          onStart(start);
        }
        return;
      }

      if (message.name === "solve") {
        const data = message.data as Partial<SolveEvent>;
        if (
          typeof data.solveId === "string" &&
          typeof data.gameId === "string" &&
          typeof data.roundIndex === "number" &&
          typeof data.points === "number" &&
          typeof data.playerId === "string"
        ) {
          onSolve({
            solveId: data.solveId,
            gameId: data.gameId,
            roundIndex: data.roundIndex,
            points: data.points,
            playerId: data.playerId,
            playerName: data.playerName || "Player",
          });
        }
        return;
      }

      if (message.name === "advance") {
        const data = message.data as Partial<AdvanceEvent>;
        if (
          typeof data.gameId === "string" &&
          typeof data.roundIndex === "number"
        ) {
          onAdvance({
            gameId: data.gameId,
            roundIndex: data.roundIndex,
            playerName: data.playerName || "Player",
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
  }, [onAdvance, onSolve, onStart, player?.id, roomId]);

  const publishSolve = useCallback(
    async (event: Omit<SolveEvent, "solveId" | "playerId" | "playerName">) => {
      if (!channel || !player) return;
      await channel.publish("solve", {
        ...event,
        solveId: createRoomId(),
        playerId: player.id,
        playerName: player.name,
      } satisfies SolveEvent);
    },
    [channel, player]
  );

  const publishAdvance = useCallback(
    async (gameId: string, roundIndex: number) => {
      if (!channel || !player || !isHost) return;
      await channel.publish("advance", {
        gameId,
        roundIndex,
        playerName: player.name,
      } satisfies AdvanceEvent);
    },
    [channel, isHost, player]
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
    async (difficulty: ScrambleDifficulty, playerIds: string[]) => {
      if (!channel || !isHost) return;
      await channel.publish("game-started", {
        gameId: createRoomId(),
        difficulty,
        playerIds,
      } satisfies StartEvent);
    },
    [channel, isHost]
  );

  return {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishAdvance,
    publishSolve,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function WordScrambleRaceGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const initialGameId = useRef(roomId || createRoomId());
  const activeGameId = useRef(initialGameId.current);
  const processedSolves = useRef(new Set<string>());
  const solvedPlayerRounds = useRef(new Set<string>());
  const [race, setRace] = useState<{
    gameId: string;
    difficulty: ScrambleDifficulty;
    roundIndex: number;
  }>({
    gameId: initialGameId.current,
    difficulty: getInitialDifficulty(),
    roundIndex: 0,
  });
  const [timerState, setTimerState] = useState({
    gameId: initialGameId.current,
    roundIndex: 0,
    secondsLeft: SCRAMBLE_DIFFICULTIES.normal.seconds,
  });
  const [solves, setSolves] = useState<
    Record<number, Record<string, SolveEvent>>
  >({});
  const [scores, setScores] = useState<Record<string, number>>({});
  const [scoreNames, setScoreNames] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<string[]>([]);
  const [guess, setGuess] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [submittedRound, setSubmittedRound] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [gateView, setGateView] = useState<GateView>("mode");
  const isMultiplayer = Boolean(roomId);

  const applyStart = useCallback((event: StartEvent) => {
    activeGameId.current = event.gameId;
    processedSolves.current.clear();
    solvedPlayerRounds.current.clear();
    setRace({
      gameId: event.gameId,
      difficulty: event.difficulty,
      roundIndex: 0,
    });
    setSolves({});
    setScores({});
    setScoreNames({});
    setFeed(["The race is live. Unscramble quickly!"]);
  }, []);

  const applySolve = useCallback((event: SolveEvent) => {
    const playerRoundKey = `${event.gameId}:${event.roundIndex}:${event.playerId}`;
    if (
      event.gameId !== activeGameId.current ||
      processedSolves.current.has(event.solveId) ||
      solvedPlayerRounds.current.has(playerRoundKey)
    ) {
      return;
    }
    processedSolves.current.add(event.solveId);
    solvedPlayerRounds.current.add(playerRoundKey);
    setSolves((current) => ({
      ...current,
      [event.roundIndex]: {
        ...(current[event.roundIndex] || {}),
        [event.playerId]: event,
      },
    }));
    setScores((current) => ({
      ...current,
      [event.playerId]: (current[event.playerId] || 0) + event.points,
    }));
    setScoreNames((current) => ({ ...current, [event.playerId]: event.playerName }));
    setFeed((events) => [
      `${event.playerName} solved it · +${event.points}`,
      ...events,
    ].slice(0, 6));
  }, []);

  const applyAdvance = useCallback((event: AdvanceEvent) => {
    setRace((current) =>
      event.gameId === current.gameId && event.roundIndex > current.roundIndex
        ? { ...current, roundIndex: event.roundIndex }
        : current
    );
  }, []);

  const {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishAdvance,
    publishSolve,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useWordScrambleRoom(roomId, applySolve, applyAdvance, applyStart);

  const { gameId, difficulty, roundIndex } = race;
  const difficultyConfig = SCRAMBLE_DIFFICULTIES[difficulty];
  const roundSeconds = difficultyConfig.seconds;
  const secondsLeft = getScrambleRoundSeconds(
    timerState,
    gameId,
    roundIndex,
    roundSeconds
  );
  const rounds = useMemo(
    () => createScrambleRounds(gameId, difficulty, ROUND_COUNT),
    [difficulty, gameId]
  );
  const currentRound = rounds[roundIndex];
  const currentSolves = solves[roundIndex] || {};
  const isComplete = roundIndex >= rounds.length;
  const activeRace = !isMultiplayer
    ? gateView === "playing"
    : Boolean(startEvent);

  const racePlayers = useMemo(() => {
    if (!isMultiplayer) {
      return [{ id: "solo", name: "You", ready: true, isHost: true }];
    }
    if (!startEvent) return [];
    return startEvent.playerIds.map(
      (id) =>
        players.find((roomPlayer) => roomPlayer.id === id) || {
          id,
          name: scoreNames[id] || "Player",
          ready: true,
          isHost: false,
        }
    );
  }, [isMultiplayer, players, scoreNames, startEvent]);

  const myPlayerId = isMultiplayer ? player?.id : "solo";
  const playerSolved = Boolean(myPlayerId && currentSolves[myPlayerId]);
  const isActivePlayer = Boolean(
    myPlayerId && racePlayers.some((roomPlayer) => roomPlayer.id === myPlayerId)
  );
  const solvedCount = Object.keys(currentSolves).length;

  useEffect(() => {
    if (!activeRace || !currentRound || isComplete) return;
    setTimerState({ gameId, roundIndex, secondsLeft: roundSeconds });
    setGuess("");
    setFeedback(null);
    setWrongAttempts(0);
    setHintUsed(false);
    setSubmittedRound(null);
    const interval = setInterval(() => {
      setTimerState((current) =>
        current.gameId === gameId && current.roundIndex === roundIndex
          ? { ...current, secondsLeft: Math.max(0, current.secondsLeft - 1) }
          : current
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRace, currentRound, gameId, isComplete, roundIndex, roundSeconds]);

  const advanceRound = useCallback(() => {
    const nextRound = Math.min(roundIndex + 1, rounds.length);
    if (isMultiplayer) {
      if (isHost) publishAdvance(gameId, nextRound).catch(() => {});
      return;
    }
    setRace((current) => ({ ...current, roundIndex: nextRound }));
  }, [gameId, isHost, isMultiplayer, publishAdvance, roundIndex, rounds.length]);

  useEffect(() => {
    if (!currentRound || isComplete || secondsLeft !== 0) return;
    setFeedback(`Time! The answer was ${currentRound.answer}.`);
    const timer = setTimeout(advanceRound, 1400);
    return () => clearTimeout(timer);
  }, [advanceRound, currentRound, isComplete, secondsLeft]);

  useEffect(() => {
    if (!currentRound || isComplete || solvedCount === 0) return;
    const everybodySolved =
      racePlayers.length > 0 && solvedCount >= racePlayers.length;
    if ((!isMultiplayer && playerSolved) || (isMultiplayer && isHost && everybodySolved)) {
      const timer = setTimeout(advanceRound, 1100);
      return () => clearTimeout(timer);
    }
  }, [advanceRound, currentRound, isComplete, isHost, isMultiplayer, playerSolved, racePlayers.length, solvedCount]);

  const sortedScores = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; score: number }>();
    racePlayers.forEach((roomPlayer) => {
      rows.set(roomPlayer.id, {
        id: roomPlayer.id,
        name: roomPlayer.name,
        score: scores[roomPlayer.id] || 0,
      });
    });
    Object.entries(scores).forEach(([id, score]) => {
      if (!rows.has(id)) {
        rows.set(id, { id, name: scoreNames[id] || "Player", score });
      }
    });
    return [...rows.values()].sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name)
    );
  }, [racePlayers, scoreNames, scores]);

  const topScore = sortedScores[0]?.score || 0;
  const winners = sortedScores.filter((row) => row.score === topScore);
  const winnerName = winners[0]?.name || "You";
  const winnerIsYou = !isMultiplayer || winnerName.trim().toLowerCase() === "you";
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
    sessionStorage.setItem(`word-scramble-room-host:${nextRoomId}`, roomPlayer.id);
    router.push(`/word-scramble/room/${nextRoomId}?difficulty=${difficulty}`);
  }, [difficulty, router]);

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

  const startSingleRace = useCallback(() => {
    const nextGameId = createRoomId();
    activeGameId.current = nextGameId;
    processedSolves.current.clear();
    solvedPlayerRounds.current.clear();
    setRace((current) => ({
      gameId: nextGameId,
      difficulty: current.difficulty,
      roundIndex: 0,
    }));
    setSolves({});
    setScores({});
    setScoreNames({});
    setFeed([]);
    setGateView("playing");
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !currentRound ||
        isComplete ||
        secondsLeft === 0 ||
        playerSolved ||
        !isActivePlayer
      ) {
        return;
      }

      const cleanGuess = normalizeScrambleGuess(guess);
      if (!cleanGuess) return;

      if (cleanGuess !== currentRound.answer) {
        setWrongAttempts((current) => current + 1);
        setFeedback("Not quite—mix the letters and try again.");
        setGuess("");
        return;
      }

      const points = calculateScramblePoints(
        secondsLeft,
        roundSeconds,
        wrongAttempts,
        hintUsed
      );
      setFeedback(`Solved! +${points} points`);
      setGuess(currentRound.answer);
      setSubmittedRound(`${gameId}:${roundIndex}`);

      if (!isMultiplayer) {
        applySolve({
          solveId: createRoomId(),
          gameId,
          roundIndex,
          points,
          playerId: "solo",
          playerName: "You",
        });
        return;
      }

      publishSolve({ gameId, roundIndex, points }).catch(() => {
        setSubmittedRound(null);
        setFeedback("Your answer could not be sent. Please try again.");
      });
    },
    [applySolve, currentRound, gameId, guess, hintUsed, isActivePlayer, isComplete, isMultiplayer, playerSolved, publishSolve, roundIndex, roundSeconds, secondsLeft, wrongAttempts]
  );

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
        ? "Everyone is ready. Start the scramble!"
        : "The race unlocks when everyone is ready.";

  const handleNewRace = useCallback(() => {
    if (!isMultiplayer) {
      startSingleRace();
      return;
    }
    if (!isHost) return;
    const playerIds =
      lobbyPlayers.length > 0
        ? lobbyPlayers.map((roomPlayer) => roomPlayer.id)
        : startEvent?.playerIds || [];
    startRoomGame(difficulty, playerIds).catch(() => {});
  }, [difficulty, isHost, isMultiplayer, lobbyPlayers, startEvent, startRoomGame, startSingleRace]);

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
        <span aria-hidden="true">←</span> Back to menu
      </Link>
    </header>
  );

  const difficultyPicker = (
    <div className={shell.difficultyPicker} role="group" aria-label="Choose difficulty">
      {(Object.entries(SCRAMBLE_DIFFICULTIES) as [
        ScrambleDifficulty,
        (typeof SCRAMBLE_DIFFICULTIES)[ScrambleDifficulty],
      ][]).map(([value, option]) => (
        <button
          key={value}
          type="button"
          className={difficulty === value ? shell.difficultyActive : undefined}
          onClick={() => setRace((current) => ({ ...current, difficulty: value }))}
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );

  if (!isMultiplayer && gateView === "mode") {
    return (
      <div className={shell.gatePage}>
        {gateNavigation}
        <main className={shell.modeGate}>
          <div className={shell.gateHeading}>
            <p className={shell.kicker}>Word Scramble Race</p>
            <h1>See the word before anyone else.</h1>
            <p>
              Rearrange Bible names, places, books, and themes before the clock
              runs out. Solve faster to score higher.
            </p>
          </div>

          <div className={shell.modeChoices}>
            <button
              type="button"
              className={`${shell.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={shell.choiceNumber}>01</span>
              <span className={ui.choiceScramble} aria-hidden="true">
                {"IHTAF".split("").map((letter, index) => (
                  <span key={`${letter}-${index}`}>{letter}</span>
                ))}
              </span>
              <span className={shell.choiceCopy}>
                <strong>Single player</strong>
                <small>Chase your best score across ten words.</small>
              </span>
              <span className={shell.choiceArrow} aria-hidden="true">↗</span>
            </button>

            <button
              type="button"
              className={`${shell.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={shell.choiceNumber}>02</span>
              <span className={`${ui.choiceScramble} ${ui.choiceScrambleMulti}`} aria-hidden="true">
                {"ECAGR".split("").map((letter, index) => (
                  <span key={`${letter}-${index}`}>{letter}</span>
                ))}
              </span>
              <span className={shell.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Race friends on the same words in real time.</small>
              </span>
              <span className={shell.choiceArrow} aria-hidden="true">↗</span>
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
            ← Change game mode
          </button>

          <section
            className={`${shell.setupCard} ${
              isSingleSetup ? ui.singleSetup : ui.multiplayerSetup
            }`}
          >
            <div className={shell.setupCopy}>
              <p className={shell.kicker}>
                {isSingleSetup ? "Single player" : "Multiplayer"}
              </p>
              <h1>{isSingleSetup ? "Choose your pace." : "Bring your fastest thinkers."}</h1>
              <p>
                {isSingleSetup
                  ? "Pick a difficulty, then unscramble ten Bible words. Every second saved adds to your score."
                  : "Choose a difficulty, create or join a private room, and race together once everyone is ready."}
              </p>
              {difficultyPicker}
              <div className={shell.setupDetails}>
                <span><strong>10</strong> words</span>
                <span><strong>{roundSeconds}s</strong> each</span>
                <span><strong>Speed</strong> scoring</span>
              </div>
              <button
                type="button"
                className={shell.primaryAction}
                onClick={isSingleSetup ? startSingleRace : handleCreateRoom}
              >
                {isSingleSetup ? "Start race" : "Create room"}
                <span aria-hidden="true">→</span>
              </button>
              {!isSingleSetup && <RoomJoinForm gamePath="/word-scramble" />}
            </div>

            <div className={ui.setupScramble} aria-hidden="true">
              <span className={ui.setupTimer}>{roundSeconds}</span>
              <small>Bible book</small>
              <div className={ui.setupLetters}>
                {"MALPS".split("").map((letter, index) => (
                  <span key={`${letter}-${index}`}>{letter}</span>
                ))}
              </div>
              <span className={ui.setupArrow}>↓</span>
              <strong>PSALM</strong>
            </div>
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
              <h1>Waiting for word racers.</h1>
              <p>
                Share the invite, choose your player name, and mark yourself
                ready before the first scrambled word appears.
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

            <div className={shell.battleRule}>
              <span>Race difficulty</span>
              <strong>{isHost ? difficultyConfig.label : "Set by host"}</strong>
              <small>10 words · {roundSeconds} seconds each</small>
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
              <div><span>Players</span><strong>{lobbyPlayers.length}</strong></div>
              <span className={shell.readyCount}>
                {lobbyPlayers.filter((roomPlayer) => roomPlayer.ready).length} ready
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
              {lobbyPlayers.map((roomPlayer) => (
                <div className={shell.playerRow} key={roomPlayer.id}>
                  <span className={`${shell.playerAvatar} ${ui.playerAvatar}`} aria-hidden="true">
                    {roomPlayer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={shell.playerIdentity}>
                    <strong>{roomPlayer.id === player?.id ? "You" : roomPlayer.name}</strong>
                    <small>{roomPlayer.isHost ? "Host" : "Word racer"}</small>
                  </span>
                  <span className={`${shell.playerStatus} ${roomPlayer.ready ? shell.playerReady : ""}`}>
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
                onClick={() =>
                  startRoomGame(
                    difficulty,
                    lobbyPlayers.map((roomPlayer) => roomPlayer.id)
                  )
                }
                disabled={!everybodyReady}
              >
                Start race <span aria-hidden="true">→</span>
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

  const showAnswer = playerSolved || secondsLeft === 0;
  const answerLocked =
    playerSolved ||
    submittedRound === `${gameId}:${roundIndex}` ||
    secondsLeft === 0 ||
    !isActivePlayer ||
    isComplete;
  const timerProgress = Math.max(
    0,
    Math.min(100, (secondsLeft / roundSeconds) * 100)
  );

  return (
    <main className={`${shell.playPage} ${ui.playPage}`}>
      <header className={ui.gameHeader}>
        <div className={ui.gameHeaderLead}>
          <Link href="/" className={shell.gameMenuLink}>
            <span aria-hidden="true">←</span> Menu
          </Link>
          <div>
            <p className={ui.gameEyebrow}>
              Word Scramble Race · {difficultyConfig.label}
            </p>
            <h1>{isComplete ? "Final scores" : `Word ${roundIndex + 1} of ${rounds.length}`}</h1>
          </div>
        </div>
        <div className={ui.gameHeaderActions}>
          {connectionLabel && (
            <span className={`${ui.statusBadge} ${connectionLabel === "Live" ? ui.statusLive : ""}`}>
              {connectionLabel}
            </span>
          )}
          <button type="button" className={ui.iconAction} onClick={toggle}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {(!isMultiplayer || isHost) && (
            <button type="button" className={ui.newRaceAction} onClick={handleNewRace}>
              New race
            </button>
          )}
        </div>
      </header>

      <div className={ui.raceProgress} aria-hidden="true">
        <span style={{ width: `${Math.min(100, ((roundIndex + 1) / rounds.length) * 100)}%` }} />
      </div>

      {error && <div className={ui.gameError}>{error}</div>}

      <section className={ui.gameArea}>
        <div className={ui.scramblePanel}>
          {currentRound ? (
            <>
              <div className={ui.timerRow}>
                <div
                  className={ui.timer}
                  style={{ "--timer-progress": `${timerProgress * 3.6}deg` } as React.CSSProperties}
                >
                  <span>{secondsLeft}</span>
                  <small>sec</small>
                </div>
                <div className={ui.roundMeta}>
                  <span>{currentRound.category}</span>
                  <strong>Up to 1,000 points</strong>
                </div>
              </div>

              <div className={ui.scramblePrompt}>
                <p>Unscramble this word</p>
                <div className={ui.letterTiles} aria-label={`Scrambled letters: ${currentRound.scrambled.split("").join(", ")}`}>
                  {currentRound.scrambled.split("").map((letter, index) => (
                    <span key={`${letter}-${index}`} aria-hidden="true">{letter}</span>
                  ))}
                </div>
              </div>

              <form className={ui.guessForm} onSubmit={handleSubmit}>
                <label htmlFor="scramble-guess">Your answer</label>
                <div>
                  <input
                    key={`${gameId}:${roundIndex}`}
                    id="scramble-guess"
                    value={guess}
                    onChange={(event) => {
                      setGuess(normalizeScrambleGuess(event.target.value));
                      if (feedback?.startsWith("Not quite")) setFeedback(null);
                    }}
                    maxLength={currentRound.answer.length}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={`${currentRound.answer.length} letters`}
                    disabled={answerLocked}
                    autoFocus
                  />
                  <button type="submit" disabled={answerLocked || !guess}>
                    Lock it in <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>

              <div className={ui.answerBar} aria-live="polite">
                <div>
                  {feedback ? (
                    <strong className={playerSolved ? ui.correctFeedback : ui.feedback}>{feedback}</strong>
                  ) : showAnswer ? (
                    <strong>Answer: {currentRound.answer}</strong>
                  ) : (
                    <span>Type your answer before the timer reaches zero.</span>
                  )}
                  {hintUsed && !showAnswer && (
                    <small>Starts with {currentRound.answer[0]} · ends with {currentRound.answer.at(-1)}</small>
                  )}
                </div>
                {!hintUsed && !showAnswer && isActivePlayer && (
                  <button type="button" onClick={() => setHintUsed(true)}>
                    Reveal hint <small>−150 pts</small>
                  </button>
                )}
                {isMultiplayer && isHost && playerSolved && solvedCount < racePlayers.length && (
                  <button type="button" onClick={advanceRound}>
                    Continue <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className={ui.completePlaceholder}>
              <span aria-hidden="true">✦</span>
              <h2>Race complete</h2>
            </div>
          )}
        </div>

        <aside className={ui.sidePanel}>
          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Leaderboard</h2>
              <span>{racePlayers.length} player{racePlayers.length === 1 ? "" : "s"}</span>
            </div>
            <div className={ui.scoreRows}>
              {sortedScores.map((row, index) => (
                <div className={`${ui.scoreRow} ${index === 0 ? ui.scoreLeader : ""}`} key={row.id}>
                  <span className={ui.rank}>{index + 1}</span>
                  <span className={ui.scoreIdentity}>
                    <strong>{row.name}</strong>
                    <small>{index === 0 ? "Leading" : "Still racing"}</small>
                  </span>
                  <strong className={ui.score}>{row.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Round status</h2>
              <span>{solvedCount}/{racePlayers.length} solved</span>
            </div>
            <div className={ui.racerStatus}>
              {racePlayers.map((roomPlayer) => (
                <div key={roomPlayer.id}>
                  <span>{roomPlayer.name.slice(0, 1).toUpperCase()}</span>
                  <strong>{roomPlayer.name}</strong>
                  <small>{currentSolves[roomPlayer.id] ? "Solved ✓" : "Thinking…"}</small>
                </div>
              ))}
            </div>
          </section>

          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Race feed</h2>
              <span>Live</span>
            </div>
            {feed.length === 0 ? (
              <p className={ui.emptyFeed}>The first solve will appear here.</p>
            ) : (
              <div className={ui.feed}>
                {feed.map((event, index) => (
                  <p key={`${event}-${index}`}><span aria-hidden="true" />{event}</p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>

      {isComplete && (
        <div className={ui.overlay}>
          <div className={ui.modal} role="dialog" aria-modal="true" aria-labelledby="scramble-results">
            <p>Race complete</p>
            <span className={ui.trophy} aria-hidden="true">✦</span>
            <h2 id="scramble-results">
              {winners.length > 1
                ? "A photo finish!"
                : winnerIsYou
                  ? "You win!"
                  : `${winnerName} wins!`}
            </h2>
            <p className={ui.modalSummary}>
              {winners.length > 1
                ? `${winners.map((winner) => winner.name).join(" and ")} finish level on ${topScore} points.`
                : winnerIsYou
                  ? `You unscrambled your way to ${topScore} points.`
                  : `${winnerName} unscrambled their way to ${topScore} points.`}
            </p>
            <div className={ui.finalScores}>
              {sortedScores.slice(0, 3).map((row, index) => (
                <div key={row.id}><span>#{index + 1} {row.name}</span><strong>{row.score}</strong></div>
              ))}
            </div>
            <div className={ui.modalActions}>
              {(!isMultiplayer || isHost) ? (
                <button type="button" className={ui.primaryModalAction} onClick={handleNewRace}>
                  Race again
                </button>
              ) : (
                <span className={ui.hostReplayMessage}>Waiting for the host to start another race.</span>
              )}
              <Link href="/" className={ui.secondaryModalAction}>Back to menu</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

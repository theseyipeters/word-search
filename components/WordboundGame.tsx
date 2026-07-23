"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  WORDBOUND_ALPHABET,
  WORDBOUND_ROUNDS,
  WORDBOUND_SECONDS,
  calculateWordboundPoints,
  normalizeWordboundLetter,
  normalizeWordboundWord,
} from "@/lib/wordbound";
import { createRoomCode, createRoomId } from "@/lib/useWordSearch";
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
import { FinalStandings } from "./FinalPosition";
import { RoomJoinForm } from "./RoomJoinForm";
import shell from "./TriviaBattleGame.module.css";
import ui from "./WordboundGame.module.css";

type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};

type StartEvent = {
  gameId: string;
  playerIds: string[];
  roundCount: number;
  seconds: number;
};

type LetterPickEvent = {
  eventId: string;
  gameId: string;
  roundIndex: number;
  playerId: string;
  playerName: string;
  letter: string;
};

type AnswerEvent = {
  eventId: string;
  gameId: string;
  roundIndex: number;
  playerId: string;
  playerName: string;
  word: string;
  definition: string;
  points: number;
};

type AdvanceEvent = {
  eventId: string;
  gameId: string;
  nextRound: number;
  reason: "winner" | "timeout";
};

type ValidationResponse = {
  valid: boolean;
  word: string;
  definition?: string;
  reason?: string;
};

function getOrCreatePlayer(): Player {
  const existingId = sessionStorage.getItem("wordbound-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name =
    existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("wordbound-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
}

function isStartEvent(value: Partial<StartEvent>): value is StartEvent {
  return (
    typeof value.gameId === "string" &&
    Array.isArray(value.playerIds) &&
    value.playerIds.length === 2 &&
    value.playerIds.every((id) => typeof id === "string") &&
    typeof value.roundCount === "number" &&
    typeof value.seconds === "number"
  );
}

function useWordboundRoom(
  roomId: string | undefined,
  onStart: (event: StartEvent) => void,
  onPick: (event: LetterPickEvent) => void,
  onAnswer: (event: AnswerEvent) => void,
  onAdvance: (event: AdvanceEvent) => void
) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [channel, setChannel] =
    useState<Ably.Types.RealtimeChannelPromise | null>(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const roomPlayer = getOrCreatePlayer();
    const roomHost =
      sessionStorage.getItem(`wordbound-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`wordbound:${roomId}`, {
      params: { rewind: "200" },
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
        if (isStartEvent(data)) onStart(data);
        return;
      }

      if (message.name === "letter-picked") {
        const data = message.data as Partial<LetterPickEvent>;
        if (
          typeof data.eventId === "string" &&
          typeof data.gameId === "string" &&
          typeof data.roundIndex === "number" &&
          typeof data.playerId === "string" &&
          typeof data.playerName === "string" &&
          typeof data.letter === "string" &&
          normalizeWordboundLetter(data.letter)
        ) {
          onPick(data as LetterPickEvent);
        }
        return;
      }

      if (message.name === "answer-accepted") {
        const data = message.data as Partial<AnswerEvent>;
        if (
          typeof data.eventId === "string" &&
          typeof data.gameId === "string" &&
          typeof data.roundIndex === "number" &&
          typeof data.playerId === "string" &&
          typeof data.playerName === "string" &&
          typeof data.word === "string" &&
          typeof data.definition === "string" &&
          typeof data.points === "number"
        ) {
          onAnswer(data as AnswerEvent);
        }
        return;
      }

      if (message.name === "round-advanced") {
        const data = message.data as Partial<AdvanceEvent>;
        if (
          typeof data.eventId === "string" &&
          typeof data.gameId === "string" &&
          typeof data.nextRound === "number" &&
          (data.reason === "winner" || data.reason === "timeout")
        ) {
          onAdvance(data as AdvanceEvent);
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
        if (!mounted) return;
        setChannel(roomChannel);
        setError(null);
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
  }, [onAdvance, onAnswer, onPick, onStart, player?.id, roomId]);

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
    async (playerIds: string[]) => {
      if (!channel || !isHost) return;
      await channel.publish("game-started", {
        gameId: createRoomId(),
        playerIds,
        roundCount: WORDBOUND_ROUNDS,
        seconds: WORDBOUND_SECONDS,
      } satisfies StartEvent);
    },
    [channel, isHost]
  );

  const publishPick = useCallback(
    async (gameId: string, roundIndex: number, letter: string) => {
      if (!channel || !player) return;
      await channel.publish("letter-picked", {
        eventId: createRoomId(),
        gameId,
        roundIndex,
        playerId: player.id,
        playerName: player.name,
        letter,
      } satisfies LetterPickEvent);
    },
    [channel, player]
  );

  const publishAnswer = useCallback(
    async (answer: Omit<AnswerEvent, "eventId" | "playerId" | "playerName">) => {
      if (!channel || !player) return;
      await channel.publish("answer-accepted", {
        ...answer,
        eventId: createRoomId(),
        playerId: player.id,
        playerName: player.name,
      } satisfies AnswerEvent);
    },
    [channel, player]
  );

  const publishAdvance = useCallback(
    async (
      gameId: string,
      nextRound: number,
      reason: AdvanceEvent["reason"]
    ) => {
      if (!channel || !isHost) return;
      await channel.publish("round-advanced", {
        eventId: createRoomId(),
        gameId,
        nextRound,
        reason,
      } satisfies AdvanceEvent);
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
    publishAnswer,
    publishPick,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function WordboundGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const activeGameId = useRef("");
  const activeRound = useRef(0);
  const processedPicks = useRef(new Set<string>());
  const processedAnswers = useRef(new Set<string>());
  const processedAdvances = useRef(new Set<string>());
  const usedWords = useRef(new Set<string>());
  const roundWinnerRef = useRef<AnswerEvent | null>(null);
  const advanceRequested = useRef("");
  const timerStarted = useRef("");
  const completedTracked = useRef("");

  const [game, setGame] = useState<StartEvent | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [picks, setPicks] = useState<Record<string, LetterPickEvent>>({});
  const [scores, setScores] = useState<Record<string, number>>({});
  const [scoreNames, setScoreNames] = useState<Record<string, string>>({});
  const [roundWinner, setRoundWinner] = useState<AnswerEvent | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(WORDBOUND_SECONDS);
  const [word, setWord] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [gameComplete, setGameComplete] = useState(false);

  const applyStart = useCallback((event: StartEvent) => {
    activeGameId.current = event.gameId;
    activeRound.current = 0;
    processedPicks.current.clear();
    processedAnswers.current.clear();
    processedAdvances.current.clear();
    usedWords.current.clear();
    roundWinnerRef.current = null;
    advanceRequested.current = "";
    timerStarted.current = "";
    setGame(event);
    setRoundIndex(0);
    setPicks({});
    setScores(Object.fromEntries(event.playerIds.map((id) => [id, 0])));
    setScoreNames({});
    setRoundWinner(null);
    setSecondsLeft(event.seconds);
    setWord("");
    setFeedback(null);
    setFeed(["The match is live. Choose your first letter."]);
    setGameComplete(false);
  }, []);

  const applyPick = useCallback((event: LetterPickEvent) => {
    if (
      event.gameId !== activeGameId.current ||
      event.roundIndex !== activeRound.current ||
      processedPicks.current.has(event.eventId)
    ) {
      return;
    }
    processedPicks.current.add(event.eventId);
    setPicks((current) => {
      if (current[event.playerId]) return current;
      return { ...current, [event.playerId]: event };
    });
  }, []);

  const applyAnswer = useCallback((event: AnswerEvent) => {
    if (
      event.gameId !== activeGameId.current ||
      event.roundIndex !== activeRound.current ||
      processedAnswers.current.has(event.eventId) ||
      roundWinnerRef.current
    ) {
      return;
    }
    processedAnswers.current.add(event.eventId);
    roundWinnerRef.current = event;
    usedWords.current.add(event.word);
    setRoundWinner(event);
    setScores((current) => ({
      ...current,
      [event.playerId]: (current[event.playerId] || 0) + event.points,
    }));
    setScoreNames((current) => ({
      ...current,
      [event.playerId]: event.playerName,
    }));
    setFeed((current) =>
      [`${event.playerName} bound “${event.word}” · +${event.points}`, ...current].slice(
        0,
        6
      )
    );
  }, []);

  const applyAdvance = useCallback((event: AdvanceEvent) => {
    if (
      event.gameId !== activeGameId.current ||
      processedAdvances.current.has(event.eventId) ||
      event.nextRound <= activeRound.current
    ) {
      return;
    }
    processedAdvances.current.add(event.eventId);
    if (event.reason === "timeout") {
      setFeed((current) => ["No word landed before time ran out.", ...current].slice(0, 6));
    }

    activeRound.current = event.nextRound;
    roundWinnerRef.current = null;
    advanceRequested.current = "";
    timerStarted.current = "";
    setRoundIndex(event.nextRound);
    setPicks({});
    setRoundWinner(null);
    setSecondsLeft(WORDBOUND_SECONDS);
    setWord("");
    setFeedback(null);
    setValidating(false);

    if (event.nextRound >= WORDBOUND_ROUNDS) {
      setGameComplete(true);
    }
  }, []);

  const {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishAdvance,
    publishAnswer,
    publishPick,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useWordboundRoom(
    roomId,
    applyStart,
    applyPick,
    applyAnswer,
    applyAdvance
  );

  useEffect(() => {
    trackGameView("wordbound", roomId);
  }, [roomId]);

  useEffect(() => {
    if (roomId && player) trackRoomJoined("wordbound", roomId, isHost);
  }, [isHost, player, roomId]);

  const lobbyPlayers = useMemo(() => {
    const byId = new Map(players.map((roomPlayer) => [roomPlayer.id, roomPlayer]));
    if (player) byId.set(player.id, player);
    return [...byId.values()].sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [player, players]);

  const matchPlayers = useMemo(() => {
    if (!game) return [];
    return game.playerIds.map(
      (id) =>
        players.find((roomPlayer) => roomPlayer.id === id) || {
          id,
          name: scoreNames[id] || "Player",
          ready: true,
          isHost: false,
        }
    );
  }, [game, players, scoreNames]);

  const myPlayerId = player?.id;
  const isParticipant = Boolean(
    myPlayerId && game?.playerIds.includes(myPlayerId)
  );
  const myPick = myPlayerId ? picks[myPlayerId] : undefined;
  const allPicked = Boolean(
    game && game.playerIds.every((id) => Boolean(picks[id]))
  );
  const startPlayerId = game?.playerIds[roundIndex % 2];
  const endPlayerId = game?.playerIds[(roundIndex + 1) % 2];
  const startLetter = startPlayerId ? picks[startPlayerId]?.letter : "";
  const endLetter = endPlayerId ? picks[endPlayerId]?.letter : "";
  const roundKey = game ? `${game.gameId}:${roundIndex}` : "";

  useEffect(() => {
    if (
      !game ||
      !allPicked ||
      roundWinner ||
      gameComplete ||
      timerStarted.current === roundKey
    ) {
      return;
    }
    timerStarted.current = roundKey;
    setSecondsLeft(game.seconds);
    const interval = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [allPicked, game, gameComplete, roundKey, roundWinner]);

  useEffect(() => {
    if (!game || !isHost || gameComplete) return;
    const reason =
      roundWinner ? "winner" : allPicked && secondsLeft === 0 ? "timeout" : null;
    if (!reason) return;
    const requestKey = `${game.gameId}:${roundIndex}:${reason}`;
    if (advanceRequested.current === requestKey) return;
    advanceRequested.current = requestKey;
    const delay = reason === "winner" ? 2400 : 1200;
    const timeout = setTimeout(() => {
      publishAdvance(game.gameId, roundIndex + 1, reason).catch(() => {
        advanceRequested.current = "";
      });
    }, delay);
    return () => clearTimeout(timeout);
  }, [
    allPicked,
    game,
    gameComplete,
    isHost,
    publishAdvance,
    roundIndex,
    roundWinner,
    secondsLeft,
  ]);

  const sortedScores = useMemo(
    () =>
      matchPlayers
        .map((roomPlayer) => ({
          id: roomPlayer.id,
          name: roomPlayer.name,
          score: scores[roomPlayer.id] || 0,
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    [matchPlayers, scores]
  );
  const topScore = sortedScores[0]?.score || 0;
  const winners = sortedScores.filter((row) => row.score === topScore);

  useEffect(() => {
    if (
      !game ||
      !gameComplete ||
      !isHost ||
      completedTracked.current === game.gameId
    ) {
      return;
    }
    completedTracked.current = game.gameId;
    trackGameCompleted("wordbound", "multiplayer", roomId, {
      playerCount: game.playerIds.length,
      roundsPlayed: game.roundCount,
      topScore,
      tied: winners.length > 1,
    });
  }, [game, gameComplete, isHost, roomId, topScore, winners.length]);

  const connectionLabel = error
    ? "Offline"
    : connectionState === "connected"
      ? "Live"
      : "Connecting";

  const handleCreateRoom = useCallback(() => {
    const nextRoomId = createRoomCode();
    const roomPlayer = getOrCreatePlayer();
    sessionStorage.setItem(`wordbound-room-host:${nextRoomId}`, roomPlayer.id);
    trackRoomCreated("wordbound", nextRoomId);
    router.push(`/wordbound/room/${nextRoomId}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      setCopiedInvite(false);
    }
  }, []);

  const beginMatch = useCallback(
    async (playerIds: string[], rematch = false) => {
      if (rematch) {
        trackRematchStarted("wordbound", "multiplayer", roomId, {
          playerCount: playerIds.length,
          rounds: WORDBOUND_ROUNDS,
        });
      } else {
        trackGameStarted("wordbound", "multiplayer", roomId, {
          playerCount: playerIds.length,
          rounds: WORDBOUND_ROUNDS,
        });
      }
      await startRoomGame(playerIds);
    },
    [roomId, startRoomGame]
  );

  const handleLetterPick = useCallback(
    (letter: string) => {
      if (
        !game ||
        !isParticipant ||
        myPick ||
        gameComplete ||
        roundIndex >= game.roundCount
      ) {
        return;
      }
      setFeedback(null);
      publishPick(game.gameId, roundIndex, letter).catch(() => {
        setFeedback("Your letter could not be locked. Try again.");
      });
    },
    [
      game,
      gameComplete,
      isParticipant,
      myPick,
      publishPick,
      roundIndex,
    ]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !game ||
        !allPicked ||
        !startLetter ||
        !endLetter ||
        !isParticipant ||
        roundWinnerRef.current ||
        secondsLeft === 0 ||
        validating
      ) {
        return;
      }

      const cleanWord = normalizeWordboundWord(word);
      if (!cleanWord) return;
      if (usedWords.current.has(cleanWord)) {
        setFeedback("That word has already been used in this match.");
        return;
      }

      setValidating(true);
      setFeedback("Checking the dictionary…");

      try {
        const response = await fetch("/api/wordbound/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word: cleanWord,
            startLetter,
            endLetter,
          }),
        });
        const result = (await response.json()) as ValidationResponse;

        if (!result.valid || !result.definition) {
          setFeedback(result.reason || "That word isn’t accepted.");
          setValidating(false);
          return;
        }

        if (roundWinnerRef.current || secondsLeft === 0) {
          setFeedback("So close—another word landed first.");
          setValidating(false);
          return;
        }

        await publishAnswer({
          gameId: game.gameId,
          roundIndex,
          word: result.word,
          definition: result.definition,
          points: calculateWordboundPoints(secondsLeft),
        });
        setFeedback("Valid word—locking it in…");
      } catch {
        setFeedback("The dictionary couldn’t be reached. Try once more.");
      } finally {
        setValidating(false);
      }
    },
    [
      allPicked,
      endLetter,
      game,
      isParticipant,
      publishAnswer,
      roundIndex,
      secondsLeft,
      startLetter,
      validating,
      word,
    ]
  );

  const navigation = (
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

  if (!roomId) {
    return (
      <div className={`${shell.gatePage} ${ui.gatePage}`}>
        {navigation}
        <main className={ui.landing}>
          <section className={ui.landingCopy}>
            <p className={shell.kicker}>Wordbound · 2 players</p>
            <h1>Two letters. <br /> One word between them.</h1>
            <p>
              You each choose a letter, then race to enter a real English word
              that starts and ends with your picks.
            </p>

            <div className={ui.example} aria-label="T and F make thief">
              <span>T</span>
              <div>
                <small>Valid word</small>
                <strong>THIEF</strong>
              </div>
              <span>F</span>
            </div>

            <button
              type="button"
              className={shell.primaryAction}
              onClick={handleCreateRoom}
            >
              Create a room <span aria-hidden="true"><ArrowIcon /></span>
            </button>
            <RoomJoinForm gamePath="/wordbound" />
          </section>

          <aside className={ui.howToCard}>
            <span className={ui.cardLabel}>How a match works</span>
            <div>
              <span>01</span>
              <p><strong>Choose secretly</strong><small>Both players lock one letter.</small></p>
            </div>
            <div>
              <span>02</span>
              <p><strong>Reveal together</strong><small>Your letters become the word’s bookends.</small></p>
            </div>
            <div>
              <span>03</span>
              <p><strong>Race the clock</strong><small>The first dictionary-approved word scores.</small></p>
            </div>
            <div className={ui.matchRule}>
              <strong>{WORDBOUND_ROUNDS}</strong>
              <span>rounds</span>
              <strong>{WORDBOUND_SECONDS}</strong>
              <span>seconds</span>
            </div>
          </aside>
        </main>

        <div className={shell.gateSteps} aria-label="Game setup progress">
          <span className={shell.activeStep}>1. Make room</span>
          <span>2. Pick letters</span>
          <span>3. Bind a word</span>
        </div>
      </div>
    );
  }

  if (!game) {
    const everybodyReady =
      lobbyPlayers.length === 2 &&
      lobbyPlayers.every((roomPlayer) => roomPlayer.ready);
    const waitingMessage =
      lobbyPlayers.length < 2
        ? "Invite one more player to begin."
        : lobbyPlayers.length > 2
          ? "Wordbound rooms are made for exactly two players."
          : everybodyReady
            ? "Both players are ready. Start the match!"
            : "The match unlocks when both players are ready.";

    return (
      <div className={`${shell.gatePage} ${ui.gatePage}`}>
        {navigation}
        <main className={shell.waitingGate}>
          <section className={shell.waitingIntro}>
            <div>
              <p className={shell.kicker}>Room {roomId.toUpperCase()}</p>
              <h1>Find your word rival.</h1>
              <p>
                Share the invite with one player. When you’re both ready, your
                first letter pick begins.
              </p>
            </div>

            <div className={shell.inviteBox}>
              <span>Private room code</span>
              <div>
                <strong>{roomId.toUpperCase()}</strong>
                <button type="button" onClick={handleCopyInvite}>
                  {copiedInvite ? "Copied!" : "Copy invite"}
                </button>
              </div>
            </div>

            <div className={`${shell.battleRule} ${ui.roomRule}`}>
              <span>Match rules</span>
              <strong>{WORDBOUND_ROUNDS} rounds</strong>
              <small>{WORDBOUND_SECONDS} seconds · first valid word scores</small>
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
              <div><span>Players</span><strong>{lobbyPlayers.length}/2</strong></div>
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
                    <small>{roomPlayer.isHost ? "Host · Player 1" : "Player 2"}</small>
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
                  void beginMatch(lobbyPlayers.map((roomPlayer) => roomPlayer.id))
                }
                disabled={!everybodyReady}
              >
                Start match <span aria-hidden="true"><ArrowIcon /></span>
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

  const timerProgress = Math.max(
    0,
    Math.min(100, (secondsLeft / game.seconds) * 100)
  );
  const scoreLeader = sortedScores[0];
  const winnerIsYou = winners.some((winner) => winner.id === myPlayerId);
  const playerName = (id: string | undefined) =>
    matchPlayers.find((roomPlayer) => roomPlayer.id === id)?.name || "Player";

  return (
    <main className={ui.playPage}>
      <header className={ui.gameHeader}>
        <div className={ui.gameHeaderLead}>
          <Link href="/" className={ui.menuLink}>
            <span aria-hidden="true"><ArrowIcon direction="left" /></span> Menu
          </Link>
          <div>
            <p>Wordbound · Room {roomId.toUpperCase()}</p>
            <h1>
              {gameComplete
                ? "Final score"
                : `Round ${Math.min(roundIndex + 1, game.roundCount)} of ${game.roundCount}`}
            </h1>
          </div>
        </div>
        <div className={ui.gameHeaderActions}>
          <span className={`${ui.statusBadge} ${connectionLabel === "Live" ? ui.statusLive : ""}`}>
            {connectionLabel}
          </span>
          <button type="button" onClick={toggle}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {error && <div className={ui.gameError}>{error}</div>}

      <section className={ui.scoreStrip} aria-label="Scores">
        {sortedScores.map((row, index) => (
          <div className={index === 0 ? ui.leadingScore : ""} key={row.id}>
            <span>{row.id === myPlayerId ? "You" : row.name}</span>
            <strong>{row.score}</strong>
            <small>pts</small>
          </div>
        ))}
        <div className={ui.roundDots} aria-label={`${roundIndex} rounds completed`}>
          {Array.from({ length: game.roundCount }, (_, index) => (
            <span
              key={index}
              className={
                index < roundIndex
                  ? ui.roundDone
                  : index === roundIndex && !gameComplete
                    ? ui.roundActive
                    : ""
              }
            />
          ))}
        </div>
      </section>

      <div className={ui.gameLayout}>
        <section className={ui.board}>
          {!allPicked && !gameComplete ? (
            <div className={ui.pickStage}>
              <div className={ui.stageHeading}>
                <div>
                  <span>Choose secretly</span>
                  <h2>Lock one letter.</h2>
                </div>
                <p>
                  {myPick
                    ? "Your letter is locked. Waiting for your rival."
                    : "Your pick will be revealed when both players are ready."}
                </p>
              </div>

              <div className={ui.pickStatus}>
                {matchPlayers.map((roomPlayer) => {
                  const pick = picks[roomPlayer.id];
                  const isMe = roomPlayer.id === myPlayerId;
                  return (
                    <div key={roomPlayer.id}>
                      <span>{isMe ? "You" : roomPlayer.name}</span>
                      <strong>{isMe && pick ? pick.letter : pick ? "✓" : "?"}</strong>
                      <small>{pick ? "Locked in" : "Choosing…"}</small>
                    </div>
                  );
                })}
              </div>

              {isParticipant ? (
                <div className={ui.alphabet} role="group" aria-label="Choose a letter">
                  {WORDBOUND_ALPHABET.map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => handleLetterPick(letter)}
                      disabled={Boolean(myPick)}
                      className={myPick?.letter === letter ? ui.selectedLetter : ""}
                      aria-pressed={myPick?.letter === letter}
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={ui.spectatorNote}>You’re watching this match as a spectator.</p>
              )}

              {feedback && <p className={ui.feedback} role="status">{feedback}</p>}
            </div>
          ) : !gameComplete ? (
            <div className={ui.solveStage}>
              <div className={ui.stageHeading}>
                <div>
                  <span>Letters revealed</span>
                  <h2>Bind a real word.</h2>
                </div>
                <div
                  className={ui.timer}
                  style={{ "--progress": `${timerProgress * 3.6}deg` } as React.CSSProperties}
                  aria-label={`${secondsLeft} seconds remaining`}
                >
                  <strong>{secondsLeft}</strong>
                  <small>sec</small>
                </div>
              </div>

              <div className={ui.bookends}>
                <div>
                  <span>{playerName(startPlayerId)}</span>
                  <strong>{startLetter}</strong>
                  <small>Starts</small>
                </div>
                <span className={ui.wordBridge} aria-hidden="true">
                  <i /><i /><i /><i /><i />
                </span>
                <div>
                  <span>{playerName(endPlayerId)}</span>
                  <strong>{endLetter}</strong>
                  <small>Ends</small>
                </div>
              </div>

              {roundWinner ? (
                <div className={ui.acceptedWord} aria-live="polite">
                  <span>{roundWinner.playerId === myPlayerId ? "You found it!" : `${roundWinner.playerName} found it!`}</span>
                  <strong>
                    <b>{startLetter}</b>
                    {roundWinner.word.slice(1, -1)}
                    <b>{endLetter}</b>
                  </strong>
                  <p>{roundWinner.definition}</p>
                  <small>+{roundWinner.points} points</small>
                </div>
              ) : (
                <form className={ui.wordForm} onSubmit={handleSubmit}>
                  <label htmlFor="wordbound-answer">Your word</label>
                  <div>
                    <span aria-hidden="true">{startLetter}</span>
                    <input
                      id="wordbound-answer"
                      value={word}
                      onChange={(event) => {
                        setWord(normalizeWordboundWord(event.target.value).toUpperCase());
                        if (feedback && feedback !== "Checking the dictionary…") {
                          setFeedback(null);
                        }
                      }}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={30}
                      placeholder={`${startLetter}…${endLetter}`}
                      disabled={
                        !isParticipant ||
                        secondsLeft === 0 ||
                        validating ||
                        Boolean(roundWinner)
                      }
                      autoFocus
                    />
                    <span aria-hidden="true">{endLetter}</span>
                    <button
                      type="submit"
                      disabled={
                        !word ||
                        !isParticipant ||
                        secondsLeft === 0 ||
                        validating
                      }
                    >
                      {validating ? "Checking…" : "Bind word"}
                      <ArrowIcon />
                    </button>
                  </div>
                </form>
              )}

              {!roundWinner && (
                <div className={ui.feedbackLine} aria-live="polite">
                  <span>
                    {feedback ||
                      (secondsLeft === 0
                        ? "Time! Moving to the next round…"
                        : "The first dictionary-approved word wins the round.")}
                  </span>
                  <small>Letters only · 3+ characters · no names</small>
                </div>
              )}
            </div>
          ) : (
            <div className={ui.completeBoard}>
              <span aria-hidden="true">✦</span>
              <p>Match complete</p>
              <h2>
                {winners.length > 1
                  ? "Bound together."
                  : winnerIsYou
                    ? "You win!"
                    : `${scoreLeader?.name || "Your rival"} wins!`}
              </h2>
              <p>
                {winners.length > 1
                  ? `You finished level on ${topScore} points.`
                  : `${scoreLeader?.name || "The winner"} connected the letters for ${topScore} points.`}
              </p>
              <FinalStandings rows={sortedScores} currentPlayerId={myPlayerId} />
              <div>
                {isHost ? (
                  <button
                    type="button"
                    onClick={() => void beginMatch(game.playerIds, true)}
                  >
                    Play again <ArrowIcon />
                  </button>
                ) : (
                  <span>Waiting for the host to start another match.</span>
                )}
                <Link href="/">Back to menu</Link>
              </div>
            </div>
          )}
        </section>

        <aside className={ui.sidePanel}>
          <section>
            <div className={ui.panelHeading}>
              <h2>This round</h2>
              <span>{allPicked ? "Revealed" : "Picking"}</span>
            </div>
            <div className={ui.roleRows}>
              {matchPlayers.map((roomPlayer) => {
                const role =
                  roomPlayer.id === startPlayerId ? "Starts the word" : "Ends the word";
                return (
                  <div key={roomPlayer.id}>
                    <span>{roomPlayer.name.slice(0, 1).toUpperCase()}</span>
                    <p>
                      <strong>{roomPlayer.id === myPlayerId ? "You" : roomPlayer.name}</strong>
                      <small>{role}</small>
                    </p>
                    <b>{allPicked ? picks[roomPlayer.id]?.letter : picks[roomPlayer.id] ? "✓" : "…"}</b>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className={ui.panelHeading}>
              <h2>Live match</h2>
              <span>Room {roomId.toUpperCase()}</span>
            </div>
            {feed.length ? (
              <div className={ui.feed}>
                {feed.map((item, index) => (
                  <p key={`${item}-${index}`}><span aria-hidden="true" />{item}</p>
                ))}
              </div>
            ) : (
              <p className={ui.emptyFeed}>Round results will appear here.</p>
            )}
          </section>

          <section className={ui.rulesPanel}>
            <div className={ui.panelHeading}>
              <h2>Accepted words</h2>
              <span>Dictionary checked</span>
            </div>
            <p>
              English words with at least three letters. No names, spaces,
              abbreviations, or reused answers.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

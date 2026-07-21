"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Ably from "ably/promises";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import ui from "./TriviaBattleGame.module.css";

type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
};
type TriviaQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  reference: string;
};
type Difficulty = "easy" | "normal" | "hard";
type AnswerEvent = {
  questionIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  points: number;
  playerId: string;
  playerName: string;
};
type AdvanceEvent = {
  questionIndex: number;
  playerName: string;
};
type ResetEvent = {
  resetId: string;
  playerName: string;
};
type StartEvent = {
  gameId: string;
  difficulty: Difficulty;
  playerIds: string[];
};
type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

const QUESTION_SECONDS = 15;
const QUESTION_HISTORY_KEY = "trivia-battle-question-history";
const MAX_QUESTION_HISTORY = 400;
const ANSWER_LABELS = ["A", "B", "C", "D"];
const difficulties: { value: Difficulty; label: string; description: string }[] = [
  { value: "easy", label: "Easy", description: "Familiar stories and people" },
  { value: "normal", label: "Normal", description: "A balanced Bible challenge" },
  { value: "hard", label: "Hard", description: "Deeper knowledge and details" },
];

function isTriviaQuestion(value: unknown): value is TriviaQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<TriviaQuestion>;

  return (
    typeof question.question === "string" &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === "string") &&
    typeof question.correctIndex === "number" &&
    question.correctIndex >= 0 &&
    question.correctIndex <= 3 &&
    typeof question.reference === "string"
  );
}

function normalizeQuestions(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const questions = (payload as { questions?: unknown }).questions;
  return Array.isArray(questions) ? questions.filter(isTriviaQuestion) : [];
}

function getQuestionHistory() {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(QUESTION_HISTORY_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((question): question is string => typeof question === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberQuestionHistory(questions: TriviaQuestion[]) {
  if (typeof window === "undefined") return;
  const history = [
    ...getQuestionHistory(),
    ...questions.map((question) => question.question),
  ].slice(-MAX_QUESTION_HISTORY);
  localStorage.setItem(QUESTION_HISTORY_KEY, JSON.stringify(history));
}

function normalizeDifficulty(value: string | null): Difficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function getInitialDifficulty(): Difficulty {
  if (typeof window === "undefined") return "normal";
  return normalizeDifficulty(new URLSearchParams(window.location.search).get("difficulty"));
}

function getOrCreatePlayer(): Player {
  const existingId = sessionStorage.getItem("trivia-battle-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId) {
    return {
      id: existingId,
      name: existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`,
      ready: false,
      isHost: false,
    };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("trivia-battle-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
}

function useTriviaRoom(
  roomId: string | undefined,
  onAnswer: (event: AnswerEvent) => void,
  onAdvance: (event: AdvanceEvent) => void,
  onReset: (event: ResetEvent) => void,
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
      sessionStorage.getItem(`trivia-battle-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`trivia-battle:${roomId}`, {
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
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Presence failed");
      }
    };

    const handleRoomMessage = (message: Ably.Types.Message) => {
      if (message.name === "game-started") {
        const data = message.data as Partial<StartEvent>;
        if (
          typeof data.gameId === "string" &&
          (data.difficulty === "easy" ||
            data.difficulty === "normal" ||
            data.difficulty === "hard") &&
          Array.isArray(data.playerIds) &&
          data.playerIds.every((id) => typeof id === "string")
        ) {
          const start = data as StartEvent;
          setStartEvent(start);
          onStart(start);
        }
        return;
      }

      if (message.name === "answer") {
        const data = message.data as Partial<AnswerEvent>;
        if (
          typeof data.questionIndex === "number" &&
          typeof data.selectedIndex === "number" &&
          typeof data.playerId === "string"
        ) {
          onAnswer({
            questionIndex: data.questionIndex,
            selectedIndex: data.selectedIndex,
            isCorrect: Boolean(data.isCorrect),
            points: data.points || 0,
            playerId: data.playerId,
            playerName: data.playerName || "Player",
          });
        }
        return;
      }

      if (message.name === "advance") {
        const data = message.data as Partial<AdvanceEvent>;
        if (typeof data.questionIndex === "number") {
          onAdvance({
            questionIndex: data.questionIndex,
            playerName: data.playerName || "Player",
          });
        }
        return;
      }

      if (message.name === "reset") {
        const data = message.data as Partial<ResetEvent>;
        if (typeof data.resetId === "string") {
          onReset({
            resetId: data.resetId,
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
  }, [onAdvance, onAnswer, onReset, onStart, player?.id, roomId]);

  const publishAnswer = useCallback(
    async (event: Omit<AnswerEvent, "playerId" | "playerName">) => {
      if (!channel || !player) return;
      await channel.publish("answer", {
        ...event,
        playerId: player.id,
        playerName: player.name,
      } satisfies AnswerEvent);
    },
    [channel, player]
  );

  const publishAdvance = useCallback(
    async (questionIndex: number) => {
      if (!channel || !player || !isHost) return;
      await channel.publish("advance", {
        questionIndex,
        playerName: player.name,
      } satisfies AdvanceEvent);
    },
    [channel, isHost, player]
  );

  const publishReset = useCallback(async () => {
    if (!channel || !player || !isHost) return;
    await channel.publish("reset", {
      resetId: createRoomId(),
      playerName: player.name,
    } satisfies ResetEvent);
  }, [channel, isHost, player]);

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
    async (difficulty: Difficulty, playerIds: string[]) => {
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
    publishAnswer,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function TriviaBattleGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [gameId, setGameId] = useState(() => roomId || createRoomId());
  const [difficulty, setDifficulty] = useState<Difficulty>(getInitialDifficulty);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_SECONDS);
  const [answers, setAnswers] = useState<Record<number, Record<string, AnswerEvent>>>({});
  const [scores, setScores] = useState<Record<string, number>>({});
  const [feed, setFeed] = useState<string[]>([]);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionSource, setQuestionSource] = useState<"ai" | null>(null);
  const [questionRetry, setQuestionRetry] = useState(0);
  const [gateView, setGateView] = useState<GateView>("mode");
  const isMultiplayer = Boolean(roomId);

  const applyAnswer = useCallback((event: AnswerEvent) => {
    setAnswers((current) => {
      const questionAnswers = current[event.questionIndex] || {};
      if (questionAnswers[event.playerId]) return current;
      return {
        ...current,
        [event.questionIndex]: {
          ...questionAnswers,
          [event.playerId]: event,
        },
      };
    });
    if (event.isCorrect) {
      setScores((current) => ({
        ...current,
        [event.playerName]: (current[event.playerName] || 0) + event.points,
      }));
    }
    setFeed((events) => [
      `${event.playerName} answered ${event.isCorrect ? "correctly" : "incorrectly"}${
        event.isCorrect ? ` · +${event.points}` : ""
      }`,
      ...events,
    ].slice(0, 5));
  }, []);

  const applyAdvance = useCallback((event: AdvanceEvent) => {
    setQuestionIndex((current) =>
      event.questionIndex > current ? event.questionIndex : current
    );
    setSecondsLeft(QUESTION_SECONDS);
  }, []);

  const applyReset = useCallback((event: ResetEvent) => {
    setGameId(event.resetId);
    setQuestions([]);
    setQuestionSource(null);
    setQuestionIndex(0);
    setSecondsLeft(QUESTION_SECONDS);
    setAnswers({});
    setScores({});
    setFeed([`${event.playerName} started a new battle`]);
  }, []);

  const applyStart = useCallback((event: StartEvent) => {
    setGameId(event.gameId);
    setDifficulty(event.difficulty);
    setQuestions([]);
    setQuestionSource(null);
    setQuestionIndex(0);
    setSecondsLeft(QUESTION_SECONDS);
    setAnswers({});
    setScores({});
    setFeed(["The battle is live. Choose wisely!"]);
  }, []);

  const {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishAdvance,
    publishAnswer,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useTriviaRoom(roomId, applyAnswer, applyAdvance, applyReset, applyStart);

  useEffect(() => {
    trackGameView("trivia-battle", roomId);
  }, [roomId]);

  useEffect(() => {
    if (roomId && player) trackRoomJoined("trivia-battle", roomId, isHost);
  }, [isHost, player, roomId]);

  const activeBattle = !isMultiplayer
    ? gateView === "playing"
    : Boolean(startEvent);

  useEffect(() => {
    if (!activeBattle) return;
    let cancelled = false;
    setQuestions([]);
    setQuestionError(null);
    setQuestionSource(null);
    fetch("/api/trivia/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: gameId,
        difficulty,
        exclude: getQuestionHistory(),
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: unknown };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Fresh AI questions could not be generated right now."
          );
        }
        return payload;
      })
      .then((payload: unknown) => {
        if (cancelled) return;
        const nextQuestions = normalizeQuestions(payload);
        const source =
          payload && typeof payload === "object"
            ? (payload as { source?: unknown }).source
            : null;
        if (nextQuestions.length !== 10 || source !== "ai") {
          throw new Error("The AI returned an incomplete question set. Please retry.");
        }
        rememberQuestionHistory(nextQuestions);
        setQuestions(nextQuestions);
        setQuestionSource("ai");
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setQuestionError(
            requestError instanceof Error
              ? requestError.message
              : "Fresh AI questions could not be generated right now."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeBattle, difficulty, gameId, questionRetry]);

  const currentQuestion = questions[questionIndex];
  const currentAnswers = answers[questionIndex] || {};
  const isComplete = questions.length > 0 && questionIndex >= questions.length;

  const battlePlayers = useMemo(() => {
    if (!isMultiplayer) {
      return [{ id: "solo", name: "You", ready: true, isHost: true }];
    }
    if (!startEvent) return [];
    return startEvent.playerIds.map((id) =>
      players.find((roomPlayer) => roomPlayer.id === id) || {
        id,
        name: "Player",
        ready: true,
        isHost: false,
      }
    );
  }, [isMultiplayer, players, startEvent]);

  const hasAnswered = useCallback(
    (roomPlayer: Player | null) => Boolean(roomPlayer && currentAnswers[roomPlayer.id]),
    [currentAnswers]
  );

  useEffect(() => {
    if (!activeBattle || !currentQuestion || isComplete) return;
    setSecondsLeft(QUESTION_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeBattle, currentQuestion, isComplete, questionIndex]);

  useEffect(() => {
    if (!currentQuestion || isComplete || secondsLeft !== 0) return;
    if (isMultiplayer) {
      if (isHost) publishAdvance(questionIndex + 1).catch(() => {});
    } else {
      setQuestionIndex((current) => Math.min(current + 1, questions.length));
    }
  }, [currentQuestion, isComplete, isHost, isMultiplayer, publishAdvance, questionIndex, questions.length, secondsLeft]);

  const answeredCount = Object.keys(currentAnswers).length;

  useEffect(() => {
    if (
      !isMultiplayer ||
      !isHost ||
      !currentQuestion ||
      isComplete ||
      battlePlayers.length === 0 ||
      answeredCount < battlePlayers.length
    ) return;

    const timer = setTimeout(() => {
      publishAdvance(questionIndex + 1).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [answeredCount, battlePlayers.length, currentQuestion, isComplete, isHost, isMultiplayer, publishAdvance, questionIndex]);

  const sortedScores = useMemo(() => {
    const rows = new Map<string, { name: string; score: number }>();
    battlePlayers.forEach((roomPlayer) => {
      rows.set(roomPlayer.name, {
        name: roomPlayer.name,
        score: scores[roomPlayer.name] || 0,
      });
    });
    Object.entries(scores).forEach(([name, score]) => {
      if (!rows.has(name)) rows.set(name, { name, score });
    });
    return [...rows.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [battlePlayers, scores]);

  const topScore = sortedScores[0]?.score || 0;
  const winners = sortedScores.filter((row) => row.score === topScore);
  const winnerName = winners[0]?.name || "You";
  const winnerIsYou = !isMultiplayer || winnerName.trim().toLowerCase() === "you";

  useEffect(() => {
    if (!isComplete || (isMultiplayer && !isHost)) return;
    trackGameCompleted("trivia-battle", isMultiplayer ? "multiplayer" : "single", roomId, {
      playerCount: isMultiplayer ? Math.max(battlePlayers.length, 1) : 1,
      difficulty,
      questionsAnswered: questions.length,
      topScore,
      tied: winners.length > 1,
    });
  }, [battlePlayers.length, difficulty, isComplete, isHost, isMultiplayer, questions.length, roomId, topScore, winners.length]);
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
    sessionStorage.setItem(`trivia-battle-room-host:${nextRoomId}`, roomPlayer.id);
    trackRoomCreated("trivia-battle", nextRoomId);
    router.push(`/trivia-battle/room/${nextRoomId}?difficulty=${difficulty}`);
  }, [difficulty, router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleStartSinglePlayer = useCallback(() => {
    trackGameStarted("trivia-battle", "single", undefined, {
      playerCount: 1,
      difficulty,
    });
    setGameId(createRoomId());
    setQuestions([]);
    setQuestionIndex(0);
    setSecondsLeft(QUESTION_SECONDS);
    setAnswers({});
    setScores({});
    setFeed([]);
    setGateView("playing");
  }, [difficulty]);

  const handleAnswer = useCallback(
    (selectedIndex: number) => {
      if (!currentQuestion || isComplete) return;
      const isCorrect = selectedIndex === currentQuestion.correctIndex;
      const points = isCorrect ? 10 + Math.ceil(secondsLeft / 3) : 0;

      if (!isMultiplayer) {
        if (currentAnswers.solo) return;
        applyAnswer({
          questionIndex,
          selectedIndex,
          isCorrect,
          points,
          playerId: "solo",
          playerName: "You",
        });
        return;
      }

      const isActivePlayer = Boolean(
        player && battlePlayers.some((roomPlayer) => roomPlayer.id === player.id)
      );
      if (!player || !isActivePlayer || hasAnswered(player)) return;
      publishAnswer({ questionIndex, selectedIndex, isCorrect, points }).catch(() => {});
    },
    [applyAnswer, battlePlayers, currentAnswers.solo, currentQuestion, hasAnswered, isComplete, isMultiplayer, player, publishAnswer, questionIndex, secondsLeft]
  );

  const handleNext = useCallback(() => {
    if (isMultiplayer) {
      if (isHost) publishAdvance(questionIndex + 1).catch(() => {});
      return;
    }
    setQuestionIndex((current) => Math.min(current + 1, questions.length));
  }, [isHost, isMultiplayer, publishAdvance, questionIndex, questions.length]);

  const handleReset = useCallback(() => {
    if (!isMultiplayer || isHost) {
      trackRematchStarted(
        "trivia-battle",
        isMultiplayer ? "multiplayer" : "single",
        roomId,
        {
          playerCount: isMultiplayer ? Math.max(battlePlayers.length, 1) : 1,
          difficulty,
        },
      );
    }
    if (!isMultiplayer) {
      applyReset({ resetId: createRoomId(), playerName: "You" });
      return;
    }
    if (isHost) publishReset().catch(() => {});
  }, [applyReset, battlePlayers.length, difficulty, isHost, isMultiplayer, publishReset, roomId]);

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
  const handleStartRoomGame = useCallback(async () => {
    await startRoomGame(difficulty, lobbyPlayers.map((roomPlayer) => roomPlayer.id));
    trackGameStarted("trivia-battle", "multiplayer", roomId, {
      playerCount: lobbyPlayers.length,
      difficulty,
    });
  }, [difficulty, lobbyPlayers, roomId, startRoomGame]);
  const waitingMessage =
    lobbyPlayers.length < 2
      ? "Invite at least one more player to continue."
      : everybodyReady
        ? "Everyone is ready. Let the battle begin!"
        : "The battle unlocks when everyone is ready.";

  const gateNavigation = (
    <header className={ui.gateNav}>
      <Link href="/" aria-label="Guidde games home" className={ui.gateLogoLink}>
        <Image
          src="/guidde3.svg"
          alt="Guidde"
          width={230}
          height={79}
          className={ui.gateLogo}
          priority
        />
      </Link>
      <Link href="/" className={ui.menuLink}>
        <span aria-hidden="true"><ArrowIcon direction="left" /></span> Back to menu
      </Link>
    </header>
  );

  const difficultyPicker = (
    <div className={ui.difficultyPicker} role="group" aria-label="Choose difficulty">
      {difficulties.map((option) => (
        <button
          key={option.value}
          type="button"
          className={difficulty === option.value ? ui.difficultyActive : undefined}
          onClick={() => setDifficulty(option.value)}
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );

  if (!isMultiplayer && gateView === "mode") {
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.modeGate}>
          <div className={ui.gateHeading}>
            <p className={ui.kicker}>Trivia Battle</p>
            <h1>How well do you know the Word?</h1>
            <p>
              Race the clock, trust your Bible knowledge, and climb the
              leaderboard on your own or with friends.
            </p>
          </div>

          <div className={ui.modeChoices}>
            <button
              type="button"
              className={`${ui.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={ui.choiceNumber}>01</span>
              <span className={ui.choiceQuiz} aria-hidden="true">
                <span>A</span><span>B</span><span>C</span><span>D</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Single player</strong>
                <small>Test yourself through a ten-question battle.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true"><ArrowIcon direction="up-right" /></span>
            </button>

            <button
              type="button"
              className={`${ui.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={ui.choiceNumber}>02</span>
              <span className={`${ui.choiceQuiz} ${ui.choiceQuizMulti}`} aria-hidden="true">
                <span>1</span><span>2</span><span>3</span><span>+</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Answer together and race for the highest score.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true"><ArrowIcon direction="up-right" /></span>
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
          <button type="button" className={ui.stepBack} onClick={() => setGateView("mode")}>
            <ArrowIcon direction="left" /> Change game mode
          </button>

          <section className={`${ui.setupCard} ${isSingleSetup ? ui.singleSetup : ui.multiplayerSetup}`}>
            <div className={ui.setupCopy}>
              <p className={ui.kicker}>{isSingleSetup ? "Single player" : "Multiplayer"}</p>
              <h1>{isSingleSetup ? "Choose your challenge." : "Gather your contenders."}</h1>
              <p>
                {isSingleSetup
                  ? "Pick a difficulty, then score as many points as you can before each timer runs out."
                  : "Choose the difficulty, create a room or join with a four-digit code, then begin when everyone is ready."}
              </p>
              {difficultyPicker}
              <div className={ui.setupDetails}>
                <span><strong>10</strong> questions</span>
                <span><strong>15s</strong> each</span>
                <span><strong>Speed</strong> bonus</span>
              </div>
              <button
                type="button"
                className={ui.primaryAction}
                onClick={isSingleSetup ? handleStartSinglePlayer : handleCreateRoom}
              >
                {isSingleSetup ? "Start battle" : "Create room"}
                <span aria-hidden="true"><ArrowIcon /></span>
              </button>
              {!isSingleSetup && <RoomJoinForm gamePath="/trivia-battle" />}
            </div>

            <div className={ui.setupQuestion} aria-hidden="true">
              <span className={ui.setupTimer}>15</span>
              <p>Who built the ark?</p>
              <div><span>A</span> Moses</div>
              <div className={ui.setupCorrect}><span>B</span> Noah</div>
              <div><span>C</span> David</div>
              <div><span>D</span> Paul</div>
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
    const roomDifficulty = difficulties.find((option) => option.value === difficulty)?.label;
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.waitingGate}>
          <section className={ui.waitingIntro}>
            <div>
              <p className={ui.kicker}>Room {roomId?.toUpperCase()}</p>
              <h1>Waiting for roommates.</h1>
              <p>
                Share the invite, choose your player name, and let everyone
                mark themselves ready before the first question appears.
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

            <div className={ui.battleRule}>
              <span>Battle difficulty</span>
              <strong>{isHost ? roomDifficulty : "Set by host"}</strong>
              <small>10 questions · 15 seconds each</small>
            </div>

            <div className={ui.connectionLine} role="status">
              <span className={`${ui.connectionDot} ${connectionLabel === "Live" ? ui.connectionLive : ""}`} />
              {connectionLabel === "Live"
                ? "Room is live"
                : connectionLabel === "Offline"
                  ? "Room is offline"
                  : "Connecting to room"}
            </div>
          </section>

          <section className={ui.rosterCard}>
            <div className={ui.rosterHeader}>
              <div><span>Players</span><strong>{lobbyPlayers.length}</strong></div>
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
              {lobbyPlayers.map((roomPlayer) => (
                <div className={ui.playerRow} key={roomPlayer.id}>
                  <span className={ui.playerAvatar} aria-hidden="true">
                    {roomPlayer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={ui.playerIdentity}>
                    <strong>{roomPlayer.id === player?.id ? "You" : roomPlayer.name}</strong>
                    <small>{roomPlayer.isHost ? "Host" : "Player"}</small>
                  </span>
                  <span className={`${ui.playerStatus} ${roomPlayer.ready ? ui.playerReady : ""}`}>
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
                onClick={() => void handleStartRoomGame()}
                disabled={!everybodyReady}
              >
                Start battle <span aria-hidden="true"><ArrowIcon /></span>
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

  const playerAnswered = isMultiplayer
    ? hasAnswered(player)
    : Boolean(currentAnswers.solo);
  const isActivePlayer = !isMultiplayer || Boolean(
    player && battlePlayers.some((roomPlayer) => roomPlayer.id === player.id)
  );
  const canShowAnswer = secondsLeft === 0 || playerAnswered;
  const answerLocked = playerAnswered || !isActivePlayer || isComplete;
  const timerProgress = Math.max(0, Math.min(100, (secondsLeft / QUESTION_SECONDS) * 100));

  return (
    <main className={ui.playPage}>
      <header className={ui.gameHeader}>
        <div className={ui.gameHeaderLead}>
          <Link href="/" className={ui.gameMenuLink}>
            <span aria-hidden="true"><ArrowIcon direction="left" /></span> Menu
          </Link>
          <div>
            <p className={ui.gameEyebrow}>
              Trivia Battle · {difficulty[0].toUpperCase() + difficulty.slice(1)}
            </p>
            <h1>
              {isComplete
                ? "Final scores"
                : currentQuestion
                  ? `Question ${questionIndex + 1} of ${questions.length}`
                  : "Preparing questions"}
            </h1>
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
            <button type="button" className={ui.newBattleAction} onClick={handleReset}>
              New battle
            </button>
          )}
        </div>
      </header>

      <div className={ui.questionProgress} aria-hidden="true">
        <span style={{ width: questions.length ? `${Math.min(100, ((questionIndex + 1) / questions.length) * 100)}%` : "0%" }} />
      </div>

      {error && <div className={ui.gameError}>{error}</div>}
      {questionError && currentQuestion && <div className={ui.gameNotice}>{questionError}</div>}

      <section className={ui.gameArea}>
        <div className={ui.questionPanel}>
          {currentQuestion ? (
            <>
              <div className={ui.timerRow}>
                <div className={ui.timer} style={{ "--timer-progress": `${timerProgress * 3.6}deg` } as React.CSSProperties}>
                  <span>{secondsLeft}</span>
                  <small>sec</small>
                </div>
                <div className={ui.questionMeta}>
                  <span>{questionSource === "ai" ? "Fresh AI question set" : "Speed bonus active"}</span>
                  <strong>+10 base points</strong>
                </div>
              </div>

              <h2 className={ui.question}>{currentQuestion.question}</h2>

              <div className={ui.options}>
                {currentQuestion.options.map((option, index) => {
                  const isCorrect = index === currentQuestion.correctIndex;
                  const myAnswer = isMultiplayer
                    ? player && currentAnswers[player.id]
                    : currentAnswers.solo;
                  const pickedByMe = myAnswer?.selectedIndex === index;
                  return (
                    <button
                      key={`${option}-${index}`}
                      type="button"
                      className={`${ui.option} ${
                        canShowAnswer && isCorrect ? ui.optionCorrect : ""
                      } ${pickedByMe && !isCorrect ? ui.optionWrong : ""}`}
                      onClick={() => handleAnswer(index)}
                      disabled={answerLocked}
                    >
                      <span>{ANSWER_LABELS[index]}</span>
                      <strong>{option}</strong>
                      {pickedByMe && <small>{isCorrect ? "Correct" : "Your answer"}</small>}
                    </button>
                  );
                })}
              </div>

              <div className={ui.questionFooter}>
                <span>{canShowAnswer ? currentQuestion.reference : "Choose one answer"}</span>
                {!isMultiplayer && playerAnswered && (
                  <button type="button" onClick={handleNext}>
                    Next question <span aria-hidden="true"><ArrowIcon /></span>
                  </button>
                )}
                {isMultiplayer && isHost && playerAnswered && answeredCount < battlePlayers.length && (
                  <button type="button" onClick={handleNext}>
                    Continue <span aria-hidden="true"><ArrowIcon /></span>
                  </button>
                )}
                {isMultiplayer && playerAnswered && !isHost && (
                  <small>Waiting for the remaining answers…</small>
                )}
              </div>
            </>
          ) : (
            <div className={ui.loadingQuestions}>
              <span aria-hidden="true">?</span>
              <h2>
                {questionError
                  ? "Fresh questions couldn’t be generated"
                  : "Preparing your AI question set"}
              </h2>
              <p>
                {questionError || "Creating and checking a new Bible trivia mix…"}
              </p>
              {questionError && (
                <button
                  type="button"
                  className={ui.retryGeneration}
                  onClick={() => setQuestionRetry((current) => current + 1)}
                >
                  Try again <span aria-hidden="true"><ArrowIcon /></span>
                </button>
              )}
            </div>
          )}
        </div>

        <aside className={ui.sidePanel}>
          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Leaderboard</h2>
              <span>{battlePlayers.length} player{battlePlayers.length === 1 ? "" : "s"}</span>
            </div>
            <div className={ui.scoreRows}>
              {sortedScores.map((row, index) => (
                <div className={`${ui.scoreRow} ${index === 0 ? ui.scoreLeader : ""}`} key={row.name}>
                  <span className={ui.rank}>{index + 1}</span>
                  <span className={ui.scoreIdentity}>
                    <strong>{row.name}</strong>
                    <small>{index === 0 ? "Leading" : "In the race"}</small>
                  </span>
                  <strong className={ui.score}>{row.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className={ui.panel}>
            <div className={ui.panelHeading}>
              <h2>Battle feed</h2>
              <span>Live</span>
            </div>
            {feed.length === 0 ? (
              <p className={ui.emptyFeed}>The first answer will appear here.</p>
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
          <div className={ui.modal}>
            <p>Battle complete</p>
            <span className={ui.trophy} aria-hidden="true">✦</span>
            <h2>
              {winners.length > 1
                ? "A close draw!"
                : winnerIsYou
                  ? "You win!"
                  : `${winnerName} wins!`}
            </h2>
            <p className={ui.modalSummary}>
              {winners.length > 1
                ? `${winners.map((winner) => winner.name).join(" and ")} finish level on ${topScore} points.`
                : winnerIsYou
                  ? `You finish on top with ${topScore} points.`
                  : `${winnerName} finishes on top with ${topScore} points.`}
            </p>
            {isMultiplayer ? (
              <FinalStandings
                rows={sortedScores.map((row) => ({
                  id: row.name,
                  name: row.name,
                  score: row.score,
                }))}
                currentPlayerId={player?.name}
              />
            ) : null}
            <div className={ui.modalActions}>
              {(!isMultiplayer || isHost) ? (
                <button type="button" className={ui.primaryModalAction} onClick={handleReset}>
                  Play again
                </button>
              ) : (
                <span className={ui.hostReplayMessage}>Waiting for the host to start another battle.</span>
              )}
              <Link href="/" className={ui.secondaryModalAction}>Back to menu</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

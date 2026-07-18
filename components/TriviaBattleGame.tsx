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

const QUESTION_SECONDS = 15;
const difficulties: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

const clientFallbackQuestions: TriviaQuestion[] = [
  {
    question: "Who said, \"Here am I; send me\"?",
    options: ["Isaiah", "Jeremiah", "Samuel", "Ezekiel"],
    correctIndex: 0,
    reference: "Isaiah 6:8",
  },
  {
    question: "Fill in the gap: \"The Lord is my ______; I shall not want.\"",
    options: ["shield", "shepherd", "light", "song"],
    correctIndex: 1,
    reference: "Psalm 23:1",
  },
  {
    question: "Which event happened at Pentecost?",
    options: ["The Spirit came on the believers", "The temple was rebuilt", "Paul was shipwrecked", "Jericho's walls fell"],
    correctIndex: 0,
    reference: "Acts 2",
  },
  {
    question: "Who interpreted Pharaoh's dreams in Egypt?",
    options: ["Joseph", "Daniel", "Samuel", "Isaiah"],
    correctIndex: 0,
    reference: "Genesis 41",
  },
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

function normalizeDifficulty(value: string | null): Difficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

function getInitialDifficulty(): Difficulty {
  if (typeof window === "undefined") return "normal";
  return normalizeDifficulty(new URLSearchParams(window.location.search).get("difficulty"));
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

function useTriviaRoom(
  roomId: string | undefined,
  onAnswer: (event: AnswerEvent) => void,
  onAdvance: (event: AdvanceEvent) => void,
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
    const roomChannel = client.channels.get(`trivia-battle:${roomId}`, {
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

    const handleAnswer = (message: Ably.Types.Message) => {
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
    };
    const handleAdvance = (message: Ably.Types.Message) => {
      const data = message.data as Partial<AdvanceEvent>;
      if (typeof data.questionIndex === "number") {
        onAdvance({
          questionIndex: data.questionIndex,
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
      .subscribe("answer", handleAnswer)
      .then(() => roomChannel.subscribe("advance", handleAdvance))
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
        if (mounted) setError(err instanceof Error ? err.message : "Could not join room");
      });

    return () => {
      mounted = false;
      roomChannel.unsubscribe("answer", handleAnswer);
      roomChannel.unsubscribe("advance", handleAdvance);
      roomChannel.unsubscribe("reset", handleReset);
      roomChannel.presence.unsubscribe(refreshPresence);
      roomChannel.presence.leave().catch(() => {});
      client.close();
    };
  }, [onAdvance, onAnswer, onReset, player?.id, roomId]);

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
      if (!channel || !player) return;
      await channel.publish("advance", {
        questionIndex,
        playerName: player.name,
      } satisfies AdvanceEvent);
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
    publishAdvance,
    publishAnswer,
    publishReset,
    updatePlayerName,
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
  const isMultiplayer = Boolean(roomId);

  const currentQuestion = questions[questionIndex];
  const currentAnswers = answers[questionIndex] || {};
  const isComplete = questions.length > 0 && questionIndex >= questions.length;
  const hasAnswered = (player: Player | null) =>
    Boolean(player && currentAnswers[player.id]);

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
      `${event.playerName} answered ${event.isCorrect ? "correctly" : "wrong"}${event.isCorrect ? ` +${event.points}` : ""}`,
      ...events,
    ].slice(0, 5));
  }, []);

  const applyAdvance = useCallback((event: AdvanceEvent) => {
    setQuestionIndex((current) =>
      event.questionIndex > current ? Math.min(event.questionIndex, questions.length) : current
    );
    setSecondsLeft(QUESTION_SECONDS);
  }, [questions.length]);

  const applyReset = useCallback((event: ResetEvent) => {
    setGameId(event.resetId);
    setQuestions([]);
    setQuestionIndex(0);
    setSecondsLeft(QUESTION_SECONDS);
    setAnswers({});
    setScores({});
    setFeed([`${event.playerName} started a new battle`]);
  }, []);

  const {
    connectionState,
    error,
    player,
    players,
    publishAdvance,
    publishAnswer,
    publishReset,
    updatePlayerName,
  } = useTriviaRoom(roomId, applyAnswer, applyAdvance, applyReset);

  useEffect(() => {
    let cancelled = false;
    setQuestions([]);
    setQuestionError(null);
    fetch(`/api/trivia/questions?roomId=${encodeURIComponent(gameId)}&difficulty=${difficulty}`)
      .then((response) => response.json())
      .then((payload: unknown) => {
        if (cancelled) return;
        const nextQuestions = normalizeQuestions(payload);
        if (nextQuestions.length > 0) {
          setQuestions(nextQuestions);
          return;
        }
        setQuestionError("Question response was empty, so fallback questions loaded.");
        setQuestions(clientFallbackQuestions);
      })
      .catch(() => {
        if (!cancelled) {
          setQuestionError("Could not load generated questions, so fallback questions loaded.");
          setQuestions(clientFallbackQuestions);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, gameId]);

  useEffect(() => {
    if (!currentQuestion || isComplete) return;
    setSecondsLeft(QUESTION_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentQuestion, isComplete, questionIndex]);

  useEffect(() => {
    if (!currentQuestion || isComplete || secondsLeft !== 0) return;
    if (isMultiplayer) {
      publishAdvance(questionIndex + 1).catch(() => {});
    } else {
      setQuestionIndex((current) => Math.min(current + 1, questions.length));
    }
  }, [currentQuestion, isComplete, isMultiplayer, publishAdvance, questionIndex, questions.length, secondsLeft]);

  const sortedScores = useMemo(() => {
    const rows = new Map<string, { name: string; score: number }>();
    players.forEach((roomPlayer) => {
      rows.set(roomPlayer.name, { name: roomPlayer.name, score: scores[roomPlayer.name] || 0 });
    });
    Object.entries(scores).forEach(([name, score]) => {
      if (!rows.has(name)) rows.set(name, { name, score });
    });
    if (!isMultiplayer && rows.size === 0) rows.set("You", { name: "You", score: scores.You || 0 });
    return [...rows.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [isMultiplayer, players, scores]);

  const connectionLabel = !isMultiplayer
    ? null
    : error
      ? "Offline"
      : connectionState === "connected"
        ? "Live"
        : "Connecting";

  const handleCreateRoom = useCallback(() => {
    router.push(`/trivia-battle/room/${createRoomId()}?difficulty=${difficulty}`);
  }, [difficulty, router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleAnswer = useCallback(
    (selectedIndex: number) => {
      if (!currentQuestion || isComplete) return;

      const isCorrect = selectedIndex === currentQuestion.correctIndex;
      const points = isCorrect ? 10 + Math.ceil(secondsLeft / 3) : 0;

      if (!isMultiplayer) {
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

      if (!player || hasAnswered(player)) return;
      publishAnswer({ questionIndex, selectedIndex, isCorrect, points }).catch(() => {});
    },
    [applyAnswer, currentQuestion, isComplete, isMultiplayer, player, publishAnswer, questionIndex, secondsLeft]
  );

  const handleNext = useCallback(() => {
    if (isMultiplayer) {
      publishAdvance(questionIndex + 1).catch(() => {});
      return;
    }
    setQuestionIndex((current) => Math.min(current + 1, questions.length));
  }, [isMultiplayer, publishAdvance, questionIndex, questions.length]);

  const handleReset = useCallback(() => {
    if (!isMultiplayer) {
      applyReset({ resetId: createRoomId(), playerName: "You" });
      return;
    }
    publishReset().catch(() => {});
  }, [applyReset, isMultiplayer, publishReset]);

  const handleBackToMenu = useCallback(() => {
    router.push("/");
  }, [router]);

  const answeredCount = Object.keys(currentAnswers).length;
  const canShowAnswer = secondsLeft === 0 || answeredCount > 0;

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Trivia Battle</p>
          <h1 style={styles.title}>
            {isComplete ? "Final Scores" : currentQuestion ? `Question ${questionIndex + 1}/${questions.length}` : "Loading questions"}
          </h1>
        </div>
        <div style={styles.headerRight}>
          {connectionLabel && (
            <span style={{ ...styles.statusBadge, ...(connectionLabel === "Live" ? styles.statusLive : {}) }}>
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
            New Battle
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
      {questionError && <div style={styles.error}>{questionError}</div>}

      <section style={styles.settingsPanel}>
        <div>
          <strong>Difficulty</strong>
          <p style={styles.muted}>
            {isMultiplayer ? "Locked for this battle room" : "Choose how deep the questions should go"}
          </p>
        </div>
        <div style={styles.segmented}>
          {difficulties.map((option) => (
            <button
              key={option.value}
              onClick={() => setDifficulty(option.value)}
              disabled={isMultiplayer}
              style={{
                ...styles.segment,
                ...(difficulty === option.value ? styles.segmentActive : {}),
                ...(isMultiplayer ? styles.segmentDisabled : {}),
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section style={styles.gameArea}>
        <div style={styles.questionPanel}>
          {currentQuestion ? (
            <>
              <div style={styles.timerRow}>
                <span style={styles.timer}>{secondsLeft}s</span>
                <span style={styles.muted}>
                  {difficulty[0].toUpperCase() + difficulty.slice(1)} · Correct: +10 plus speed bonus
                </span>
              </div>
              <h2 style={styles.question}>{currentQuestion.question}</h2>
              <div style={styles.options}>
                {currentQuestion.options.map((option, index) => {
                  const isCorrect = index === currentQuestion.correctIndex;
                  const pickedByMe = player
                    ? currentAnswers[player.id]?.selectedIndex === index
                    : currentAnswers.solo?.selectedIndex === index;
                  return (
                    <button
                      key={option}
                      onClick={() => handleAnswer(index)}
                      style={{
                        ...styles.option,
                        ...(canShowAnswer && isCorrect ? styles.optionCorrect : {}),
                        ...(pickedByMe && !isCorrect ? styles.optionWrong : {}),
                      }}
                      disabled={isMultiplayer ? Boolean(player && hasAnswered(player)) : Boolean(currentAnswers.solo)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              <div style={styles.questionFooter}>
                <span style={styles.muted}>{currentQuestion.reference}</span>
                <button onClick={handleNext} style={styles.secondaryBtn}>
                  Next
                </button>
              </div>
            </>
          ) : (
            <p style={styles.muted}>Preparing Bible questions...</p>
          )}
        </div>

        <aside style={styles.sidePanel}>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Leaderboard</h2>
            <div style={styles.scoreRows}>
              {sortedScores.map((row, index) => (
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
              <p style={styles.muted}>Waiting for the first answer</p>
            ) : (
              <div style={styles.feed}>
                {feed.map((event, index) => (
                  <p key={`${event}-${index}`} style={styles.feedItem}>{event}</p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>

      {isComplete && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalEyebrow}>Battle Complete</p>
            <h2 style={styles.modalTitle}>
              {sortedScores[0] ? `${sortedScores[0].name} wins` : "Final Scores"}
            </h2>
            <div style={styles.modalActions}>
              <button onClick={handleReset} style={styles.primaryBtn}>
                Play Again
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
  settingsPanel: {
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
  segmented: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(78px, 1fr))",
    gap: "6px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  segment: {
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: "34px",
    padding: "0 10px",
    borderRadius: "6px",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "0.84rem",
    fontWeight: 900,
    cursor: "pointer",
  },
  segmentActive: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  segmentDisabled: {
    cursor: "not-allowed",
    opacity: 0.82,
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
  questionPanel: {
    flex: "1 1 520px",
    maxWidth: "640px",
    minHeight: "430px",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
  },
  timerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "18px",
  },
  timer: {
    minWidth: "54px",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontWeight: 900,
    textAlign: "center",
  },
  question: {
    minHeight: "96px",
    fontSize: "clamp(1.3rem, 4vw, 2rem)",
    lineHeight: 1.15,
    fontWeight: 900,
    marginBottom: "18px",
  },
  options: {
    display: "grid",
    gap: "10px",
  },
  option: {
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: "54px",
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font-jost), sans-serif",
    fontSize: "1rem",
    fontWeight: 800,
    textAlign: "left",
    cursor: "pointer",
  },
  optionCorrect: {
    background: "#dff8e8",
    borderColor: "#a8e7bd",
    color: "#176b35",
  },
  optionWrong: {
    background: "#fff1f0",
    borderColor: "#f2b8b5",
    color: "#8c1d18",
  },
  questionFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginTop: "16px",
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

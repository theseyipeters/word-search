"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
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
import { RoomJoinForm } from "./RoomJoinForm";
import ui from "./MemoryMatchGame.module.css";

type Player = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
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
type StartEvent = {
  seed: string;
  playerIds: string[];
};
type GameState = {
  flipped: number[];
  matched: number[];
  matchedBy: Record<number, string>;
  scores: Record<string, number>;
  locked: boolean;
  currentTurnId: string | null;
};
type GateView = "mode" | "single-setup" | "multiplayer-setup" | "playing";

const PAIRS_PER_GAME = 8;
const CARD_VALUES = [
  "FAITH", "GRACE", "HOPE", "PEACE", "TRUTH", "MERCY", "LIGHT", "JOY",
  "LOVE", "WISDOM", "PRAYER", "GOSPEL", "PROMISE", "GLORY", "PRAISE",
  "BLESSED", "COVENANT", "SPIRIT", "KINGDOM", "SERVANT", "MIRACLE",
  "VICTORY", "COURAGE", "KINDNESS", "PATIENCE", "TEMPLE", "PSALMS",
  "EXODUS", "GENESIS", "JORDAN", "EDEN", "CANAAN", "SAMUEL", "ESTHER",
  "DAVID", "MOSES", "SARAH", "RUTH", "NOAH", "PAUL",
];

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
  const values = [...CARD_VALUES];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }

  const cards = values.slice(0, PAIRS_PER_GAME).flatMap((value, index) => [
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
  const existingId = sessionStorage.getItem("memory-match-player-id");
  const existingName = localStorage.getItem("games-player-name");

  if (existingId && existingName) {
    return { id: existingId, name: existingName, ready: false, isHost: false };
  }

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const name = existingName || `Player ${Math.floor(1000 + Math.random() * 9000)}`;

  sessionStorage.setItem("memory-match-player-id", id);
  localStorage.setItem("games-player-name", name);
  return { id, name, ready: false, isHost: false };
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
      sessionStorage.getItem(`memory-match-room-host:${roomId}`) === roomPlayer.id;
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
    const roomChannel = client.channels.get(`memory-match:${roomId}`, {
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
          typeof data.seed === "string" &&
          Array.isArray(data.playerIds) &&
          data.playerIds.every((id) => typeof id === "string")
        ) {
          const start = data as StartEvent;
          setStartEvent(start);
          onStart(start);
        }
        return;
      }

      if (message.name === "flip") {
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
  }, [onFlip, onReset, onStart, player?.id, roomId]);

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
        seed: createRoomId(),
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
    publishFlip,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  };
}

export function MemoryMatchGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [deckSeed, setDeckSeed] = useState(() => roomId || createRoomId());
  const [state, setState] = useState<GameState>(() => emptyGameState());
  const [feed, setFeed] = useState<string[]>([]);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [gateView, setGateView] = useState<GateView>("mode");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<GameState>(emptyGameState());
  const isMultiplayer = Boolean(roomId);

  const deck = useMemo(() => createDeck(deckSeed), [deckSeed]);
  const deckRef = useRef<Card[]>(deck);
  const turnPlayersRef = useRef<Player[]>([]);

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyReset = useCallback((event: ResetEvent) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    const nextState = emptyGameState();
    deckRef.current = createDeck(event.resetId);
    setDeckSeed(event.resetId);
    stateRef.current = nextState;
    setState(nextState);
    setFeed((events) => [`${event.playerName} started a new match`, ...events].slice(0, 5));
  }, []);

  const applyStart = useCallback((event: StartEvent) => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    const nextState = emptyGameState();
    turnPlayersRef.current = event.playerIds.map((id) => ({
      id,
      name: "Player",
      ready: true,
      isHost: false,
    }));
    deckRef.current = createDeck(event.seed);
    setDeckSeed(event.seed);
    stateRef.current = nextState;
    setState(nextState);
    setFeed(["The room is ready. Find the first pair!"]);
  }, []);

  const applyFlip = useCallback(
    (event: FlipEvent) => {
      const current = stateRef.current;
      const currentDeck = deckRef.current;
      const turnPlayers = turnPlayersRef.current;
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
        const isMatch = currentDeck[firstId]?.value === currentDeck[secondId]?.value;

        if (isMatch) {
          feedText = `${event.playerName} matched ${currentDeck[firstId].value}`;
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
              turnPlayersRef.current
            ),
          };
          stateRef.current = nextState;
          setState(nextState);
        }, 850);
      }
    },
    []
  );

  const {
    connectionState,
    error,
    isHost,
    player,
    players,
    publishFlip,
    publishReset,
    startEvent,
    startRoomGame,
    updatePlayerName,
    updateReady,
  } = useMemoryRoom(roomId, applyFlip, applyReset, applyStart);

  useEffect(() => {
    trackGameView("memory-match", roomId);
  }, [roomId]);

  useEffect(() => {
    if (roomId && player) trackRoomJoined("memory-match", roomId, isHost);
  }, [isHost, player, roomId]);

  const localPlayers = useMemo(
    () => [
      { id: "local-1", name: "You", ready: true, isHost: true },
    ],
    []
  );
  const turnPlayers = useMemo(() => {
    if (!isMultiplayer) return localPlayers;
    if (!startEvent) return [];
    return startEvent.playerIds
      .map((id) => players.find((roomPlayer) => roomPlayer.id === id))
      .filter((roomPlayer): roomPlayer is Player => Boolean(roomPlayer));
  }, [isMultiplayer, localPlayers, players, startEvent]);

  useEffect(() => {
    turnPlayersRef.current = turnPlayers;
  }, [turnPlayers]);

  useEffect(() => {
    if (
      turnPlayers.length === 0 ||
      (state.currentTurnId &&
        turnPlayers.some((roomPlayer) => roomPlayer.id === state.currentTurnId))
    ) return;
    setState((current) => {
      if (
        current.currentTurnId &&
        turnPlayers.some((roomPlayer) => roomPlayer.id === current.currentTurnId)
      ) return current;
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
  const topScore = scoreRows[0]?.score || 0;
  const winningNames = scoreRows
    .filter((row) => row.score === topScore)
    .map((row) => row.name);

  useEffect(() => {
    if (!isComplete || (isMultiplayer && !isHost)) return;
    trackGameCompleted("memory-match", isMultiplayer ? "multiplayer" : "single", roomId, {
      playerCount: isMultiplayer ? Math.max(turnPlayers.length, 1) : 1,
      pairsFound: state.matched.length / 2,
      topScore,
      tied: winningNames.length > 1,
    });
  }, [isComplete, isHost, isMultiplayer, roomId, state.matched.length, topScore, turnPlayers.length, winningNames.length]);
  const myTurn = !isMultiplayer || (player && state.currentTurnId === player.id);
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
    sessionStorage.setItem(`memory-match-room-host:${nextRoomId}`, roomPlayer.id);
    trackRoomCreated("memory-match", nextRoomId);
    router.push(`/memory-match/room/${nextRoomId}`);
  }, [router]);

  const handleCopyInvite = useCallback(async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  }, []);

  const handleStartSinglePlayer = useCallback(() => {
    trackGameStarted("memory-match", "single", undefined, { playerCount: 1 });
    const seed = createRoomId();
    const nextState = emptyGameState();
    deckRef.current = createDeck(seed);
    setDeckSeed(seed);
    stateRef.current = nextState;
    setState(nextState);
    setFeed([]);
    setGateView("playing");
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
    if (!isMultiplayer || isHost) {
      trackRematchStarted(
        "memory-match",
        isMultiplayer ? "multiplayer" : "single",
        roomId,
        { playerCount: isMultiplayer ? Math.max(players.length, 1) : 1 },
      );
    }
    if (!isMultiplayer) {
      applyReset({ resetId: createRoomId(), playerName: "You" });
      setFeed([]);
      return;
    }
    publishReset().catch(() => {});
  }, [applyReset, isHost, isMultiplayer, players.length, publishReset, roomId]);

  const handleBackToMenu = useCallback(() => {
    router.push("/");
  }, [router]);

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
    await startRoomGame(lobbyPlayers.map((roomPlayer) => roomPlayer.id));
    trackGameStarted("memory-match", "multiplayer", roomId, {
      playerCount: lobbyPlayers.length,
    });
  }, [lobbyPlayers, roomId, startRoomGame]);
  const waitingMessage =
    lobbyPlayers.length < 2
      ? "Invite at least one more player to continue."
      : everybodyReady
        ? "Everyone is ready. Start matching!"
        : "The game unlocks when everyone is ready.";

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

  if (!isMultiplayer && gateView === "mode") {
    return (
      <div className={ui.gatePage}>
        {gateNavigation}
        <main className={ui.modeGate}>
          <div className={ui.gateHeading}>
            <p className={ui.kicker}>Memory Match</p>
            <h1>How sharp is your memory?</h1>
            <p>
              Find every hidden pair by yourself or take turns with friends in
              a shared room.
            </p>
          </div>

          <div className={ui.modeChoices}>
            <button
              type="button"
              className={`${ui.modeChoice} ${ui.singleChoice}`}
              onClick={() => setGateView("single-setup")}
            >
              <span className={ui.choiceNumber}>01</span>
              <span className={ui.choiceCards} aria-hidden="true">
                <span>JOY</span><span>?</span><span>?</span><span>JOY</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Single player</strong>
                <small>Find all eight pairs at your own pace.</small>
              </span>
              <span className={ui.choiceArrow} aria-hidden="true"><ArrowIcon direction="up-right" /></span>
            </button>

            <button
              type="button"
              className={`${ui.modeChoice} ${ui.multiChoice}`}
              onClick={() => setGateView("multiplayer-setup")}
            >
              <span className={ui.choiceNumber}>02</span>
              <span className={ui.choiceCards} aria-hidden="true">
                <span>?</span><span>HOPE</span><span>HOPE</span><span>?</span>
              </span>
              <span className={ui.choiceCopy}>
                <strong>Multiplayer</strong>
                <small>Take turns and compete for the most pairs.</small>
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
          <button
            type="button"
            className={ui.stepBack}
            onClick={() => setGateView("mode")}
          >
            <ArrowIcon direction="left" /> Change game mode
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
              <h1>{isSingleSetup ? "Ready to remember?" : "Match up together."}</h1>
              <p>
                {isSingleSetup
                  ? "Every game draws eight new pairs from a growing collection of Bible-themed words."
                  : "Create a private room or join with a four-digit code, then begin when every player is ready."}
              </p>
              <div className={ui.setupDetails}>
                <span><strong>8</strong> random pairs</span>
                <span><strong>40</strong> possible words</span>
                <span><strong>{isSingleSetup ? "Solo" : "Live"}</strong> play</span>
              </div>
              <button
                type="button"
                className={ui.primaryAction}
                onClick={isSingleSetup ? handleStartSinglePlayer : handleCreateRoom}
              >
                {isSingleSetup ? "Start game" : "Create room"}
                <span aria-hidden="true"><ArrowIcon /></span>
              </button>
              {!isSingleSetup && <RoomJoinForm gamePath="/memory-match" />}
            </div>

            <div className={ui.setupBoard} aria-hidden="true">
              {[
                "?", "GRACE", "?", "LIGHT",
                "PEACE", "?", "?", "GRACE",
                "?", "PEACE", "LIGHT", "?",
                "?", "?", "?", "?",
              ].map((value, index) => (
                <span key={index} className={value !== "?" ? ui.revealedCard : undefined}>
                  {value}
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

  if (isMultiplayer && !startEvent) {
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
                themselves ready before the cards are dealt.
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
                onClick={() => void handleStartRoomGame()}
                disabled={!everybodyReady}
              >
                Start game <span aria-hidden="true"><ArrowIcon /></span>
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
            <span aria-hidden="true"><ArrowIcon direction="left" /></span> Menu
          </Link>
          <div>
            <p style={styles.eyebrow}>
              Memory Match · {state.matched.length / 2}/{PAIRS_PER_GAME} pairs
            </p>
            <h1 style={styles.title}>
              {isComplete ? "All pairs found" : `${currentPlayer?.name || "Player"}'s turn`}
            </h1>
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
          <button onClick={handleReset} style={styles.primaryBtn}>
            New deck
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
        <div style={styles.board}>
          {deck.map((card) => {
            const isVisible = state.flipped.includes(card.id) || state.matched.includes(card.id);
            const isMatched = state.matched.includes(card.id);
            return (
              <button
                key={card.id}
                onClick={() => handleCardClick(card.id)}
                className={`${ui.memoryCard} ${isVisible ? ui.cardIsVisible : ""} ${
                  isMatched ? ui.cardIsMatched : ""
                }`}
                disabled={
                  state.locked ||
                  isMatched ||
                  state.flipped.includes(card.id) ||
                  isComplete ||
                  (isMultiplayer && !myTurn)
                }
                aria-label={isVisible ? `${card.value} card` : "Hidden card"}
              >
                <span className={ui.cardInner}>
                  <span className={ui.cardBack} aria-hidden="true">?</span>
                  <span className={ui.cardFront}>{card.value}</span>
                </span>
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
            <p style={styles.modalWinner}>
              {winningNames.length > 1
                ? `${winningNames.join(" and ")} tied with ${topScore} pairs each.`
                : `${winningNames[0] || "You"} found the most pairs with ${topScore} pair${topScore === 1 ? "" : "s"}.`}
            </p>
            <div style={styles.modalActions}>
              <button onClick={handleReset} style={styles.primaryBtn}>
                Play a new deck
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
    gridTemplateColumns: "repeat(4, 1fr)",
    gridTemplateRows: "repeat(4, 1fr)",
    gap: "9px",
    width: "min(100%, 590px)",
    aspectRatio: "1",
    padding: "12px",
    borderRadius: "28px",
    background: "#191919",
    boxShadow: "0 28px 64px var(--shadow)",
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
    fontFamily: "var(--font-oxygen), 'Oxygen', sans-serif",
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
    borderRadius: "12px",
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
  modalWinner: {
    margin: "-10px 0 22px",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    lineHeight: 1.5,
  },
  modalActions: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
};

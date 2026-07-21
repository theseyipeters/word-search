"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowIcon } from "./ArrowIcon";
import ui from "./RoomJoinForm.module.css";

type RoomJoinFormProps = {
  gamePath: `/${string}`;
};

export function RoomJoinForm({ gamePath }: RoomJoinFormProps) {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [showError, setShowError] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (roomCode.length !== 4) {
      setShowError(true);
      return;
    }
    router.push(`${gamePath}/room/${roomCode}`);
  };

  return (
    <div className={ui.joinRoom}>
      <div className={ui.divider}><span>or join an existing room</span></div>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={`room-code-${gamePath.replaceAll("/", "-")}`}>
          Four-digit room code
        </label>
        <div className={ui.joinControls}>
          <input
            id={`room-code-${gamePath.replaceAll("/", "-")}`}
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 4));
              setShowError(false);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="0000"
            aria-invalid={showError}
            aria-describedby={showError ? `room-error-${gamePath.replaceAll("/", "-")}` : undefined}
          />
          <button type="submit" disabled={roomCode.length !== 4}>
            Join room <span aria-hidden="true"><ArrowIcon /></span>
          </button>
        </div>
        {showError && (
          <p id={`room-error-${gamePath.replaceAll("/", "-")}`} role="alert">
            Enter all four digits to join.
          </p>
        )}
      </form>
    </div>
  );
}

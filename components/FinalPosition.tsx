import ui from "./FinalPosition.module.css";

export type FinalStandingRow = {
  id: string;
  name: string;
  score: number;
};

type FinalStandingsProps = {
  rows: FinalStandingRow[];
  currentPlayerId?: string;
  scoreLabel?: string | ((score: number) => string);
};

function getScorePosition(scores: number[], playerScore: number) {
  return scores.filter((score) => score > playerScore).length + 1;
}

export function FinalStandings({
  rows,
  currentPlayerId,
  scoreLabel = "points",
}: FinalStandingsProps) {
  const sortedRows = [...rows].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );
  const scores = sortedRows.map((row) => row.score);

  return (
    <section className={ui.card} aria-label="Final standings">
      <div className={ui.header}>
        <span>Final standings</span>
        <small>{sortedRows.length} player{sortedRows.length === 1 ? "" : "s"}</small>
      </div>
      <div className={ui.rows}>
        {sortedRows.map((row) => {
          const position = getScorePosition(scores, row.score);
          const isCurrentPlayer = row.id === currentPlayerId;
          const label = typeof scoreLabel === "function" ? scoreLabel(row.score) : scoreLabel;
          return (
            <div className={`${ui.row} ${isCurrentPlayer ? ui.current : ""}`} key={row.id}>
              <span className={ui.rank}>#{position}</span>
              <span className={ui.name}>
                {row.name}
                {isCurrentPlayer ? <small>You</small> : null}
              </span>
              <strong className={ui.score}>{row.score} {label}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

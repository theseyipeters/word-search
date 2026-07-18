import Link from "next/link";

const games = [
  {
    title: "Word Search",
    href: "/word-search",
    status: "Multiplayer",
    accent: "WS",
    description: "Race friends to find hidden words and score by word length.",
  },
  {
    title: "Tic Tac Toe",
    href: "/tic-tac-toe",
    status: "Multiplayer",
    accent: "XO",
    description: "Classic Xs and Os with room invites, turns, and rematches.",
  },
  {
    title: "Memory Match",
    href: "/memory-match",
    status: "Multiplayer",
    accent: "MM",
    description: "Flip cards, find pairs, and race for the highest score.",
  },
  {
    title: "Trivia Battle",
    href: "/trivia-battle",
    status: "AI Powered",
    accent: "TB",
    description: "Answer Bible questions, earn speed bonuses, and climb the leaderboard.",
  },
];

export default function Home() {
  return (
    <main style={styles.container}>
      <section style={styles.header}>
        <p style={styles.eyebrow}>Games</p>
        <h1 style={styles.title}>Choose a game</h1>
      </section>

      <section style={styles.gameList} aria-label="Available games">
        {games.map((game) => (
          <Link key={game.href} href={game.href} style={styles.gameCard}>
            <div style={styles.cardHeader}>
              <span style={styles.gameMark}>{game.accent}</span>
              <span style={styles.status}>{game.status}</span>
            </div>
            <div style={styles.cardBody}>
              <h2 style={styles.gameTitle}>{game.title}</h2>
              <p style={styles.description}>{game.description}</p>
            </div>
            <span style={styles.play}>Play</span>
          </Link>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    width: "min(100% - 32px, 980px)",
    margin: "0 auto",
    padding: "56px 0",
    display: "flex",
    flexDirection: "column",
    gap: "28px",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  eyebrow: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
  title: {
    fontSize: "clamp(2rem, 8vw, 3.4rem)",
    lineHeight: 1,
    fontWeight: 800,
  },
  gameList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
  },
  gameCard: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: "22px",
    minHeight: "220px",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    textDecoration: "none",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },
  gameMark: {
    width: "44px",
    height: "44px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: "0.9rem",
    fontWeight: 900,
  },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  gameTitle: {
    fontSize: "1.45rem",
    lineHeight: 1.05,
    fontWeight: 900,
  },
  status: {
    flex: "0 0 auto",
    padding: "3px 8px",
    borderRadius: "999px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontSize: "0.72rem",
    fontWeight: 800,
  },
  description: {
    color: "var(--text-secondary)",
    fontSize: "0.95rem",
    lineHeight: 1.45,
  },
  play: {
    alignSelf: "flex-start",
    padding: "9px 16px",
    borderRadius: "8px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontWeight: 800,
  },
};

import Link from "next/link";

const games = [
  {
    title: "Word Search",
    href: "/word-search",
    status: "Multiplayer",
    description: "Race friends to find hidden words and score by word length.",
  },
  {
    title: "Tic Tac Toe",
    href: "/tic-tac-toe",
    status: "Multiplayer",
    description: "Classic Xs and Os with room invites, turns, and rematches.",
  },
  {
    title: "Memory Match",
    href: "/memory-match",
    status: "Multiplayer",
    description: "Flip cards, find pairs, and race for the highest score.",
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
            <div>
              <div style={styles.gameTopline}>
                <h2 style={styles.gameTitle}>{game.title}</h2>
                <span style={styles.status}>{game.status}</span>
              </div>
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
    width: "min(100% - 32px, 760px)",
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
    gap: "12px",
  },
  gameCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px",
    minHeight: "108px",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text)",
    textDecoration: "none",
  },
  gameTopline: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "6px",
  },
  gameTitle: {
    fontSize: "1.25rem",
    fontWeight: 800,
  },
  status: {
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
    flex: "0 0 auto",
    padding: "9px 16px",
    borderRadius: "8px",
    background: "var(--accent)",
    color: "var(--accent-text)",
    fontWeight: 800,
  },
};

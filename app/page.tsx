import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Play Bible Games Together",
  description:
    "Pick a Bible-inspired game, invite your people, and start playing together in seconds.",
};

const games = [
  {
    number: "01",
    title: "Word Search",
    href: "/word-search",
    status: "Multiplayer",
    art: ["W", "O", "R", "D"],
    tone: "lime",
    description: "Race to uncover hidden Bible words before your friends do.",
  },
  {
    number: "02",
    title: "Tic Tac Toe",
    href: "/tic-tac-toe",
    status: "2 players",
    art: ["X", "O", "X", "O"],
    tone: "lavender",
    description: "A familiar classic, made better with a friendly Bible theme.",
  },
  {
    number: "03",
    title: "Memory Match",
    href: "/memory-match",
    status: "Multiplayer",
    art: ["✦", "●", "●", "✦"],
    tone: "peach",
    description: "Flip, remember, and match pairs as quickly as you can.",
  },
  {
    number: "04",
    title: "Trivia Battle",
    href: "/trivia-battle",
    status: "AI powered",
    art: ["A", "B", "C", "?"],
    tone: "sky",
    description: "Put your Bible knowledge to the test in a fast-paced quiz.",
  },
  {
    number: "05",
    title: "Connect Four",
    href: "/connect-four",
    status: "Solo + 2 players",
    art: ["●", "●", "○", "●"],
    tone: "rose",
    description: "Drop your discs, plan ahead, and be first to connect four.",
  },
  {
    number: "06",
    title: "Word Scramble Race",
    href: "/word-scramble",
    status: "Timed multiplayer",
    art: ["S", "O", "L", "V"],
    tone: "mint",
    description: "Rearrange Bible words quickly and race to the top score.",
  },
] as const;

const previewLetters = [
  "G", "R", "A", "C", "E",
  "H", "O", "P", "E", "R",
  "F", "A", "I", "T", "H",
  "L", "I", "G", "H", "T",
  "P", "E", "A", "C", "E",
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.logoLink} aria-label="Guidde games home">
          <Image
            src="/guidde3.svg"
            alt="Guidde"
            width={230}
            height={79}
            priority
            className={styles.logo}
          />
        </Link>
        <div className={styles.navMeta}>
          <span className={styles.liveDot} aria-hidden="true" />
          <span>6 games ready to play</span>
        </div>
      </header>

      {/* <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Bible games for everyone</p>
          <h1 id="home-title">
            Play. Connect.
            <span>Grow together.</span>
          </h1>
          <p className={styles.intro}>
            Quick, joyful games made for friends, families, and small groups.
            Pick one, share the room, and let the fun begin.
          </p>
          <div className={styles.heroActions}>
            <Link href="#games" className={styles.primaryButton}>
              Explore games <span aria-hidden="true">↓</span>
            </Link>
            <span className={styles.helperText}>No downloads. Play in your browser.</span>
          </div>
        </div>

        <Link href="/word-search" className={styles.featuredGame}>
          <div className={styles.featuredTopline}>
            <span>Tonight&apos;s pick</span>
            <span className={styles.featuredBadge}>Multiplayer</span>
          </div>

          <div className={styles.wordGrid} aria-hidden="true">
            {previewLetters.map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className={index >= 10 && index <= 14 ? styles.foundLetter : undefined}
              >
                {letter}
              </span>
            ))}
          </div>

          <div className={styles.featuredFooter}>
            <div>
              <span className={styles.featuredLabel}>Featured game</span>
              <h2>Word Search</h2>
            </div>
            <span className={styles.roundArrow} aria-hidden="true">↗</span>
          </div>
        </Link>
      </section> */}

      <section className={styles.gamesSection} id="games" aria-labelledby="games-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Find your favourite</p>
            <h2 id="games-title">Choose a game</h2>
          </div>
          <p>There&apos;s something for every kind of player.</p>
        </div>

        <div className={styles.gameGrid}>
          {games.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              className={`${styles.gameCard} ${styles[game.tone]}`}
            >
              <div className={styles.cardTopline}>
                <span className={styles.cardNumber}>{game.number}</span>
                <span className={styles.status}>{game.status}</span>
              </div>

              <div className={styles.cardArt} aria-hidden="true">
                {game.art.map((character, index) => (
                  <span key={`${character}-${index}`}>{character}</span>
                ))}
              </div>

              <div className={styles.cardContent}>
                <h3>{game.title}</h3>
                <p>{game.description}</p>
              </div>

              <span className={styles.playLink}>
                Play now <span aria-hidden="true">↗</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.inviteStrip} aria-label="How to play together">
        <p>Pick a game</p>
        <span aria-hidden="true">→</span>
        <p>Share the room</p>
        <span aria-hidden="true">→</span>
        <p>Play together</p>
      </section>

      <footer className={styles.footer}>
        <Image
          src="/guidde.svg"
          alt="Guidde"
          width={230}
          height={79}
          className={styles.footerLogo}
        />
        <p>Made for shared moments.</p>
      </footer>
    </main>
  );
}

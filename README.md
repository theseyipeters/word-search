# Bible Games Hub

A multiplayer games hub built with Next.js, React, Ably, and OpenAI.

## Games

- Word Search
- Tic Tac Toe
- Memory Match
- Trivia Battle

## Environment

Create a `.env` file with:

```bash
ABLY_API_KEY=your-ably-api-key
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`OPENAI_MODEL` is optional. Set `NEXT_PUBLIC_SITE_URL` to the production domain for accurate SEO and social preview URLs.

## Scripts

```bash
npm run dev
npm run build
```

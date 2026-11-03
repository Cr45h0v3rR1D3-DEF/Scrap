# Scrapline

A Trailmakers-style vehicle sandbox that runs in the browser. Build vehicles from blocks, then drive, fly and sail them around a whole planet with towns, highways, railways and a moon, and on to other worlds and other stars.

## Play

The site is `public/index.html`, a single page with everything in it. Vercel serves the `public` folder as it is, with no build step (see `vercel.json`).

## Change the game

The source is in `src/`. After editing, rebuild the page:

```
node build.mjs
```

That writes `public/index.html` (the site) and `dist/scrapline.html` (the same page for the Claude artifact version). Commit `public/index.html` and Vercel redeploys on its own.

Three.js r128 loads from cdnjs, and the fonts from Google Fonts.

## Saved vehicles and cloud saves

Saved vehicles (and the bases you build) are kept in each browser, and can follow you to other devices:

- **In the Claude version** they are saved to your Claude account automatically. Open Scrapline signed in on any device and they are there.
- **On this website** they use a save code. Open the vehicle library and press **Turn on** under Cloud saves to get a code (like `river-comet-oak-42`), then on another device press **I have a code** and type it.

The website's cloud saves need a small database, set up once:

1. In the Vercel dashboard, open this project and go to **Storage**.
2. Press **Create Database**, pick **Upstash for Redis** (the free plan is plenty), and create it.
3. Connect it to this project (all environments). Vercel adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` settings by itself.
4. Redeploy (Deployments, the newest one, Redeploy) so the site picks them up.

The server side is `api/cloud.js`. Until a database is connected the library simply does not offer cloud saves.

Export and Import in the library still work too: Export copies a code with all your vehicles in it, Import pastes one.

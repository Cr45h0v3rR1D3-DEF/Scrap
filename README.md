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

## Saved vehicles

Saved vehicles live in each browser's own storage, so a vehicle saved on one site or device does not appear on another. To move them, open the vehicle library and use **Export** (it copies a code) on the old copy, then **Import** (paste the code) on the new one.

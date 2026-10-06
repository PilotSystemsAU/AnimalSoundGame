# Animal Noises

A party game website. Everyone scans one QR code and sees a single animal name. They spread out, close their eyes, make their animal's noise and find the others making the same sound.

The site hands out animals so every group stays within one player of every other group, however many people join.

- **Player page:** `/`. Shows only the animal name.
- **Host panel:** `/admin`. Password protected. Edit the animal pool, set the number of groups, watch live counts, start new rounds, show or download the QR code.

## How to run a round (host)

1. Open `/admin` and sign in.
2. Check the animal pool and the number of groups, then **Save settings** if you changed anything.
3. Show the QR code full screen, or print the PNG. It's the same code every round.
4. Tap **New round**.
5. Everyone scans and reads their animal. Watch the counts until the total matches the people in the room, then say go.
6. For the next round, tap **New round** again. Everyone re-scans; pages left open hide the old animal automatically.

If someone re-scans in the same round on the same phone and browser, they get the same animal back.

## How it works

- Each phone gets a random device ID stored in the browser (localStorage plus a cookie).
- On load, the page asks the server to join. A Redis Lua script runs atomically: if the device already has an animal this round it gets the same one, otherwise it joins the animal with the fewest players, with ties broken at random.
- Open player pages check the round ID every 5 seconds. When the host starts a new round, they hide the old animal and ask the player to scan again. They never join a new round on their own.
- The admin sign-in is an httpOnly cookie derived from `ADMIN_PASSWORD`. Changing the password signs out every device.

## Deploy (Vercel)

1. Import this repo into Vercel (framework: Next.js).
2. In the project's **Storage** tab, create an **Upstash for Redis** database (free plan) and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. In **Settings → Environment Variables**, add `ADMIN_PASSWORD`. Optionally add `ADMIN_COOKIE_SECRET` and change it later to sign out every admin device.
4. Redeploy. Every push to `main` deploys to production.

## Local development

```bash
npm install
redis-server --port 6379 &        # any local Redis
cp .env.example .env.local        # set ADMIN_PASSWORD; keep REDIS_URL
npm run dev
```

## Tests

`scripts/test-balance.mjs` runs the acceptance checks from the scope sheet against any running copy of the site. It temporarily switches to a test pool, runs the checks, then restores your settings and starts a clean round.

```bash
BASE_URL=https://your-site.vercel.app ADMIN_PASSWORD=... npm run test:balance
```

Checks: admin routes reject unsigned requests; 100 joins split 20/20/20/20/20; 103 joins split 21/21/21/20/20; 100 simultaneous joins stay within one; the same device keeps its animal and is counted once; new rounds pick unique animals from the pool with counts at zero; bad settings are rejected.

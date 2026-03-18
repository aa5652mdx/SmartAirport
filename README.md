# Smart Airport Parking & Slot Booking System

## Files

```
smart-airport-parking/
├── server.js          ← Everything: DB, API routes, prediction logic, seed
├── public/
│   ├── index.html
│   ├── airport.css
│   └── airport.js     ← Frontend (unchanged)
├── package.json
├── render.yaml
├── .env.example
└── .gitignore
```

---

## Local Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up MongoDB Atlas (free)
1. Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free **M0 cluster**
3. **Database Access** → create a user with username + password
4. **Network Access** → add `0.0.0.0/0` (required for Render)
5. **Connect** → Drivers → copy the connection string

### 3. Create your .env
```bash
cp .env.example .env
```
Edit `.env`:
```
MONGO_URI=mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/
DB_NAME=airport_parking
PORT=3000
```

### 4. Seed the database (2,000 bookings)
```bash
npm run seed
```

### 5. Start the server
```bash
npm start
# or for auto-reload during development:
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/smart-airport-parking.git
git branch -M main
git push -u origin main
```

### Step 2 — Create a Render Web Service
1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect GitHub and select your repo
3. Render auto-detects `render.yaml` — confirm:
   - Build Command: `npm install`
   - Start Command: `npm start`

### Step 3 — Add environment variable
In Render dashboard → **Environment**:

| Key | Value |
|-----|-------|
| `MONGO_URI` | Your Atlas connection string |
| `DB_NAME` | `airport_parking` |

> Render sets `PORT` automatically — do not add it.

### Step 4 — Deploy
Click **Create Web Service**. Every future `git push` to `main` redeploys automatically.

### Step 5 — Seed production data
After first deploy, run once from your local machine pointing at Atlas:
```bash
MONGO_URI="mongodb+srv://..." npm run seed
```

---

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/overview` | Dashboard stats, zones, timeline, insights |
| POST | `/api/bookings` | Create booking → returns allocation + arrival window |
| GET | `/api/bookings` | Last 20 bookings (for testing) |

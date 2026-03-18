require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const path      = require("path");
const { MongoClient } = require("mongodb");

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════════

const PORT     = process.env.PORT     || 3000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME  = process.env.DB_NAME  || "airport_parking";

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI is not set. Add it to your .env file.");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════════════════════════

let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`✓ MongoDB connected — database: ${DB_NAME}`);
  return db;
}

// ══════════════════════════════════════════════════════════════════════════════
// PREDICTION & ALLOCATION LOGIC
// ══════════════════════════════════════════════════════════════════════════════

const ZONES = [
  { name: "Zone A – Short Stay", code: "A", totalSpaces: 300, shortStay: true,  terminals: ["North", "South"] },
  { name: "Zone B – Long Stay",  code: "B", totalSpaces: 500, shortStay: false, terminals: ["East", "West"]   },
  { name: "Zone C – Express",    code: "C", totalSpaces: 150, shortStay: true,  terminals: ["North"]          },
  { name: "Zone D – Economy",    code: "D", totalSpaces: 600, shortStay: false, terminals: ["South", "East", "West"] },
];

const HOUR_PRESSURE = [
  0.15, 0.10, 0.08, 0.07, 0.08, 0.12,
  0.22, 0.40, 0.62, 0.75, 0.78, 0.72,
  0.65, 0.60, 0.58, 0.62, 0.70, 0.80,
  0.85, 0.88, 0.82, 0.68, 0.45, 0.25,
];
const DAY_PRESSURE   = [0.70, 0.60, 0.58, 0.65, 0.80, 0.95, 0.90]; // Mon–Sun
const MONTH_PRESSURE = [0.60, 0.55, 0.65, 0.70, 0.75, 0.90, 1.00, 0.98, 0.85, 0.72, 0.65, 0.88];

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function scoreToLabel(score) {
  if (score >= 80) return "Very High";
  if (score >= 60) return "High";
  if (score >= 40) return "Moderate";
  if (score >= 20) return "Low";
  return "Very Low";
}

function computeCongestionScore(date, nearbyBookings = 0) {
  const raw =
    HOUR_PRESSURE[date.getHours()]    * 0.30 +
    DAY_PRESSURE[date.getDay()]       * 0.20 +
    MONTH_PRESSURE[date.getMonth()]   * 0.20 +
    clamp(nearbyBookings / 50, 0, 1)  * 0.30;
  return clamp(Math.round(raw * 100), 5, 99);
}

function recommendArrivalWindow(departureDate, congestionScore, routeType) {
  const baseMin  = routeType === "international" ? 195 : 135;
  const extraMin = Math.round((congestionScore / 100) * 45);
  const total    = baseMin + extraMin;
  const windowStart = new Date(departureDate.getTime() - total * 60_000);
  const windowEnd   = new Date(departureDate.getTime() - (total - 30) * 60_000);
  return { windowStart, windowEnd };
}

function allocateZone(terminal, routeType, activeByCode) {
  const scored = ZONES.map((zone) => {
    const used         = activeByCode[zone.code] || 0;
    const utilisation  = used / zone.totalSpaces;
    const terminalHit  = zone.terminals.includes(terminal) ? 0 : 1;
    const stayHit      = (routeType === "domestic") === zone.shortStay ? 0 : 1;
    return { zone, score: terminalHit + stayHit + utilisation * 10 };
  });
  return scored.sort((a, b) => a.score - b.score)[0].zone;
}

function generateSlotCode(zoneCode, existingCount) {
  return `${zoneCode}-${String((existingCount % 300) + 1).padStart(3, "0")}`;
}

function buildTimeline(baseDate) {
  return Array.from({ length: 8 }, (_, block) => {
    const hour  = block * 3;
    const score = clamp(
      Math.round((HOUR_PRESSURE[hour] * 0.5 + DAY_PRESSURE[baseDate.getDay()] * 0.25 + MONTH_PRESSURE[baseDate.getMonth()] * 0.25) * 100),
      5, 99
    );
    return { label: `${String(hour).padStart(2, "0")}:00`, occupancyRate: score, congestionLabel: scoreToLabel(score) };
  });
}

function nextPeakWindowLabel() {
  const hour = new Date().getHours();
  if (hour < 7)  return "07:00–09:00";
  if (hour < 17) return "17:00–19:00";
  return "Tomorrow 07:00–09:00";
}

function buildInsights({ congestionScore, congestionLabel, liveOccupancy, zoneStatus, bookingsToday }) {
  const insights = [];
  if (congestionScore >= 80) {
    insights.push(`Congestion is ${congestionLabel}. Consider activating overflow Zone D and variable message signs on approach roads.`);
  } else if (congestionScore >= 60) {
    insights.push(`Moderate-to-high congestion forecast. Review staff levels for the next two hours.`);
  } else {
    insights.push(`Congestion is ${congestionLabel}. Normal operations expected — no immediate intervention needed.`);
  }
  const overloaded = zoneStatus.filter((z) => z.utilisation >= 85);
  if (overloaded.length) {
    insights.push(`${overloaded.map((z) => z.name).join(" and ")} ${overloaded.length === 1 ? "is" : "are"} above 85% capacity. New arrivals should be redirected automatically.`);
  }
  if (liveOccupancy > 90) {
    insights.push(`Overall site occupancy has exceeded 90%. The dynamic pricing trigger threshold has been reached.`);
  }
  if (bookingsToday > 200) {
    insights.push(`${bookingsToday} bookings today — above average. Increase shuttle frequency for long-stay zones.`);
  } else if (bookingsToday === 0) {
    insights.push(`No bookings recorded yet today. Run npm run seed if this is a fresh install.`);
  }
  const quiet = zoneStatus.find((z) => z.utilisation < 30);
  if (quiet) {
    insights.push(`${quiet.name} has low utilisation (${quiet.utilisation}%). Promote it via the booking interface to balance load.`);
  }
  return insights;
}

// ══════════════════════════════════════════════════════════════════════════════
// SEED (runs when: node server.js --seed)
// ══════════════════════════════════════════════════════════════════════════════

async function seed() {
  console.log("Seeding database...");
  const FIRST = ["James","Maria","Oliver","Sophia","Liam","Emma","Noah","Ava","Ethan","Isabella","Lucas","Mia","Mason","Charlotte","Logan","Amelia","Elijah","Harper","Aiden","Evelyn","Amina","Chen","Priya","Kofi","Fatima","Hiroshi","Ingrid","Matteo","Yusuf","Aoife"];
  const LAST  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Moore","Taylor","Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Walker","Young","Rahman","Patel","Nguyen","Kim","Osei","Müller","Rossi","Johansson","Santos","O'Brien"];
  const PREFIXES = ["BA","EZY","RYR","LH","AF","KL","IB","FR","U2","TK","QR","EK","SQ","AA","UA","DL","VS","AZ","SK","OS"];
  const TERMINALS = ["North","South","East","West"];
  const ROUTES    = ["domestic","international"];
  const DOMAINS   = ["gmail.com","outlook.com","yahoo.co.uk","icloud.com","proton.me"];

  const rand    = (a) => a[Math.floor(Math.random() * a.length)];
  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const letters = "ABCDEFGHJKLMNOPRSTUVWXY";
  const L = (n) => Array.from({ length: n }, () => letters[randInt(0, letters.length - 1)]).join("");
  const regPlate = () => `${L(2)}${randInt(10,99)} ${L(3)}`;
  const flight   = () => `${rand(PREFIXES)}${randInt(100, 9999)}`;

  const startDate = new Date("2023-01-01T00:00:00Z");
  const now = new Date();
  const col = db.collection("bookings");

  const deleted = await col.deleteMany({});
  console.log(`  Cleared ${deleted.deletedCount} existing bookings`);

  const usedSlots = new Set();
  const TOTAL = 2000;
  const BATCH = 200;
  let inserted = 0;

  for (let offset = 0; offset < TOTAL; offset += BATCH) {
    const docs = [];
    const batchSize = Math.min(BATCH, TOTAL - offset);

    for (let i = 0; i < batchSize; i++) {
      // Generate a date biased towards peak months/days
      let departure;
      do {
        const daysOffset = randInt(0, 729);
        departure = new Date(startDate.getTime() + daysOffset * 86_400_000);
        departure.setHours(randInt(5, 22), rand([0, 15, 30, 45]), 0, 0);
      } while (
        Math.random() > MONTH_PRESSURE[departure.getMonth()] * 0.9 + 0.1 ||
        Math.random() > DAY_PRESSURE[departure.getDay()] * 0.8 + 0.2
      );

      const returnTime = new Date(departure.getTime() + randInt(1, 21) * 86_400_000);
      const terminal   = rand(TERMINALS);
      const routeType  = rand(ROUTES);
      const zone       = rand(ZONES);
      const firstName  = rand(FIRST);
      const lastName   = rand(LAST);
      const congScore  = computeCongestionScore(departure, randInt(0, 30));
      const { windowStart, windowEnd } = recommendArrivalWindow(departure, congScore, routeType);

      let slotCode, attempts = 0;
      do {
        slotCode = `${zone.code}-${String(randInt(1, zone.totalSpaces)).padStart(3, "0")}`;
        if (++attempts > 50) { slotCode += `-${offset + i}`; break; }
      } while (usedSlots.has(slotCode));
      usedSlots.add(slotCode);

      const status = departure < now
        ? (Math.random() < 0.08 ? "cancelled" : "completed")
        : (Math.random() < 0.05 ? "cancelled" : "confirmed");

      docs.push({
        fullName:        `${firstName} ${lastName}`,
        email:           `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(1,99)}@${rand(DOMAINS)}`,
        vehicleReg:      regPlate(),
        flightNumber:    flight(),
        terminal,
        routeType,
        departureTime:   departure,
        returnTime,
        zoneName:        zone.name,
        slotCode,
        arrivalWindow:   { start: windowStart, end: windowEnd },
        congestionScore: congScore,
        congestionLabel: scoreToLabel(congScore),
        status,
        createdAt:       new Date(departure.getTime() - randInt(1, 30) * 86_400_000),
      });
    }

    await col.insertMany(docs);
    inserted += docs.length;
    process.stdout.write(`  Inserted ${inserted}/${TOTAL}\r`);
  }

  console.log(`\n✓ Seeded ${inserted} bookings`);

  await col.createIndex({ createdAt: -1 });
  await col.createIndex({ departureTime: 1 });
  await col.createIndex({ zoneName: 1 });
  await col.createIndex({ status: 1 });
  await col.createIndex({ vehicleReg: 1 });
  await col.createIndex({ slotCode: 1 }, { unique: true });
  console.log("✓ Indexes created");

  const byStatus = await col.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray();
  console.log("\nBookings by status:");
  byStatus.forEach((r) => console.log(`  ${r._id}: ${r.count}`));
  console.log("\n✓ Done. Run npm start to launch the server.");
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── GET /api/overview ─────────────────────────────────────────────────────────
app.get("/api/overview", async (req, res) => {
  try {
    const bookings = db.collection("bookings");
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    const [bookingsToday, activeBookings, nearbyBookings] = await Promise.all([
      bookings.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $ne: "cancelled" } }),
      bookings.countDocuments({ status: { $in: ["confirmed", "checked-in"] } }),
      bookings.countDocuments({
        departureTime: { $gte: new Date(now.getTime() - 3 * 3600_000), $lte: new Date(now.getTime() + 3 * 3600_000) },
        status: { $ne: "cancelled" }
      }),
    ]);

    const totalSpaces      = ZONES.reduce((s, z) => s + z.totalSpaces, 0);
    const liveOccupancy    = Math.min((activeBookings / totalSpaces) * 100, 99.9);
    const availableSpaces  = Math.max(totalSpaces - activeBookings, 0);
    const congestionScore  = computeCongestionScore(now, nearbyBookings);
    const congestionLabel  = scoreToLabel(congestionScore);
    const expectedDelayMinutes = Math.round((congestionScore / 100) * 35);

    const zoneAgg = await bookings.aggregate([
      { $match: { status: { $in: ["confirmed", "checked-in"] } } },
      { $group: { _id: "$zoneName", count: { $sum: 1 } } },
    ]).toArray();
    const zoneCountMap = Object.fromEntries(zoneAgg.map((r) => [r._id, r.count]));

    const zoneStatus = ZONES.map((zone) => {
      const used        = zoneCountMap[zone.name] || 0;
      const utilisation = Math.min(Math.round((used / zone.totalSpaces) * 100), 100);
      return {
        name: zone.name,
        available: Math.max(zone.totalSpaces - used, 0),
        utilisation,
        description: zone.terminals.map((t) => `${t} Terminal`).join(", "),
      };
    });

    const peakDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() + i);
      const rate = (DAY_PRESSURE[d.getDay()] * 0.6 + MONTH_PRESSURE[d.getMonth()] * 0.4) * 100;
      return {
        label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
        demandScore: Math.round(rate),
        utilisationRate: rate.toFixed(1),
      };
    }).sort((a, b) => b.demandScore - a.demandScore);

    const recentBookings = await bookings
      .find({ status: { $ne: "cancelled" } })
      .sort({ createdAt: -1 })
      .limit(5)
      .project({ fullName: 1, flightNumber: 1, terminal: 1, zoneName: 1, slotCode: 1, arrivalWindow: 1, departureTime: 1 })
      .toArray();

    res.json({
      storageMode: "MongoDB",
      stats: { bookingsToday, liveOccupancy, availableSpaces, congestionScore, congestionLabel, expectedDelayMinutes, nextPeakWindow: nextPeakWindowLabel() },
      timeline: buildTimeline(now),
      zoneStatus,
      peakDays,
      recentBookings,
      insights: buildInsights({ congestionScore, congestionLabel, liveOccupancy, zoneStatus, bookingsToday }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load overview." });
  }
});

// ── POST /api/bookings ────────────────────────────────────────────────────────
app.post("/api/bookings", async (req, res) => {
  try {
    const { fullName, email, vehicleReg, flightNumber, terminal, routeType, departureTime, returnTime } = req.body;

    const missing = ["fullName","email","vehicleReg","flightNumber","terminal","routeType","departureTime","returnTime"]
      .filter((k) => !req.body[k]);
    if (missing.length) return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });

    const departure = new Date(departureTime);
    const returnDt  = new Date(returnTime);
    if (isNaN(departure.getTime())) return res.status(400).json({ message: "Invalid departureTime." });
    if (isNaN(returnDt.getTime()))  return res.status(400).json({ message: "Invalid returnTime." });
    if (returnDt <= departure)      return res.status(400).json({ message: "returnTime must be after departureTime." });
    if (departure <= new Date())    return res.status(400).json({ message: "departureTime must be in the future." });

    const bookings = db.collection("bookings");

    const conflict = await bookings.findOne({
      vehicleReg: vehicleReg.toUpperCase().trim(),
      status: { $in: ["confirmed", "checked-in"] },
      departureTime: { $lt: returnDt },
      returnTime:    { $gt: departure },
    });
    if (conflict) {
      return res.status(409).json({ message: `Vehicle ${vehicleReg.toUpperCase().trim()} already has an overlapping booking (${conflict.slotCode}).` });
    }

    const nearbyCount = await bookings.countDocuments({
      departureTime: { $gte: new Date(departure.getTime() - 3 * 3600_000), $lte: new Date(departure.getTime() + 3 * 3600_000) },
      status: { $ne: "cancelled" },
    });

    const congestionScore = computeCongestionScore(departure, nearbyCount);
    const congestionLabel = scoreToLabel(congestionScore);
    const { windowStart, windowEnd } = recommendArrivalWindow(departure, congestionScore, routeType);

    const zoneAgg = await bookings.aggregate([
      { $match: { status: { $in: ["confirmed", "checked-in"] } } },
      { $group: { _id: "$zoneName", count: { $sum: 1 } } },
    ]).toArray();
    const activeByCode = Object.fromEntries(
      ZONES.map((z) => [z.code, (zoneAgg.find((r) => r._id === z.name) || {}).count || 0])
    );

    const selectedZone = allocateZone(terminal, routeType, activeByCode);
    const zoneCount    = activeByCode[selectedZone.code] || 0;
    let slotCode       = generateSlotCode(selectedZone.code, zoneCount);
    const exists       = await bookings.findOne({ slotCode });
    if (exists) slotCode += `-${Date.now().toString(36).slice(-4)}`;

    const doc = {
      fullName: fullName.trim(), email: email.trim().toLowerCase(),
      vehicleReg: vehicleReg.trim().toUpperCase(), flightNumber: flightNumber.trim().toUpperCase(),
      terminal, routeType, departureTime: departure, returnTime: returnDt,
      zoneName: selectedZone.name, slotCode,
      arrivalWindow: { start: windowStart, end: windowEnd },
      congestionScore, congestionLabel, status: "confirmed", createdAt: new Date(),
    };

    const result = await bookings.insertOne(doc);
    const durationDays = Math.ceil((returnDt - departure) / (1000 * 3600 * 24));
    const summary = congestionScore >= 70
      ? "High congestion expected. Arriving in your recommended window will help avoid delays."
      : congestionScore >= 40
      ? "Moderate demand expected. Your arrival window gives comfortable check-in time."
      : "Low congestion expected — a smooth arrival is forecast.";

    res.status(201).json({
      booking: { id: result.insertedId, fullName: doc.fullName, flightNumber: doc.flightNumber, terminal, departureTime: departure, returnTime: returnDt, durationDays },
      allocation: { zoneName: selectedZone.name, slotCode, explanation: `${selectedZone.name} selected based on your terminal (${terminal}) and ${routeType} route.` },
      recommendation: { windowStart, windowEnd, summary },
      prediction: { score: congestionScore, label: congestionLabel },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Booking could not be completed." });
  }
});

// ── GET /api/bookings (last 20, for testing) ──────────────────────────────────
app.get("/api/bookings", async (req, res) => {
  try {
    const list = await db.collection("bookings").find({}).sort({ createdAt: -1 }).limit(20).toArray();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: "Could not fetch bookings." });
  }
});

// SPA fallback
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

// ══════════════════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════════════════

connectDB().then(async () => {
  if (process.argv.includes("--seed")) {
    await seed();
    process.exit(0);
  }
  app.listen(PORT, () => console.log(`✓ Server running on http://localhost:${PORT}`));
}).catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});

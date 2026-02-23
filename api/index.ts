import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

// ── Mongoose schemas ─────────────────────────────────────────────────────────

const rosterSchema = new mongoose.Schema({
  date: { type: String, required: true },
  engineer_name: { type: String, required: true },
  shift_type: { type: String, required: true },
});
rosterSchema.index({ date: 1, engineer_name: 1 }, { unique: true });

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: String, required: true },
});

// Prevent model re-compilation in serverless hot-reload
const Roster =
  mongoose.models["Roster"] || mongoose.model("Roster", rosterSchema);
const Settings =
  mongoose.models["Settings"] || mongoose.model("Settings", settingsSchema);

// ── DB connection (cached for serverless) ────────────────────────────────────

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  isConnected = true;

  // Seed defaults
  await Settings.updateOne(
    { key: "admin_password" },
    { $setOnInsert: { key: "admin_password", value: "admin" } },
    { upsert: true }
  );
  await Settings.updateOne(
    { key: "shift_times" },
    {
      $setOnInsert: {
        key: "shift_times",
        value: JSON.stringify({
          Morning: { start: "08:00", end: "16:00" },
          Evening: { start: "16:00", end: "00:00" },
          Night: { start: "00:00", end: "08:00" },
        }),
      },
    },
    { upsert: true }
  );
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
multer({ storage: multer.memoryStorage() });

// Middleware to ensure DB is connected before every request
app.use(async (_req, _res, next) => {
  await connectDB();
  next();
});

// Login
app.post("/api/login", async (req, res) => {
  const { password } = req.body;
  const row = await Settings.findOne({ key: "admin_password" });
  if (row && password === row.value) {
    res.json({ success: true, token: "mock-token-123" });
  } else {
    res.status(401).json({ success: false, message: "Invalid password" });
  }
});

// Get roster
app.get("/api/roster", async (req, res) => {
  const { date } = req.query;
  const filter = date ? { date: date as string } : {};
  const rows = await Roster.find(filter).lean();
  res.json(rows);
});

// Get settings
app.get("/api/settings", async (req, res) => {
  const row = await Settings.findOne({ key: "shift_times" });
  res.json(row ? JSON.parse(row.value) : {});
});

// Update settings
app.post("/api/settings", async (req, res) => {
  const { shift_times, admin_password } = req.body;
  if (shift_times) {
    await Settings.updateOne(
      { key: "shift_times" },
      { value: JSON.stringify(shift_times) }
    );
  }
  if (admin_password) {
    await Settings.updateOne({ key: "admin_password" }, { value: admin_password });
  }
  res.json({ success: true });
});

// Confirm/save roster
app.post("/api/roster/confirm", async (req, res) => {
  const { data } = req.body;
  if (!data || !Array.isArray(data))
    return res.status(400).send("Invalid data");

  try {
    const ops = data.map((item: any) => ({
      updateOne: {
        filter: { date: item.date, engineer_name: item.engineer_name },
        update: { $set: { shift_type: item.shift_type } },
        upsert: true,
      },
    }));
    await Roster.bulkWrite(ops);
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving roster:", error);
    res.status(500).json({ success: false, message: "Failed to save roster" });
  }
});

export default app;

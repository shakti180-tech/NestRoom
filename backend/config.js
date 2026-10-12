// Backend configuration. Values come from environment variables or a local `.env` file
// (copy `.env.example` to `.env`). Never commit `.env`.
const fs = require("fs");
const path = require("path");

// tiny .env loader (no dependency needed)
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch { /* no .env file – rely on real environment variables */ }

module.exports = {
  port: process.env.PORT || 3000,
  corsOrigin: process.env.CORS_ORIGIN || "*",
  tokenTtlHours: 12,

  // MongoDB Atlas connection string (mongodb+srv://...). Required.
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB || "nestroom",

  // Secret used to sign login tokens. Set a long random value in production.
  tokenSecret: process.env.TOKEN_SECRET,

  // The ONE admin account. The password is hashed in memory at startup, never sent to the frontend.
  admin: {
    username: process.env.ADMIN_USERNAME || "Shakti-Rai",
    password: process.env.ADMIN_PASSWORD || "Bhumihar52",
    name: "Shakti Rai",
  },

  // On the very first start the empty database is filled with sample rooms, bookings and two demo
  // owners (usernames: meera, arjun). Set SEED_DEMO_DATA=false to start with an empty database.
  seedDemoData: process.env.SEED_DEMO_DATA !== "false",
  demoOwnerPassword: process.env.DEMO_OWNER_PASSWORD || "Owner@123",
};

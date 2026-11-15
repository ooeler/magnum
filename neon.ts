import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  dataApi: true,
  buckets: {
    photos: { access: "private" },
  },
  functions: {
    api: {
      name: "Magnum API",
      source: "functions/index.ts",
      env: {
        APP_URL: process.env.APP_URL!,
        CRON_SECRET: process.env.CRON_SECRET!,
      },
    },
  },
  triggers: {
    "tageslauf": {
      type: "schedule",
      function: "api",
      cron: "0 9 * * *",
      functionPath: "/taeglich",
    },
    // Immer um 18 Uhr Schweizer Zeit: läuft um 16 und 17 Uhr UTC, gesendet wird nur, wenn es in Zürich 18 Uhr ist
    "magnumabend": {
      type: "schedule",
      function: "api",
      cron: "0 16,17 * * *",
      functionPath: "/abend",
    },
    "tagessicherung": {
      type: "schedule",
      function: "api",
      cron: "30 2 * * *",
      functionPath: "/backup",
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});

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

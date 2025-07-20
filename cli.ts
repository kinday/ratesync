#!/usr/bin/env node --experimental-strip-types

import * as Tags from "common-tags";
import Utility from "node:util";
import { pino as createLogger, levels as logLevels } from "pino";
import { run } from "./index.ts";

const logger = createLogger();

const flags = Utility.parseArgs({
  options: {
    "dry-run": {
      type: "boolean",
    },
    help: {
      type: "boolean",
      short: "h",
    },
    "log-level": {
      type: "string",
    },
    "overwrite-existing": {
      type: "boolean",
    },
  },
});

if (flags.values.help === true) {
  const logLevelValues = Tags.commaListsOr`${Object.keys(logLevels.values)}`;
  console.log(Tags.stripIndent`
    Usage: ./cli.ts <options>

    Expects following environment variables to be set:
      PLEX_API_URL — origin part of URL of your Plex server, e.g. "http://192.168.1.100:32400";
      PLEX_API_TOKEN — your user’s Plex session token.

    Flags:
      --dry-run — simulate the sync without performing any changes
      -h, --help — show this message and exit
      --log-level=<level> — set log level to ${logLevelValues}
      --overwrite-existing — replace ours rating with theirs
  `);
  process.exit(0);
}

if (flags.values["log-level"] !== undefined) {
  const logLevelVal = logLevels.values[flags.values["log-level"]];
  if (logLevelVal !== undefined) {
    logger.level = logLevels.labels[logLevelVal];
    logger.info({ level: logger.level }, "logging level updated");
  }
}

const plexAuthToken = process.env.PLEX_API_TOKEN;
const plexBaseUrl = process.env.PLEX_API_URL;

if (plexAuthToken === undefined || plexAuthToken === "") {
  logger.fatal("Plex session token is missing");
  throw new Error("PLEX_API_TOKEN is not set");
}

if (plexBaseUrl === undefined || plexBaseUrl === "") {
  logger.fatal("Plex server URL is missing");
  throw new Error("PLEX_API_URL is not set");
}

run(
  { logger },
  {
    dryRun: flags.values["dry-run"] === true,
    overrideExisting: flags.values["overwrite-existing"] === true,
    plexAuthToken,
    plexBaseUrl,
  },
).catch(() => {
  process.exit(1);
});

import { type Logger } from "pino";
import { PlexClient } from "./plex-client.ts";
import { AppleMusicClient } from "./apple-music-client.ts";

interface RatesyncContext {
  logger: Logger;
}

interface RatesyncOptions {
  dryRun: boolean;
  overrideExisting: boolean;
  plexAuthToken: string;
  plexBaseUrl: string;
}

async function sleep(time: number) {
  await new Promise((resolve) => {
    setTimeout(() => resolve(undefined), time);
  });
}

export async function run(
  { logger }: RatesyncContext,
  options: RatesyncOptions,
) {
  if (options.dryRun) {
    logger.warn("performing dry run, no changes will be made");
    await sleep(2000);
  }

  if (options.overrideExisting) {
    logger.warn("existing ratings will be overwritten");
    logger.warn("waiting for 5 seconds to allow user to cancel");
    await sleep(5000);
  }

  const startTime = Date.now();

  try {
    const appleMusicClient = new AppleMusicClient({
      logger: logger.child({ component: "AppleMusicClient" }),
    });
    logger.trace("initialized Apple Music client");

    const plexClient = new PlexClient(
      { logger: logger.child({ component: "PlexClient" }) },
      { authToken: options.plexAuthToken, baseUrl: options.plexBaseUrl },
    );
    logger.trace("initialized Plex API client");

    logger.debug("loading albums list...");
    const albums = await plexClient.listAlbums({ section: { byKey: "3" } });
    for (const album of albums) {
      if (album.name === "") {
        logger.warn({ albumKey: album.key }, "missing album title");
        continue;
      }

      logger.debug({ album: album.name }, "loading tracks list...");
      const tracks = await plexClient.listAlbumTracks({
        album: { byKey: album.key },
      });

      for (const track of tracks) {
        const trackLogger = logger.child({
          artist: album.artistName,
          album: track.albumName,
          track: track.name,
        });
        trackLogger.trace("initialized logger");

        const ourRating = track.rating;

        if (!options.overrideExisting && ourRating > 0) {
          trackLogger.info(
            { ourRating, theirRating: null },
            "skipping track with existing rating...",
          );
          continue;
        }

        trackLogger.debug("getting Apple Music rating...");
        const theirRating = await appleMusicClient.getAppleMusicRating({
          artistName: album.artistName,
          albumName: track.albumName,
          trackName: track.name,
        });

        if (theirRating === 0) {
          trackLogger.info(
            { ourRating, theirRating },
            "skipping unrated track",
          );
          continue;
        }

        if (theirRating === ourRating) {
          trackLogger.info(
            { ourRating, theirRating },
            "skipping track with same rating...",
          );
          continue;
        }

        if (ourRating === 0) {
          trackLogger.info({ ourRating, theirRating }, "setting rating...");
          if (!options.dryRun) {
            plexClient.setTrackRating({
              track: { byKey: track.key },
              rating: theirRating,
            });
          }
          continue;
        }

        if (options.overrideExisting) {
          trackLogger.warn({ ourRating, theirRating }, "overwriting rating...");
          if (!options.dryRun) {
            plexClient.setTrackRating({
              track: { byKey: track.key },
              rating: theirRating,
            });
          }
          continue;
        }

        throw new Error("Unknown error");
      }
    }
  } catch (error) {
    logger.fatal(error);
    throw error;
  }

  const endTime = Date.now();

  const executionTime = endTime - startTime;

  logger.info(
    { durationMs: executionTime },
    `finished in ${Math.round(executionTime / 1000)} sec`,
  );
}

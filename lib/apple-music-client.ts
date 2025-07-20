import * as Tags from "common-tags";
import type { Logger } from "pino";
import { runAppleScript } from "run-applescript";

interface TrackFilters {
  albumName: string;
  artistName: string;
  trackName: string;
}

export class AppleMusicClient {
  private logger: Logger;

  constructor(context: { logger: Logger }) {
    this.logger = context.logger;
  }

  async getAppleMusicRating(filters: TrackFilters) {
    try {
      const result = await runAppleScript(Tags.source`
        tell application "Music"
          set search_results to (every file track of playlist "Library" whose name contains "${filters.trackName}" and artist contains "${filters.artistName}")
          repeat with t in search_results
            set track_rating to rating of t
            return track_rating
          end repeat
        end tell
      `);
      const rating = parseInt(result.trim(), 10);

      if (Number.isNaN(rating)) {
        return 0;
      }

      return Math.round(rating / 10);
    } catch (error) {
      this.logger.error(error, "failed to retrieve Apple Music rating");

      // TODO: This will be problematic for reverse logic
      return 0;
    }
  }
}

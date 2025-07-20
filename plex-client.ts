import * as T from "@sinclair/typebox";
import * as Value from "@sinclair/typebox/value";
import { parseTemplate } from "url-template";
import { type Logger } from "pino";

export type AlbumRef =
  | {
      /** Reference album by unique key */
      byKey: string;
    }
  | {
      byArtist: ArtistRef;
      /** Reference album by name */
      byName: string;
    };

export type ArtistRef =
  | {
      /** Reference artist by unique key */
      byKey: string;
    }
  | {
      /** Reference artist by name */
      byName: string;
      bySection: SectionRef;
    };

export type SectionRef =
  | {
      /** Reference library section by unique key */
      byKey: string;
    }
  | {
      /** Reference library section by name */
      byName: string;
    };

export type TrackRef =
  | {
      /** Reference track by unique key */
      byKey: string;
    }
  | {
      byAlbum: AlbumRef;
      /** Reference album by name */
      byName: string;
    };

export interface ListArtistsParams {
  /** Library section */
  section: SectionRef;
}

export interface ListArtistAlbumsParams {
  /** Parent artist */
  artist: ArtistRef;
}

export interface ListAlbumsParams {
  /** Library section */
  section: SectionRef;
}

export interface ListAlbumTracksParams {
  /** Parent album */
  album: AlbumRef;
}

export interface SetTrackRatingParams {
  track: TrackRef;
  rating: number;
}

export interface ArtistEntry {
  key: string;
  name: string;
}

export interface AlbumEntry {
  key: string;
  name: string;
  artistName: string;
}

export interface TrackEntry {
  key: string;
  name: string;
  albumName: string;
  rating: number;
}

export const SearchType = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
  trailer: 5,
  comic: 6,
  person: 7,
  artist: 8,
  album: 9,
  track: 10,
  picture: 11,
  clip: 12,
  photo: 13,
  photoalbum: 14,
  playlist: 15,
  playlistFolder: 16,
  collection: 18,
  optimizedVersion: 42,
  userPlaylistItem: 1001,
} as const;

const EndpointConfig = {
  LIBRARY_SECTION_GET_ALL: {
    requestSchema: T.Object({
      url: T.Object({
        key: T.String(),
        type: T.Enum(SearchType),
        sort: T.Optional(T.Array(T.String())),
        limit: T.Optional(T.Number()),
      }),
    }),
    responseSchema: T.Object({
      MediaContainer: T.Object({
        Metadata: T.Array(
          T.Object({
            parentTitle: T.Optional(T.String()),
            ratingKey: T.String(),
            title: T.String(),
          }),
        ),
      }),
    }),
    template: parseTemplate("/library/sections/{key}/all{?type,sort}"),
  },
  METADATA_GET_CHILDREN: {
    requestSchema: T.Object({
      url: T.Object({
        key: T.String(),
      }),
    }),
    responseSchema: T.Object({
      MediaContainer: T.Object({
        Metadata: T.Array(
          T.Object({
            parentTitle: T.Optional(T.String()),
            ratingKey: T.String(),
            title: T.String(),
            type: T.Union([T.Literal("album"), T.Literal("track")]),
            userRating: T.Optional(T.Number()),
          }),
        ),
      }),
    }),
    template: parseTemplate(
      "/library/metadata/{key}/children?excludeAllLeaves=1",
    ),
  },
  ENTITY_RATING_UPDATE: {
    requestSchema: T.Object({
      url: T.Object({
        identifier: T.Union([T.Literal("com.plexapp.plugins.library")]),
        key: T.String(),
        rating: T.Number({ minimum: 0, maximum: 10 }),
      }),
    }),
    responseSchema: T.Any(),
    template: parseTemplate("/:/rate{?identifier,key,rating}"),
  },
};

type EndpointConfig = typeof EndpointConfig;

export class PlexFetchError extends Error {
  constructor() {
    super("Failed to fetch");
    this.name = "PlexFetchError";
  }
}

export class PlexResponseError extends Error {
  constructor() {
    super("Unexpected response");
    this.name = "PlexResponseError";
  }
}

export class PlexClient {
  private authToken: string;

  private baseUrl: string;

  private logger: Logger;

  constructor(
    context: { logger: Logger },
    params: { authToken: string; baseUrl: string },
  ) {
    this.authToken = params.authToken;
    this.baseUrl = params.baseUrl;
    this.logger = context.logger;
  }

  async listArtists(params: ListArtistsParams): Promise<ArtistEntry[]> {
    this.logger.debug({ params }, "fetching artists");

    const sectionKey = await this.getSectionKey(params.section);
    this.logger.debug({ key: sectionKey }, "resolved section key");

    const data = await this.fetch("LIBRARY_SECTION_GET_ALL", {
      url: {
        key: sectionKey,
        type: SearchType.artist,
        limit: 10,
      },
    });
    this.logger.debug(
      { count: data.MediaContainer.Metadata.length },
      "fetched artist data",
    );

    return data.MediaContainer.Metadata.map((artist) => {
      this.logger.debug({ data: artist }, "transforming artist");
      return {
        key: artist.ratingKey,
        name: artist.title,
      };
    });
  }

  async listAlbums(params: ListAlbumsParams): Promise<AlbumEntry[]> {
    this.logger.debug({ params }, "fetching albums");

    const sectionKey = await this.getSectionKey(params.section);
    this.logger.debug({ key: sectionKey }, "resolved section key");

    const data = await this.fetch("LIBRARY_SECTION_GET_ALL", {
      url: {
        key: sectionKey,
        type: SearchType.album,
      },
    });
    this.logger.debug(
      { count: data.MediaContainer.Metadata.length },
      "fetched album data",
    );

    return data.MediaContainer.Metadata.map((album) => {
      this.logger.debug({ data: album }, "transforming album");
      if (album.parentTitle === undefined) {
        throw new PlexResponseError();
      }
      return {
        key: album.ratingKey,
        name: album.title,
        artistName: album.parentTitle,
      };
    });
  }

  async listAlbumTracks(params: ListAlbumTracksParams): Promise<TrackEntry[]> {
    this.logger.debug({ params }, "fetching tracks");

    const key = await this.getAlbumKey(params.album);
    this.logger.debug({ key }, "resolved album key");

    const data = await this.fetch("METADATA_GET_CHILDREN", {
      url: {
        key,
      },
    });
    this.logger.debug(
      { count: data.MediaContainer.Metadata.length },
      "fetched tracks",
    );

    return data.MediaContainer.Metadata.map((track) => {
      this.logger.debug({ data: track }, "transforming track");
      if (track.parentTitle === undefined) {
        throw new PlexResponseError();
      }
      return {
        key: track.ratingKey,
        name: track.title,
        albumName: track.parentTitle,
        rating: track.userRating ?? 0,
      };
    });
  }

  async listArtistAlbums(
    params: ListArtistAlbumsParams,
  ): Promise<AlbumEntry[]> {
    this.logger.debug({ params }, "fetching albums");

    const key = await this.getArtistKey(params.artist);
    this.logger.debug({ key }, "resolved artist key");

    const data = await this.fetch("METADATA_GET_CHILDREN", {
      url: {
        key,
      },
    });
    this.logger.debug(
      { count: data.MediaContainer.Metadata.length },
      "fetched album data",
    );

    return data.MediaContainer.Metadata.map((album) => {
      this.logger.debug({ data: album }, "transforming album");
      if (album.parentTitle === undefined) {
        throw new PlexResponseError();
      }
      return {
        key: album.ratingKey,
        name: album.title,
        artistName: album.parentTitle,
      };
    });
  }

  async setTrackRating(params: SetTrackRatingParams): Promise<void> {
    const key = await this.getTrackKey(params.track);
    await this.fetch("ENTITY_RATING_UPDATE", {
      url: {
        identifier: "com.plexapp.plugins.library",
        key,
        rating: params.rating,
      },
    });
  }

  private async getAlbumKey(ref: AlbumRef) {
    if ("byKey" in ref) {
      return ref.byKey;
    }

    throw new Error("Not implemented");
  }

  private async getArtistKey(ref: ArtistRef) {
    if ("byKey" in ref) {
      return ref.byKey;
    }

    throw new Error("Not implemented");
  }

  private async getSectionKey(ref: SectionRef) {
    if ("byKey" in ref) {
      return ref.byKey;
    }

    throw new Error("Not implemented");
  }

  private async getTrackKey(ref: TrackRef) {
    if ("byKey" in ref) {
      return ref.byKey;
    }

    throw new Error("Not implemented");
  }

  private async fetch<Endpoint extends keyof EndpointConfig>(
    endpoint: Endpoint,
    request: T.Static<EndpointConfig[Endpoint]["requestSchema"]>,
  ): Promise<T.Static<EndpointConfig[Endpoint]["responseSchema"]>> {
    const { requestSchema, responseSchema, template } =
      EndpointConfig[endpoint];

    Value.Assert(requestSchema, request);

    const headers = new Headers();

    // Make Plex response with JSON instead of XML
    headers.set("Accept", "application/json");

    // Authentication
    headers.set("X-Plex-Token", this.authToken);

    const response = await fetch(
      new URL(template.expand(request.url), this.baseUrl),
      {
        headers,
        method: "GET",
      },
    );

    if (!response.ok) {
      this.logger.error(
        {
          body: await response.text(),
          status: response.status,
          statusText: response.statusText,
        },
        "fetch failed",
      );
      throw new PlexFetchError();
    }

    const contentLength = parseInt(
      response.headers.get("Content-Length") ?? "",
      10,
    );

    const body = contentLength === 0 ? null : await response.json();

    this.logger.debug({ body }, "validating response");
    Value.Assert(responseSchema, body);

    return body;
  }
}

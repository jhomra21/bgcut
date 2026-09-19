export type AssetFetcher = {
  readonly fetch: (request: Request) => Promise<Response>;
};

export type R2ObjectMetadata = {
  readonly size: number;
  readonly httpEtag: string;
  readonly writeHttpMetadata: (headers: Headers) => void;
};

export type R2ObjectBody = R2ObjectMetadata & {
  readonly body: ReadableStream<Uint8Array>;
};

export type R2BucketBinding = {
  readonly head: (key: string) => Promise<R2ObjectMetadata | null>;
  readonly get: (key: string) => Promise<R2ObjectBody | null>;
};

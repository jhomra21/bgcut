import { Effect } from "effect";

import { formatBackgroundRemovalError, formatImageError } from "./errors";
import { decodeImage } from "./image";
import {
  removeBackground,
  type BackgroundRemovalResult,
} from "./inference";

export type DecodeBrowserImageResult =
  | {
      readonly ok: true;
      readonly dimensions: {
        readonly width: number;
        readonly height: number;
      };
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export type RemoveBrowserBackgroundResult =
  | {
      readonly ok: true;
      readonly result: BackgroundRemovalResult;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export const decodeBrowserImage = (
  file: File,
): Promise<DecodeBrowserImageResult> =>
  Effect.runPromise(
    decodeImage(file).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message: formatImageError(error),
        }),
        onSuccess: (dimensions) => ({
          ok: true as const,
          dimensions,
        }),
      }),
    ),
  );

export const removeBrowserBackground = (
  file: File,
): Promise<RemoveBrowserBackgroundResult> =>
  Effect.runPromise(
    removeBackground(file).pipe(
      Effect.match({
        onFailure: (error) => ({
          ok: false as const,
          message: formatBackgroundRemovalError(error),
        }),
        onSuccess: (result) => ({
          ok: true as const,
          result,
        }),
      }),
    ),
  );

export type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>;

export async function* mapSequential<T, R>(
  values: MaybeAsyncIterable<T>,
  operation: (value: T) => Promise<R>,
): AsyncGenerator<R> {
  for await (const value of values) {
    yield await operation(value);
  }
}

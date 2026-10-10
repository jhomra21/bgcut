/** Minimal Float16 helpers for independent WebGPU model benchmarks. */
export const floatToHalf = (values: Float32Array): Uint16Array => {
  const output = new Uint16Array(values.length);
  const scratch = new ArrayBuffer(4);
  const float = new Float32Array(scratch);
  const bits = new Uint32Array(scratch);

  for (let index = 0; index < values.length; index += 1) {
    float[0] = values[index] ?? 0;

    const raw = bits[0] ?? 0;
    const sign = (raw >>> 16) & 0x8000;
    const exponent = ((raw >>> 23) & 0xff) - 127 + 15;
    const mantissa = raw & 0x7fffff;

    if (exponent >= 31) {
      output[index] = sign | 0x7c00 | (mantissa === 0 ? 0 : 0x0200);
    } else if (exponent <= 0) {
      if (exponent < -10) {
        output[index] = sign;
      } else {
        const subnormal = (mantissa | 0x800000) >>> (1 - exponent);
        const rounded = (subnormal + 0x0fff + ((subnormal >>> 13) & 1)) >>> 13;
        output[index] = sign | rounded;
      }
    } else {
      const rounded = mantissa + 0x0fff + ((mantissa >>> 13) & 1);
      output[index] = sign | ((exponent + (rounded >>> 23)) << 10) |
        ((rounded >>> 13) & 0x3ff);
    }
  }

  return output;
};

export const halfToFloat = (half: number): number => {
  const sign = (half & 0x8000) ? -1 : 1;
  const exponent = (half >>> 10) & 0x1f;
  const mantissa = half & 0x3ff;

  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN;

  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);

  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
};

export const halfArray = (input: Uint16Array): Float32Array =>
  Float32Array.from(input, halfToFloat);

export const channelsToHalfTokens = (
  input: Uint16Array,
  channels: number,
  spatial: number,
): Uint16Array => {
  if (input.length !== channels * spatial) {
    throw new Error("Feature channels do not match the expected token geometry.");
  }

  const result = new Uint16Array(input.length);

  for (let channel = 0; channel < channels; channel += 1) {
    for (let position = 0; position < spatial; position += 1) {
      result[position * channels + channel] = input[channel * spatial + position];
    }
  }

  return result;
};

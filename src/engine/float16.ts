const float16BitsToFloat32 = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;

  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 1024);
  }

  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }

  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
};

export const fp16BitsToFloat32Array = (values: Uint16Array): Float32Array => {
  const result = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    result[index] = float16BitsToFloat32(values[index]);
  }

  return result;
};

export const float16ViewToFloat32Array = (view: ArrayBufferView): Float32Array | undefined => {
  if (view instanceof Uint16Array) {
    return fp16BitsToFloat32Array(view);
  }

  if (view.constructor.name !== "Float16Array") {
    return undefined;
  }

  return Float32Array.from(view as unknown as ArrayLike<number>);
};

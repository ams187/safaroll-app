/**
 * return a value that has been rounded to a set precision
 * @param {Number} value the value to round
 * @param {Number} precision the precision (decimal places), default: 3
 * @returns {Number}
 */
export const round = (value: number, precision: number = 3): number => {
  "worklet";
  return parseFloat(value.toFixed(precision));
};

/**
 * return a value that has been limited between min & max
 * @param {Number} value the value to clamp
 * @param {Number} min minimum value to allow, default: 0
 * @param {Number} max maximum value to allow, default: 100
 * @returns {Number}
 */
export const clamp = (value: number, min: number = 0, max: number = 100): number => {
  "worklet";
  return Math.min(Math.max(value, min), max);
};

/**
 * return a value that has been re-mapped according to the from/to
 * - for example, adjust(10, 0, 100, 100, 0) = 90
 * @param {Number} value the value to re-map (or adjust)
 * @param {Number} fromMin min value to re-map from
 * @param {Number} fromMax max value to re-map from
 * @param {Number} toMin min value to re-map to
 * @param {Number} toMax max value to re-map to
 * @returns {Number}
 */
export const adjust = (
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number
): number => {
  "worklet";
  return round(toMin + (toMax - toMin) * (value - fromMin) / (fromMax - fromMin));
};

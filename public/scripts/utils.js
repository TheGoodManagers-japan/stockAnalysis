function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

export { toNumber };

function computeScore(data) {
  const { peRatio, pbRatio, eps, price, sentimentScore } = data;
  return peRatio + pbRatio + eps + sentimentScore; // Simple example scoring logic
}

export { computeScore };

/** Validation rules that accept the tiny articles used by tests that are not about the quality gate. */
export const lenientQuality = {
  maxAttempts: 0,
  rules: {
    minWords: 1,
    maxWords: 1_000_000,
    minH2: 0,
    minOutlineCoverage: 0,
    minEditRatio: 0.0001,
    maxEditRatio: 10_000
  }
};

import { describe, expect, it } from "vitest";
import { chartLabel } from "../src/lib/format";
import { axisLabelIndices } from "../src/components/charts";

/**
 * The stored series grew (traffic keeps its history now, review scores accrue a
 * day a time), and these are the two things that decide whether a longer series
 * reads as *more information* or as noise: what each bar's label says, and how
 * many of those labels the axis can show before they overlap into a smear.
 */

describe("chartLabel", () => {
  it("shortens the dates the scans store", () => {
    // SimilarWeb labels its monthly series on the 1st — a month, not a day.
    expect(chartLabel("2026-06-01")).toBe("Jun");
    expect(chartLabel("2026-10")).toBe("Oct");
    // Anything else dated is a single reading: one day's GEO score, one sync's
    // review score.
    expect(chartLabel("2026-10-02")).toBe("2 Oct");
    expect(chartLabel("2026-10-31")).toBe("31 Oct");
  });

  it("leaves labels that are not dates exactly as they are", () => {
    // Sample data already reads "Apr"; mixes label themselves in words.
    expect(chartLabel("Apr")).toBe("Apr");
    expect(chartLabel("Search organic")).toBe("Search organic");
    expect(chartLabel("")).toBe("");
  });

  it("returns a malformed date untouched rather than an empty axis label", () => {
    expect(chartLabel("2026-13-01")).toBe("2026-13-01");
    expect(chartLabel("2026-00-10")).toBe("2026-00-10");
  });
});

describe("axisLabelIndices", () => {
  it("labels every point while the series still fits", () => {
    expect(axisLabelIndices(6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(axisLabelIndices(1)).toEqual([0]);
    expect(axisLabelIndices(0)).toEqual([]);
  });

  it("spreads a long series' labels across the whole run, both ends included", () => {
    const picked = axisLabelIndices(12);

    expect(picked.length).toBeLessThanOrEqual(7);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(11);
    // No duplicates, and always left to right — a repeated index would draw one
    // label twice and skip another.
    expect(new Set(picked).size).toBe(picked.length);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });

  it("stays readable at the size a year of daily readings reaches", () => {
    const picked = axisLabelIndices(60);

    expect(picked.length).toBeLessThanOrEqual(7);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(59);
    // Labels are spread, not clumped at the start.
    expect(picked[1]).toBeGreaterThan(1);
  });
});

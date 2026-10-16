import { describe, expect, it } from "vitest";
import { isIsoDate, todayInBogota } from "./dates";

describe("todayInBogota", () => {
  it("is still today in Bogotá after 19:00 local, when UTC is already tomorrow", () => {
    const now = new Date("2026-10-17T01:30:00Z"); // 2026-10-16 20:30 in Bogotá
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-17");
    expect(todayInBogota(now)).toBe("2026-10-16");
  });

  it("rolls over at local midnight", () => {
    expect(todayInBogota(new Date("2026-10-17T04:59:59Z"))).toBe("2026-10-16");
    expect(todayInBogota(new Date("2026-10-17T05:00:00Z"))).toBe("2026-10-17");
  });
});

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-10-17")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-17T00:00:00Z")).toBe(false);
    expect(isIsoDate("17/10/2026")).toBe(false);
  });
});

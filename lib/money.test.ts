import { describe, expect, it } from "vitest";
import { fromDecimalString, lte, MoneyError, parseMinor, sum, toDisplay, type Amount } from "./money";

const usd = (value: string): Amount => ({ value, assetCode: "USD", assetScale: 2 });

describe("parseMinor", () => {
  it("parses integer strings", () => {
    expect(parseMinor("0")).toBe(0n);
    expect(parseMinor("1250")).toBe(1250n);
    expect(parseMinor("900719925474099312345")).toBe(900719925474099312345n);
  });

  it.each(["", "-1", "1.5", "1e3", " 12", "abc"])("rejects %j", (value) => {
    expect(() => parseMinor(value)).toThrow(MoneyError);
  });
});

describe("sum", () => {
  it("adds amounts of the same asset", () => {
    expect(sum([usd("100"), usd("200"), usd("50")])).toEqual(usd("350"));
  });

  it("returns a single amount unchanged", () => {
    expect(sum([usd("42")])).toEqual(usd("42"));
  });

  it("throws on asset code mismatch", () => {
    expect(() => sum([usd("1"), { value: "1", assetCode: "EUR", assetScale: 2 }])).toThrow(MoneyError);
  });

  it("throws on asset scale mismatch", () => {
    expect(() => sum([usd("1"), { value: "1", assetCode: "USD", assetScale: 6 }])).toThrow(MoneyError);
  });

  it("throws on an empty list", () => {
    expect(() => sum([])).toThrow(MoneyError);
  });
});

describe("lte", () => {
  it("compares values", () => {
    expect(lte(usd("100"), usd("300"))).toBe(true);
    expect(lte(usd("300"), usd("300"))).toBe(true);
    expect(lte(usd("301"), usd("300"))).toBe(false);
  });

  it("throws on asset mismatch", () => {
    expect(() => lte(usd("1"), { value: "1", assetCode: "MXN", assetScale: 2 })).toThrow(MoneyError);
  });
});

describe("toDisplay", () => {
  it("formats with the asset scale", () => {
    expect(toDisplay(usd("1250"))).toBe("12.50 USD");
    expect(toDisplay(usd("5"))).toBe("0.05 USD");
    expect(toDisplay(usd("0"))).toBe("0.00 USD");
    expect(toDisplay({ value: "1500", assetCode: "COP", assetScale: 0 })).toBe("1500 COP");
    expect(toDisplay({ value: "1", assetCode: "XRP", assetScale: 9 })).toBe("0.000000001 XRP");
  });
});

describe("fromDecimalString", () => {
  it("converts to minor units", () => {
    expect(fromDecimalString("12.5", 2)).toBe("1250");
    expect(fromDecimalString("12.50", 2)).toBe("1250");
    expect(fromDecimalString("3", 2)).toBe("300");
    expect(fromDecimalString("0.01", 2)).toBe("1");
    expect(fromDecimalString("007.10", 2)).toBe("710");
    expect(fromDecimalString("1500", 0)).toBe("1500");
  });

  it("rejects too many decimals", () => {
    expect(() => fromDecimalString("1.234", 2)).toThrow(MoneyError);
    expect(() => fromDecimalString("1.5", 0)).toThrow(MoneyError);
  });

  it.each(["-1", "-0.5", "+1", "", ".5", "1.", "1e2", "1,5", "abc"])("rejects %j", (input) => {
    expect(() => fromDecimalString(input, 2)).toThrow(MoneyError);
  });
});

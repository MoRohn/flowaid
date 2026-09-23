import { describe, expect, it } from "vitest";

import {
  UUID_V7_RE,
  formatUuid,
  isUuid,
  isUuidv7,
  uuidv7,
  uuidv7Bytes,
  uuidv7Timestamp,
} from "./ids.js";

describe("uuidv7", () => {
  it("produces canonical lower-case v7 strings with the RFC 4122 variant", () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = uuidv7();
      expect(id).toMatch(UUID_V7_RE);
      expect(id.length).toBe(36);
      expect(id[14]).toBe("7");
      expect(["8", "9", "a", "b"]).toContain(id[19]);
    }
  });

  it("embeds the millisecond timestamp in the first 48 bits", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    // The generator never regresses, so a burst inside one ms may borrow the next one.
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it("honours an explicit clock", () => {
    const fixed = Date.UTC(2030, 0, 1);
    const id = uuidv7(fixed + 1_000_000);
    expect(uuidv7Timestamp(id)).toBe(fixed + 1_000_000);
    expect(
      id.startsWith(
        Math.floor((fixed + 1_000_000) / 0x1_0000_0000)
          .toString(16)
          .padStart(4, "0"),
      ),
    ).toBe(true);
  });

  it("is strictly increasing lexicographically across a large burst", () => {
    const ids: string[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      ids.push(uuidv7());
    }
    for (let i = 1; i < ids.length; i += 1) {
      const prev = ids[i - 1];
      const curr = ids[i];
      if (prev === undefined || curr === undefined) {
        throw new Error("unreachable");
      }
      expect(curr > prev).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is monotonic within one millisecond and rolls into the next ms on counter overflow", () => {
    const fixed = Date.UTC(2031, 5, 1) + 5_000_000;
    const first = uuidv7(fixed);
    expect(uuidv7Timestamp(first)).toBe(fixed);
    let prev = first;
    let rolled = false;
    // The counter has at most 4096 values per ms; 5000 ids must borrow at least one ms.
    for (let i = 0; i < 5000; i += 1) {
      const next = uuidv7(fixed);
      expect(next > prev).toBe(true);
      const ts = uuidv7Timestamp(next);
      expect(ts === fixed || ts === fixed + 1 || ts === fixed + 2).toBe(true);
      if (ts > fixed) {
        rolled = true;
      }
      prev = next;
    }
    expect(rolled).toBe(true);
  });

  it("never regresses when the clock steps backwards", () => {
    const base = Date.UTC(2032, 0, 1) + 7_000_000;
    const a = uuidv7(base);
    const b = uuidv7(base - 60_000);
    const c = uuidv7(base - 1);
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
    expect(uuidv7Timestamp(b)).toBeGreaterThanOrEqual(base);
    expect(uuidv7Timestamp(c)).toBeGreaterThanOrEqual(base);
  });

  it("uuidv7Bytes returns 16 bytes with version and variant bits set", () => {
    const bytes = uuidv7Bytes();
    expect(bytes.length).toBe(16);
    expect(((bytes[6] ?? 0) & 0xf0) >>> 4).toBe(7);
    expect(((bytes[8] ?? 0) & 0xc0) >>> 6).toBe(0b10);
    expect(formatUuid(bytes)).toMatch(UUID_V7_RE);
  });

  it("formatUuid validates length", () => {
    expect(() => formatUuid(new Uint8Array(15))).toThrow(RangeError);
    expect(formatUuid(new Uint8Array(16))).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("isUuid / isUuidv7 / uuidv7Timestamp", () => {
  it("recognise canonical forms only", () => {
    const id = uuidv7();
    expect(isUuidv7(id)).toBe(true);
    expect(isUuid(id)).toBe(true);
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuidv7("123e4567-e89b-42d3-a456-426614174000")).toBe(false);
    expect(isUuidv7(id.toUpperCase())).toBe(false);
    expect(isUuidv7(id.replace(/-/g, ""))).toBe(false);
    expect(isUuidv7(42)).toBe(false);
    expect(isUuidv7(null)).toBe(false);
  });

  it("uuidv7Timestamp rejects non-v7 ids", () => {
    expect(() => uuidv7Timestamp("123e4567-e89b-42d3-a456-426614174000")).toThrow(TypeError);
    expect(uuidv7Timestamp("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).toBe(1645557742000);
  });
});

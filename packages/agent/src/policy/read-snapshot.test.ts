import { describe, expect, it } from "vitest";
import { ReadSnapshot } from "./read-snapshot.js";

const signal = new AbortController().signal;
const make = () => new ReadSnapshot("/approved", "a", [{ path: "math/SKILL.md", text: "approved" }]);

describe("immutable resource boundary", () => {
  it.each(["../secret", "/approved-other/math/SKILL.md", "/etc/passwd", "~/.env", "@/etc/passwd", "math/../math/SKILL.md", "math/./SKILL.md", "math\\SKILL.md", "math/secret\u0000", "/approved", "/dev/null", "math/.env", "math/missing.md"])("denies path %s", path => {
    expect(() => make().read(path, "a", signal)).toThrow("RESOURCE_DENIED");
  });

  it("accepts only admitted absolute or root-relative paths", () => {
    const snapshot = make();
    expect(snapshot.read("math/SKILL.md", "a", signal)).toBe("approved");
    expect(snapshot.read("/approved/math/SKILL.md", "a", signal)).toBe("approved");
  });

  it("copies strings and does not retain mutable admission entries", () => {
    const entry = { path: "math/SKILL.md", text: "original" };
    const snapshot = new ReadSnapshot("/approved", "a", [entry]);
    entry.text = "changed";
    expect(snapshot.read(entry.path, "a", signal)).toBe("original");
  });

  it("bounds count, bytes and duplicate paths at admission", () => {
    expect(() => new ReadSnapshot("/approved", "a", [{ path: "a", text: "x".repeat(65537) }])).toThrow("INVALID_SNAPSHOT");
    expect(() => new ReadSnapshot("/approved", "a", Array.from({ length: 33 }, (_, i) => ({ path: `a${i}`, text: "x" })))).toThrow("INVALID_SNAPSHOT");
    expect(() => new ReadSnapshot("/approved", "a", [{ path: "a", text: "x" }, { path: "a", text: "y" }])).toThrow("INVALID_SNAPSHOT");
  });

  it("rejects owner mismatch and abort before access", () => {
    const snapshot = make();
    expect(() => snapshot.read("math/SKILL.md", "b", signal)).toThrow("RESOURCE_DENIED");
    const controller = new AbortController();
    controller.abort(new Error("CANCELLED"));
    expect(() => snapshot.read("math/SKILL.md", "a", controller.signal)).toThrow("CANCELLED");
  });
});

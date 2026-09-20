import { expect, it } from "vitest";
import { cropPixels, dragCrop, fullCrop } from "./image-crop.js";
it("drags corners in image coordinates and clamps edges before they cross", () => {
  const crop = dragCrop(fullCrop, 'top-left', 50, 50, 500, 250);
  expect(crop).toEqual({ left: 10, top: 20, right: 100, bottom: 100 });
  expect(cropPixels(crop, 1000, 500)).toEqual({ originX: 100, originY: 100, width: 900, height: 400 });
  expect(dragCrop(crop, 'bottom-right', -1000, -1000, 500, 250)).toEqual({ left: 10, top: 20, right: 12, bottom: 22 });
  expect(dragCrop(crop, 'left', -1000, 0, 500, 250).left).toBe(0);
});
it("moves a selection without changing its size and stops at every image edge", () => {
  const crop = { left: 10, top: 20, right: 70, bottom: 80 };
  expect(dragCrop(crop, 'move', 100, 50, 500, 500)).toEqual({ left: 30, top: 30, right: 90, bottom: 90 });
  expect(dragCrop(crop, 'move', 1000, -1000, 500, 500)).toEqual({ left: 40, top: 0, right: 100, bottom: 60 });
  expect(dragCrop(crop, 'move', -1000, 1000, 500, 500)).toEqual({ left: 0, top: 40, right: 60, bottom: 100 });
  expect(dragCrop(crop, 'move', 1, 1, 0, 0)).toEqual(crop);
});
it("maps the selected preview region to original pixels without discarding boundary pixels", () => {
  expect(cropPixels({ left: 10, top: 20, right: 90, bottom: 80 }, 1200, 2000)).toEqual({ originX: 120, originY: 400, width: 960, height: 1200 });
  expect(cropPixels({ left: 1, top: 1, right: 99, bottom: 99 }, 101, 101)).toEqual({ originX: 1, originY: 1, width: 99, height: 99 });
});
it("rejects inverted, unbounded, tiny and excessive pixel regions", () => {
  for (const crop of [{ left: 90, top: 0, right: 10, bottom: 100 }, { left: -1, top: 0, right: 100, bottom: 100 }, { left: 0, top: 0, right: NaN, bottom: 100 }, { left: 0, top: 0, right: 1, bottom: 100 }]) expect(() => cropPixels(crop, 100, 100)).toThrow();
  expect(() => cropPixels({ left: 0, top: 0, right: 100, bottom: 100 }, 10000, 10000)).toThrow();
});

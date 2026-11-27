import test from "node:test";
import assert from "node:assert/strict";
import { sync } from "../public/modules/render/dropdown.js";

test("programmatic select updates the custom dropdown's visible label", () => {
  const label = { textContent: "自然日常" };
  const options = [{ textContent: "自然日常" }, { textContent: "轻松幽默" }, { textContent: "温柔陪伴" }];
  const select = {
    parentNode: { querySelector: (selector) => selector === ".select__label" ? label : null },
    options,
    selectedIndex: 1,
    get selectedOptions() { return [options[this.selectedIndex]]; }
  };
  sync(select);
  assert.equal(label.textContent, "轻松幽默");
});

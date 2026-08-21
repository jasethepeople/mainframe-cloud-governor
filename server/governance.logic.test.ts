import { describe, expect, it } from "vitest";
import { calculateFeeCents, isWastefulResource, selectApprovedActiveItems } from "./governance.logic";

describe("governance cost rules", () => {
  it("identifies only sufficiently idle and costly resources as waste", () => {
    expect(isWastefulResource({ idleHours: 72, monthlyCostCents: 2500 }, 2500)).toBe(true);
    expect(isWastefulResource({ idleHours: 71, monthlyCostCents: 9000 }, 2500)).toBe(false);
    expect(isWastefulResource({ idleHours: 800, monthlyCostCents: 2499 }, 2500)).toBe(false);
  });

  it("calculates configurable simulated savings fees in cents", () => {
    expect(calculateFeeCents(10_000, 1500)).toBe(1500);
    expect(calculateFeeCents(12_345, 1250)).toBe(1543);
    expect(calculateFeeCents(-100, 1500)).toBe(0);
  });

  it("selects only approved active resources for simulated shredding", () => {
    const items = [
      { resourceId: 1, decision: "approved", resourceStatus: "active" },
      { resourceId: 2, decision: "rejected", resourceStatus: "active" },
      { resourceId: 3, decision: "approved", resourceStatus: "shredded" },
    ];
    expect(selectApprovedActiveItems(items)).toEqual([{ resourceId: 1, decision: "approved", resourceStatus: "active" }]);
  });
});

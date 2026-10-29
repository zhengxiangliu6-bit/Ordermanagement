import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLanguage } from "../../i18n";
import { PermissionMatrix } from "./permission-matrix";

// jsdom defaults to English; the assertions use the Chinese labels.
setLanguage("zh");

describe("PermissionMatrix", () => {
  it("renders every permission scope as a group", () => {
    render(<PermissionMatrix value={new Set()} onChange={() => {}} />);
    expect(screen.getByText("订单")).toBeInTheDocument();
    expect(screen.getByText("发货")).toBeInTheDocument();
    expect(screen.getByText("审核策略")).toBeInTheDocument();
    // Spot-check one action label inside the orders group.
    expect(screen.getByText("手工建单")).toBeInTheDocument();
  });

  it("toggles a single permission and a whole scope", () => {
    const changes: Set<string>[] = [];
    render(
      <PermissionMatrix value={new Set()} onChange={(next) => changes.push(next)} />,
    );
    fireEvent.click(screen.getByText("手工建单"));
    expect(changes.at(-1)).toEqual(new Set(["orders:create-manual"]));

    // Scope header toggles every action in the scope.
    fireEvent.click(screen.getByText("订单"));
    const last = changes.at(-1)!;
    expect(last.has("orders:read")).toBe(true);
    expect(last.has("orders:review")).toBe(true);
    expect(last.has("items:read")).toBe(false);
  });
});

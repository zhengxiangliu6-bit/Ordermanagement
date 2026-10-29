import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { prepareBatch, VariantForm } from "./variant-form";
import type { ItemVariant } from "../../types/item";

describe("variant forms", () => {
  it("starts with no combinations and rejects duplicate option names and excessive batches", () => {
    expect(prepareBatch([{ name: "", values: "" }])).toMatchObject({
      valid: false,
      count: 0,
    });
    expect(
      prepareBatch([
        { name: "Color", values: "Black" },
        { name: " Color ", values: "White" },
      ]).valid,
    ).toBe(false);
    expect(
      prepareBatch([
        {
          name: "Size",
          values: Array.from({ length: 101 }, (_, i) => String(i)).join(","),
        },
      ]).valid,
    ).toBe(false);
    const values = Array.from({ length: 15 }, (_, i) => String(i)).join(",");
    expect(
      prepareBatch([
        { name: "Color", values },
        { name: "Size", values },
      ]).valid,
    ).toBe(false);
  });
  it("previews the actual combinations and deduplicates repeated values", () => {
    const batch = prepareBatch([
      { name: "Color", values: "Black， White, Black" },
      { name: "Size", values: "S,M" },
    ]);
    expect(batch).toMatchObject({
      valid: true,
      count: 4,
      names: ["Black / S", "Black / M", "White / S", "White / M"],
    });
  });
  it("edits both names and explicitly clears removed options without dropping images", () => {
    const onSubmit = vi.fn();
    const variant = {
      id: "v1",
      itemCode: "ATK-123",
      name: "黑色",
      nameEn: "Black",
      optionValues: { Color: "Black" },
      images: ["https://example.com/black.jpg"],
    } as unknown as ItemVariant;
    render(
      <VariantForm
        variant={variant}
        busy={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Chinese name/)).toHaveValue("黑色");
    fireEvent.change(screen.getByLabelText(/English/), {
      target: { value: "Black updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "黑色",
      nameEn: "Black updated",
      images: ["https://example.com/black.jpg"],
      optionValues: {},
    });
  });
  it("prevents saving duplicate specification names", () => {
    const variant = {
      name: "Test",
      nameEn: "",
      optionValues: { Color: "Black", Size: "M" },
    } as unknown as ItemVariant;
    render(
      <VariantForm
        variant={variant}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Option name 2" }), {
      target: { value: " Color " },
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

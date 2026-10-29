import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api-client/client";
import { VariantsSection } from "./variants-section";
import type { Item } from "../../types/item";

vi.mock("../../api-client/client", () => ({
  api: { POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}));
const item = {
  id: "item1",
  name: "商品",
  variants: [
    {
      id: "v1",
      itemCode: "ATK-123",
      name: "黑色",
      nameEn: "Black",
      optionValues: {},
      images: [],
    },
  ],
} as unknown as Item;

beforeEach(() => vi.clearAllMocks());

describe("variant dialog workflows", () => {
  it("opens a separate edit dialog and retains input when the server rejects a save", async () => {
    vi.mocked(api.PATCH).mockResolvedValue({
      response: new Response(null, { status: 400 }),
    } as never);
    render(
      <VariantsSection
        item={item}
        permissions={new Set(["items:update"])}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("heading", { name: "Edit variant" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Chinese name/), {
      target: { value: "新的名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("400"),
    );
    expect(screen.getByLabelText(/Chinese name/)).toHaveValue("新的名称");
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/items/{id}/variants/{variantId}",
      expect.objectContaining({
        body: {
          name: "新的名称",
          nameEn: "Black",
          optionValues: {},
          images: [],
        },
      }),
    );
  });

  it("lets an administrator create a variant with the same form and closes after success", async () => {
    vi.mocked(api.POST).mockResolvedValue({
      response: new Response(null, { status: 201 }),
    } as never);
    const onChanged = vi.fn();
    render(
      <VariantsSection
        item={item}
        permissions={new Set(["*"])}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    expect(
      screen.getByRole("button", { name: "Single variant" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText(/Chinese name/), {
      target: { value: "白色" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add variant" }).at(-1)!,
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("heading", { name: "Add variant" }),
    ).not.toBeInTheDocument();
  });
});

it("opens all variant images from a thumbnail without edit permission or eager display loads", () => {
  const first = `/api/v1/item-images/${"a".repeat(64)}/display.webp`;
  const second = `/api/v1/item-images/${"b".repeat(64)}/display.webp`;
  const withImages = {
    ...item,
    variants: [{ ...item.variants![0], images: [first, second] }],
  } as unknown as Item;
  const navigate = vi.fn();
  const { container } = render(
    <div onClick={navigate}>
      <VariantsSection
        item={withImages}
        permissions={new Set()}
        onChanged={vi.fn()}
      />
    </div>,
  );
  const thumbnail = screen.getByRole("button", {
    name: "Preview images: 黑色",
  });
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    first.replace("display.webp", "thumbnail.webp"),
  );
  thumbnail.focus();
  fireEvent.click(thumbnail);
  const dialog = screen.getByRole("dialog", { name: "Preview images: 黑色" });
  expect(dialog.querySelector("img")).toHaveAttribute("src", first);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(dialog.querySelector("img")).toHaveAttribute("src", second);
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(dialog.querySelector("img")).toHaveAttribute("src", first);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(thumbnail).toHaveFocus();
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(navigate).not.toHaveBeenCalled();
  expect(api.PATCH).not.toHaveBeenCalled();
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api-client/client";
import { CreateOrderForm } from "./orders-page";
import { CategorySelect } from "../items/category-select";
vi.mock("../../api-client/client", () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
}));
beforeEach(() => vi.resetAllMocks());
function mount(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
it("updates the auto-filled name when switching products, and submits the chosen warehouse and variant", async () => {
  vi.mocked(api.GET).mockImplementation(
    async (path) =>
      ({
        response: new Response(null, { status: 200 }),
        data:
          path === "/api/v1/shipping-regions"
            ? [{ id: "r", name: "China", enabled: true, warehouse: "china" }]
            : [
                {
                  id: "a",
                  name: "Red",
                  itemCode: "A",
                  item: { id: "pa", name: "Product A" },
                  stocks: [{ warehouse: "china", quantity: 5 }],
                },
                {
                  id: "b",
                  name: "Blue",
                  itemCode: "B",
                  item: { id: "pb", name: "Product B" },
                  stocks: [{ warehouse: "china", quantity: 0 }],
                },
              ],
      }) as never,
  );
  vi.mocked(api.POST).mockResolvedValue({
    response: new Response(null, { status: 201 }),
    data: { id: "o" },
  } as never);
  const done = vi.fn();
  const { container } = mount(
    <CreateOrderForm initialRegionId="r" onDone={done} onError={vi.fn()} />,
  );
  await screen.findByRole("option", { name: /Red \(A\)/ });
  expect(api.GET).toHaveBeenCalledWith(
    "/api/v1/item-variants",
    expect.objectContaining({
      params: { query: { search: undefined, warehouse: "china" } },
    }),
  );
  const picker = screen
    .getAllByRole("combobox")
    .find((select) => select.id !== "manual-region")!;
  fireEvent.change(picker, { target: { value: "a" } });
  expect(screen.getByDisplayValue("Product A · Red")).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "b" } });
  expect(screen.getByDisplayValue("Product B · Blue")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Blue \(B\)/ })).toHaveTextContent(
    /Out of stock/,
  );
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(done).toHaveBeenCalledWith("o"));
  expect(api.POST).toHaveBeenCalledWith(
    "/api/v1/orders",
    expect.objectContaining({
      body: expect.objectContaining({
        shippingRegionId: "r",
        lines: [{ title: "Product B · Blue", quantity: 1, itemVariantId: "b" }],
      }),
    }),
  );
});
it("retains an existing category while its options load and supports clearing it", async () => {
  let finish!: (value: never) => void;
  vi.mocked(api.GET).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { container } = mount(
    <form>
      <CategorySelect id="category" defaultValue="c" />
    </form>,
  );
  expect(new FormData(container.querySelector("form")!).get("categoryId")).toBe(
    "c",
  );
  finish({
    response: new Response(null, { status: 200 }),
    data: [{ id: "c", name: "Attaky", enabled: true }],
  } as never);
  await screen.findByRole("option", { name: "Attaky" });
  expect(screen.getByRole("combobox")).toHaveValue("c");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(new FormData(container.querySelector("form")!).get("categoryId")).toBe(
    "",
  );
});

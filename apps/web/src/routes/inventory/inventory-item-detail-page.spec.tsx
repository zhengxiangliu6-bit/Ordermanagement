import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api-client/client";
import InventoryItemDetailPage from "./inventory-item-detail-page";

vi.mock("../../api-client/client", () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
}));
const photo = `/api/v1/item-images/${"a".repeat(64)}/display.webp`;
const product = {
  id: "item1",
  name: "Product",
  nameEn: "",
  archivedAt: null,
  images: [photo],
  variants: [
    {
      id: "a",
      name: "Archived in China",
      nameEn: "",
      archivedAt: null,
      images: [photo, `/api/v1/item-images/${"b".repeat(64)}/display.webp`],
      low: false,
      stocks: [
        {
          warehouse: "china",
          quantity: 2,
          archivedAt: "2026-10-29",
          lowThreshold: null,
        },
        {
          warehouse: "canada",
          quantity: 5,
          archivedAt: null,
          lowThreshold: null,
        },
      ],
    },
    {
      id: "b",
      name: "Active without image",
      nameEn: "",
      archivedAt: null,
      images: [],
      low: true,
      stocks: [
        { warehouse: "china", quantity: 10, archivedAt: null, lowThreshold: 0 },
        { warehouse: "canada", quantity: 0, archivedAt: null, lowThreshold: 3 },
      ],
    },
    {
      id: "c",
      name: "Catalog archived",
      nameEn: "",
      archivedAt: "2026-10-29",
      images: [],
      stocks: [],
    },
  ],
};
function show(warehouse: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        id: "root",
        loader: () => ({
          user: { permissions: ["inventory:read", "inventory:manage"] },
        }),
        element: <Outlet />,
        children: [
          { path: "/inventory/:id", element: <InventoryItemDetailPage /> },
        ],
      },
    ],
    {
      initialEntries: [`/inventory/item1?warehouse=${warehouse}`],
      hydrationData: {
        loaderData: {
          root: {
            user: { permissions: ["inventory:read", "inventory:manage"] },
          },
        },
      },
    },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.GET).mockImplementation(
    async (path) =>
      ({
        data:
          path === "/api/v1/inventory/items"
            ? [product]
            : { rows: [], total: 0, page: 1, pageSize: 10 },
        response: new Response(null, { status: 200 }),
      }) as never,
  );
});

describe("warehouse product detail", () => {
  it("hides China-archived and catalog-archived variants while retaining movement history filters", async () => {
    show("china");
    expect(
      await screen.findByRole("link", { name: "Active without image" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Archived in China" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Catalog archived" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Low stock", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Preview images: Active without image",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Archived in China" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View image 1" }));
    expect(
      screen
        .getByRole("dialog", { name: "Preview images: Product" })
        .querySelector("img"),
    ).toHaveAttribute("src", photo);
  });

  it("keeps the same variant visible in Canada and previews its own multiple images", async () => {
    show("canada");
    expect(
      await screen.findByRole("link", { name: "Archived in China" }),
    ).toHaveAttribute("href", "/inventory/variant/a?warehouse=canada");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview images: Archived in China" }),
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { api } from "../../api-client/client";
import ItemsPage from "./items-page";

vi.mock("../../api-client/client", () => ({ api: { GET: vi.fn() } }));

it("previews product images from the list without navigating the row", async () => {
  const photo = `/api/v1/item-images/${"a".repeat(64)}/display.webp`;
  vi.mocked(api.GET).mockResolvedValue({
    data: {
      items: [
        {
          id: "item1",
          name: "Product with image",
          nameEn: "",
          images: [photo],
          updatedAt: "2026-10-29",
          _count: { variants: 1, notes: 0 },
        },
        {
          id: "item2",
          name: "Product without image",
          images: [],
          updatedAt: "2026-10-29",
        },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    },
    response: new Response(null, { status: 200 }),
  } as never);
  const router = createMemoryRouter(
    [
      {
        id: "root",
        loader: () => ({ user: { permissions: ["items:read"] } }),
        element: <Outlet />,
        children: [{ path: "/items", element: <ItemsPage /> }],
      },
    ],
    {
      initialEntries: ["/items"],
      hydrationData: {
        loaderData: { root: { user: { permissions: ["items:read"] } } },
      },
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const preview = await screen.findByRole("button", {
    name: "Preview images: Product with image",
  });
  expect(preview.querySelector("img")).toHaveAttribute(
    "src",
    photo.replace("display.webp", "thumbnail.webp"),
  );
  expect(
    screen.queryByRole("button", {
      name: "Preview images: Product without image",
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(preview);
  expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
    "src",
    photo,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(router.state.location.pathname).toBe("/items");
});

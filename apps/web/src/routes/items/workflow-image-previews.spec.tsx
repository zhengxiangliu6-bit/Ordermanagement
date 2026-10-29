import OrderDetailPage from "../orders/order-detail-page";
import { Modal } from "../../components/modal";
import { LineImagePreviews } from "./line-image-previews";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api-client/client";
import MappingPage from "../mapping/mapping-page";
import ShippingWorkPage from "../shipping-work/shipping-work-page";
import { NewOrderReviewCard } from "../review/new-order-card";

vi.mock("../../api-client/client", () => ({ api: { GET: vi.fn() } }));
const photo = `/api/v1/item-images/${"a".repeat(64)}/display.webp`;
const line = {
  id: "line",
  title: "Historical variant",
  quantity: 1,
  variantImages: [photo],
  variantImageSource: "snapshot" as const,
  platformVariantImages: [],
  platformProductImages: [],
};
function show(element: ReactNode, path = "/", entry = "/") {
  const user = {
    permissions: [
      "items:read",
      "mapping:read",
      "mapping:manage",
      "shipping:read",
      "shipping:weigh",
      "shipping:inspect",
    ],
  };
  const router = createMemoryRouter(
    [{ id: "root", element: <Outlet />, children: [{ path, element }] }],
    {
      initialEntries: [entry],
      hydrationData: { loaderData: { root: { user } } },
    },
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});

describe("workflow image previews", () => {
  it.each(["packing", "ordering", "inspection"] as const)(
    "does not display image previews in the %s work queue",
    async (tab) => {
      vi.mocked(api.GET).mockImplementation(
        async (path) =>
          ({
            data: String(path).includes("shipping-work/")
              ? [
                  {
                    id: "order",
                    displayNumber: "#100",
                    stage: tab,
                    customerSnapshot: {},
                    lines: [line],
                    shipments: [],
                  },
                ]
              : [],
            response: new Response(null, { status: 200 }),
          }) as never,
      );
      show(<ShippingWorkPage tab={tab} />);
      await screen.findByText("Historical variant");
      expect(
        screen.queryByRole("button", { name: /Preview images:/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not display image previews in unfulfilled-order review", () => {
    show(
      <NewOrderReviewCard
        record={{
          id: "review",
          subjectId: "order",
          createdAt: new Date().toISOString(),
          payload: { order: { displayNumber: "#100", lines: [line] } },
        }}
        categories={[]}
        shippingRegions={[]}
        storeName={null}
        platform={null}
        canCancel={false}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByText("Historical variant")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Preview images:/ }),
    ).not.toBeInTheDocument();
  });

  it("shows order detail previews, including labeled current references for legacy empty snapshots", async () => {
    const order = {
      id: "order",
      displayNumber: "#100",
      source: "manual",
      stage: "review",
      statusRaw: {},
      createdAt: "2026-10-29",
      customerSnapshot: {},
      stageEvents: [],
      problemItems: [],
      notes: [],
      revisions: [],
      lines: [
        {
          ...line,
          variantImages: [],
          currentVariantImages: [
            photo,
            photo.replace("a".repeat(64), "b".repeat(64)),
          ],
          currentProductImages: [photo],
          productImages: [],
        },
      ],
    };
    vi.mocked(api.GET).mockImplementation(
      async (path) =>
        ({
          data: path === "/api/v1/orders/{id}" ? order : [],
          response: new Response(null, { status: 200 }),
        }) as never,
    );
    show(<OrderDetailPage />, "/orders/:id", "/orders/order");
    const preview = await screen.findByRole("button", {
      name: "Preview images: Historical variant · System variant · current image",
    });
    expect(
      screen.getByRole("button", {
        name: "Preview images: Historical variant · System product · current image",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Preview images: Historical variant · System variant · order snapshot",
      }),
    ).not.toBeInTheDocument();
    expect(preview.querySelector("img")).toHaveAttribute(
      "src",
      photo.replace("display.webp", "thumbnail.webp"),
    );
    fireEvent.click(preview);
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      photo,
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("compares platform photos with the selected internal variant before mapping", async () => {
    vi.mocked(api.GET).mockImplementation(
      async (path) =>
        ({
          data:
            path === "/api/v1/mapping/queue"
              ? [
                  {
                    id: "listing",
                    externalVariantId: "external",
                    listingTitle: "Platform item",
                    platformVariantImages: ["https://example.com/platform.jpg"],
                    listing: {
                      id: "p",
                      status: "active",
                      store: { id: "store", displayName: "Shop" },
                    },
                    orderLines: [],
                  },
                ]
              : path === "/api/v1/item-variants"
                ? [
                    {
                      id: "variant",
                      itemCode: "ATK-1",
                      name: "System variant",
                      images: [photo],
                      item: { id: "item", name: "Internal item" },
                    },
                  ]
                : [],
          response: new Response(null, { status: 200 }),
        }) as never,
    );
    show(<MappingPage />);
    await screen.findByText("Platform item");
    fireEvent.change(screen.getByLabelText("Item variant"), {
      target: { value: "variant" },
    });
    expect(
      screen.getByRole("button", {
        name: "Preview images: Platform item · Platform variant images",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Preview images: System variant · System variant · current image",
      }),
    );
    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
      "src",
      photo,
    );
  });
});

it("closes an image preview without dismissing its confirmation dialog", () => {
  const closeConfirmation = vi.fn();
  show(
    <Modal title="Confirmation dialog" onClose={closeConfirmation}>
      <LineImagePreviews line={line} name="Variant" />
    </Modal>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Preview images: Variant · System variant · order snapshot",
    }),
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Confirmation dialog" }),
  ).toBeInTheDocument();
  expect(closeConfirmation).not.toHaveBeenCalled();
});

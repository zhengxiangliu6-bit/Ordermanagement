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
function show(element: ReactNode) {
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
    [{ id: "root", element: <Outlet />, children: [{ path: "/", element }] }],
    {
      initialEntries: ["/"],
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
  it.each(["packing", "inspection"] as const)(
    "shows snapshot images in the %s work queue",
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
      const preview = await screen.findByRole("button", {
        name: "Preview images: Historical variant · System variant · order snapshot",
      });
      expect(preview.querySelector("img")).toHaveAttribute(
        "src",
        photo.replace("display.webp", "thumbnail.webp"),
      );
      fireEvent.click(preview);
      expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
        "src",
        photo,
      );
    },
  );

  it("uses enriched order lines in new-order review instead of stale payload products", () => {
    show(
      <NewOrderReviewCard
        record={{
          id: "review",
          subjectId: "order",
          createdAt: new Date().toISOString(),
          orderLines: [line],
          payload: {
            order: {
              displayNumber: "#100",
              lines: [{ title: "Stale payload", quantity: 1 }],
            },
          },
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
    expect(screen.queryByText("Stale payload")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Preview images: Historical variant · System variant · order snapshot",
      }),
    );
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      photo,
    );
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
    <Modal title="Confirm packing" onClose={closeConfirmation}>
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
    screen.getByRole("heading", { name: "Confirm packing" }),
  ).toBeInTheDocument();
  expect(closeConfirmation).not.toHaveBeenCalled();
});

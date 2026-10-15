import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import DashboardPage from "./dashboard";

const fakeUser = {
  id: "u-1",
  email: "admin@mjjktech.com",
  displayName: "Administrator",
  permissions: ["orders:read", "items:read"],
  isActive: true,
  mustChangePassword: false,
};

function renderDashboard() {
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "/",
        element: (
          <div data-testid="shell">
            <Outlet />
          </div>
        ),
        children: [{ index: true, element: <DashboardPage /> }],
      },
    ],
    {
      initialEntries: ["/"],
      // Provide the shell loader data directly: this test is a render
      // regression check for the index route, not a loader pipeline test.
      hydrationData: { loaderData: { root: { user: fakeUser } } },
    },
  );
  // The dashboard reads live counts, so it needs a QueryClient; queries
  // fail closed (counts render as 0) with retries disabled.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  // Regression: the index route must read the shell loader via
  // useRouteLoaderData("root"); useLoaderData() returned undefined here.
  it("renders the signed-in principal from the root loader data", async () => {
    renderDashboard();
    expect(await screen.findByText(/Administrator/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /dashboard/i }),
    ).toBeInTheDocument();
  });
});

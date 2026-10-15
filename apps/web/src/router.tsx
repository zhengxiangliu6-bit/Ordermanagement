import { createBrowserRouter } from "react-router";
import { rootLoader } from "./layouts/root-loader";
import { RootLayout } from "./layouts/root-layout";
import LoginPage from "./routes/login";
import { loginAction } from "./routes/login-action";
import { RouteErrorBoundary } from "./routes/route-error-boundary";
import { RequirePermission } from "./routes/require-permission";
import DashboardPage from "./routes/dashboard";
import ItemsPage from "./routes/items/items-page";
import ItemDetailPage from "./routes/items/item-detail-page";
import StoresPage from "./routes/stores/stores-page";
import UsersPage from "./routes/users/users-page";
import CarriersPage from "./routes/carriers/carriers-page";
import ChangePasswordPage from "./routes/change-password";
import AuditPage from "./routes/audit/audit-page";
import OrdersPage from "./routes/orders/orders-page";
import OrderDetailPage from "./routes/orders/order-detail-page";
import ReviewPage from "./routes/review/review-page";
import MappingPage from "./routes/mapping/mapping-page";
import ListingsPage from "./routes/listings/listings-page";
import ShipmentsPage from "./routes/shipments/shipments-page";
import ShippingSettingsPage from "./routes/settings/shipping-settings-page";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
    action: loginAction,
  },
  {
    // Session-restricted but outside the shell: users flagged for a forced
    // password change can only reach this route until they finish.
    path: "/change-password",
    element: <ChangePasswordPage />,
  },
  {
    id: "root",
    path: "/",
    element: <RootLayout />,
    loader: rootLoader,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "orders",
        element: (
          <RequirePermission permission="orders:read">
            <OrdersPage />
          </RequirePermission>
        ),
      },
      {
        path: "orders/:id",
        element: (
          <RequirePermission permission="orders:read">
            <OrderDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "items",
        element: (
          <RequirePermission permission="items:read">
            <ItemsPage />
          </RequirePermission>
        ),
      },
      {
        path: "items/:id",
        element: (
          <RequirePermission permission="items:read">
            <ItemDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "review",
        element: (
          <RequirePermission permission="orders:read">
            <ReviewPage />
          </RequirePermission>
        ),
      },
      {
        path: "mapping",
        element: (
          <RequirePermission permission="mapping:read">
            <MappingPage />
          </RequirePermission>
        ),
      },
      {
        path: "listings",
        element: (
          <RequirePermission permission="listings:read">
            <ListingsPage />
          </RequirePermission>
        ),
      },
      {
        path: "stores",
        element: (
          <RequirePermission permission="stores:read">
            <StoresPage />
          </RequirePermission>
        ),
      },
      {
        path: "users",
        element: (
          <RequirePermission permission="users:read">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: "carriers",
        element: (
          <RequirePermission permission="carrier-providers:read">
            <CarriersPage />
          </RequirePermission>
        ),
      },
      {
        path: "shipments",
        element: (
          <RequirePermission permission="shipping:read">
            <ShipmentsPage />
          </RequirePermission>
        ),
      },
      {
        path: "settings/shipping",
        element: (
          <RequirePermission permission="shipping:read">
            <ShippingSettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: "audit",
        element: (
          <RequirePermission permission="audit:read">
            <AuditPage />
          </RequirePermission>
        ),
      },
    ],
  },
]);

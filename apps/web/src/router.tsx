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
import ShippingSettingsPage from "./routes/settings/shipping-settings-page";
import CategoriesPage from "./routes/settings/categories-page";
import ShippingRegionsPage from "./routes/settings/shipping-regions-page";
import ShippingWorkPage from "./routes/shipping-work/shipping-work-page";
import InventoryPage, { InventoryRedirect } from "./routes/inventory/inventory-page";
import InventoryItemDetailPage from "./routes/inventory/inventory-item-detail-page";
import InventoryVariantDetailPage from "./routes/inventory/inventory-variant-detail-page";
import InventoryStocktakePage from "./routes/inventory/inventory-stocktake-page";
import ProblemItemsPage from "./routes/review/problem-items-page";

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
          <RequirePermission permission="orders:review">
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
        path: "settings/categories",
        element: (
          <RequirePermission permission="categories:read">
            <CategoriesPage />
          </RequirePermission>
        ),
      },
      {
        path: "settings/shipping-regions",
        element: (
          <RequirePermission permission="shipping:manage-settings">
            <ShippingRegionsPage />
          </RequirePermission>
        ),
      },
      {
        path: "review/problems",
        element: (
          <RequirePermission permission="shipping:issue-review">
            <ProblemItemsPage />
          </RequirePermission>
        ),
      },
      {
        path: "shipping-work/packing",
        element: (
          <RequirePermission permission="shipping:weigh">
            <ShippingWorkPage tab="packing" />
          </RequirePermission>
        ),
      },
      {
        path: "shipping-work/ordering",
        element: (
          <RequirePermission permission="shipping:backfill">
            <ShippingWorkPage tab="ordering" />
          </RequirePermission>
        ),
      },
      {
        path: "shipping-work/inspection",
        element: (
          <RequirePermission permission="shipping:inspect">
            <ShippingWorkPage tab="inspection" />
          </RequirePermission>
        ),
      },
      {
        path: "shipping-work/tail",
        element: (
          <RequirePermission permission="shipping:tail">
            <ShippingWorkPage tab="tail" />
          </RequirePermission>
        ),
      },
      {
        path: "inventory",
        element: <InventoryRedirect />,
      },
      {
        path: "inventory/china",
        element: (
          <RequirePermission anyOf={["inventory:read", "inventory:china:read"]}>
            <InventoryPage warehouse="china" />
          </RequirePermission>
        ),
      },
      {
        path: "inventory/canada",
        element: (
          <RequirePermission anyOf={["inventory:read", "inventory:canada:read"]}>
            <InventoryPage warehouse="canada" />
          </RequirePermission>
        ),
      },
      {
        path: "inventory/stocktake/china",
        element: (
          <RequirePermission anyOf={["inventory:manage", "inventory:china:manage"]}>
            <InventoryStocktakePage warehouse="china" />
          </RequirePermission>
        ),
      },
      {
        path: "inventory/stocktake/canada",
        element: (
          <RequirePermission anyOf={["inventory:manage", "inventory:canada:manage"]}>
            <InventoryStocktakePage warehouse="canada" />
          </RequirePermission>
        ),
      },
      {
        path: "inventory/:id",
        element: (
          <RequirePermission
            anyOf={[
              "inventory:read",
              "inventory:china:read",
              "inventory:canada:read",
            ]}
          >
            <InventoryItemDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "inventory/variant/:variantId",
        element: (
          <RequirePermission
            anyOf={[
              "inventory:read",
              "inventory:china:read",
              "inventory:canada:read",
            ]}
          >
            <InventoryVariantDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "shipping-work/needs-attention",
        element: (
          <RequirePermission permission="shipping:issue-review">
            <ShippingWorkPage tab="needs_attention" />
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

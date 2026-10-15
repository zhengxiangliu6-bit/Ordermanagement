import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import LoginPage from "./login";
import { loginAction } from "./login-action";

function renderLogin() {
  const router = createMemoryRouter(
    [{ path: "/login", element: <LoginPage />, action: loginAction }],
    { initialEntries: ["/login"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("LoginPage", () => {
  it("renders the application title and sign-in form", () => {
    renderLogin();
    expect(
      screen.getByRole("heading", { name: /attaky om/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });
});

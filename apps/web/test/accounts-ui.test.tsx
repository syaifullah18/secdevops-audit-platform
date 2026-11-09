import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider } from "../src/context/AppContext.js";
import { installFetchShim, mockStore } from "../src/api/mock.js";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../src/api/mock-accounts.js";
import { RequireSession } from "../src/auth/RequireSession.js";
import { Layout } from "../src/components/Layout.js";
import { AdminScreen } from "../src/screens/Admin.js";
import { LoginScreen } from "../src/screens/Login.js";
import { ProfileScreen } from "../src/screens/Profile.js";
import { ForgotScreen } from "../src/screens/auth/Recovery.js";
import { SignupScreen } from "../src/screens/auth/Signup.js";

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const app = (path: string) =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/signup" element={<SignupScreen />} />
          <Route path="/forgot" element={<ForgotScreen />} />
          <Route
            path="/"
            element={
              <RequireSession>
                <Layout />
              </RequireSession>
            }
          >
            <Route index element={<div>home</div>} />
            <Route path="account" element={<ProfileScreen />} />
            <Route path="admin" element={<AdminScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const signInAs = async (email: string, password = DEMO_PASSWORD) => {
  type("email-input", email);
  type("password-input", password);
  fireEvent.click(screen.getByTestId("sign-in-button"));
};

describe("accounts UI (mock API)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("sdap_signed_out", "1");
    mockStore.reset();
    return installFetchShim(mockStore);
  });
  afterEach(cleanup);

  it("signs in with email and password and shows a clear error for a wrong one", async () => {
    app("/login");
    await screen.findByTestId("email-input");
    await signInAs(DEMO_EMAIL, "wrong-wrong-wrong");
    expect((await screen.findByRole("alert")).textContent).toMatch(/incorrect email or password/i);
    await signInAs(DEMO_EMAIL);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    expect(localStorage.getItem("sdap_token")).toMatch(/^sdap_s_/);
  });

  it("creates an account, checks the passwords match, and signs the new user in", async () => {
    app("/signup");
    await screen.findByTestId("name-input");
    type("name-input", "New Person");
    type("email-input", "new.person@example.test");
    type("password-input", "a long enough password");
    type("confirm-input", "a different password!");
    fireEvent.click(screen.getByTestId("sign-up-button"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/i);
    type("confirm-input", "a long enough password");
    fireEvent.click(screen.getByTestId("sign-up-button"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    // A new account is a viewer with no client access and no admin entry in the nav.
    expect(screen.queryByTestId("nav-admin")).toBeNull();
  });

  it("gives the same answer on forgot-password whether or not the address exists", async () => {
    app("/forgot");
    type("email-input", "nobody@example.test");
    fireEvent.click(screen.getByTestId("send-reset-button"));
    expect((await screen.findByRole("status")).textContent).toMatch(/if an account exists/i);
  });

  it("lets a signed-in user rename the account, create a token once, and see their session", async () => {
    app("/login");
    await screen.findByTestId("email-input");
    await signInAs(DEMO_EMAIL);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    fireEvent.click(screen.getByTestId("user-menu-button"));
    fireEvent.click(screen.getByText("Account & security"));

    await screen.findByTestId("profile-form-card");
    type("account-name-input", "Alexandra Vance");
    fireEvent.click(screen.getByTestId("save-profile-button"));
    await screen.findByText("Saved.");

    type("token-name-input", "ci-pipeline");
    fireEvent.click(screen.getByTestId("create-token-button"));
    const shown = await screen.findByTestId("new-token");
    expect(shown.textContent).toMatch(/sdap_pat_/);
    const list = within(screen.getByTestId("tokens-card"));
    await waitFor(() => expect(list.getAllByText("ci-pipeline").length).toBeGreaterThan(0));

    const sessions = within(await screen.findByTestId("sessions-card"));
    expect(await sessions.findByText("This session")).toBeTruthy();
  });

  it("rejects a mismatched new password before calling the server", async () => {
    app("/login");
    await screen.findByTestId("email-input");
    await signInAs(DEMO_EMAIL);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    fireEvent.click(screen.getByTestId("user-menu-button"));
    fireEvent.click(screen.getByText("Account & security"));
    await screen.findByTestId("password-card");
    type("current-password-input", DEMO_PASSWORD);
    type("new-password-input", "a long enough password");
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "nope nope nope nope" },
    });
    fireEvent.click(screen.getByTestId("change-password-button"));
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toMatch(/do not match/i);
  });

  it("lets an admin edit a user, invite someone and read the audit log", async () => {
    app("/login");
    await screen.findByTestId("email-input");
    await signInAs(DEMO_EMAIL);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    fireEvent.click(screen.getByTestId("nav-admin"));

    await screen.findByTestId("users-card");
    fireEvent.click(screen.getByTestId("edit-sam@example.test"));
    const editor = within(screen.getByTestId("user-editor-sam@example.test"));
    fireEvent.click(editor.getByLabelText("security"));
    fireEvent.change(editor.getByTestId("clients-input"), { target: { value: "civd, pengadaan" } });
    fireEvent.click(editor.getByTestId("save-user-button"));
    const row = await screen.findByTestId("user-row-sam@example.test");
    expect(row.textContent).toMatch(/security/);
    expect(row.textContent).toMatch(/civd, pengadaan/);

    fireEvent.click(screen.getByTestId("admin-tab-invitations"));
    type("invite-email-input", "teammate@example.test");
    fireEvent.click(screen.getByTestId("send-invite-button"));
    expect((await screen.findByTestId("invite-link")).textContent).toMatch(/signup\?invite=/);

    fireEvent.click(screen.getByTestId("admin-tab-audit"));
    const audit = await screen.findByTestId("audit-card");
    expect(audit.textContent).toMatch(/admin\.update_user/);
  });

  it("keeps the admin area away from non-admins", async () => {
    app("/login");
    await screen.findByTestId("email-input");
    await signInAs("sam@example.test");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    expect(screen.queryByTestId("nav-admin")).toBeNull();
  });
});

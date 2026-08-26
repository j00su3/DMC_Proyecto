# app-shell Specification

## Purpose

SPA routing shell for `apps/web`: public (login) vs protected route layouts with typed guards, session bootstrap via `GET /api/auth/me`, logout, structured API client error handling, and the login screen. New capability (greenfield, no prior spec).

## Requirements

### Requirement: Route Guard Layout Split
The system MUST split routes into a public layout (login) and a protected layout (all other app routes) using TanStack Router typed routes, with a `beforeLoad` guard on the protected layout.

#### Scenario: Unauthenticated user requests protected route
- GIVEN no active session in the session context
- WHEN the user navigates to a protected route
- THEN the router redirects to `/login` before rendering the route

#### Scenario: Authenticated user requests public login route
- GIVEN an active session in the session context
- WHEN the user navigates to `/login`
- THEN the router redirects to the protected shell's default route

### Requirement: Session Bootstrap
On application load, the system MUST call `GET /api/auth/me` exactly once to determine session state before route guards evaluate, treating `401` as "no session" rather than an error.

#### Scenario: Valid session on load
- GIVEN a valid session cookie exists
- WHEN the SPA loads
- THEN `GET /api/auth/me` returns `200`, the session context is populated with `usuario`, and guards evaluate as authenticated

#### Scenario: No session on load
- GIVEN no valid session cookie exists
- WHEN the SPA loads
- THEN `GET /api/auth/me` returns `401`, the session context stays empty, and the router renders the public layout

### Requirement: Logout Action
The system MUST provide a logout action calling `POST /api/auth/logout`, clearing the session context and redirecting to `/login` regardless of response outcome.

#### Scenario: Logout from an authenticated session
- GIVEN an authenticated session context
- WHEN the user triggers logout
- THEN `POST /api/auth/logout` is called, the session context is cleared, and the router redirects to `/login`

### Requirement: Structured API Client Errors
`apps/web/src/api/client.ts` MUST parse the `{ error: { code, message, details? } }` envelope on any non-2xx response and throw a structured `ApiError` carrying `status`, `code`, `message`, and optional `details`, replacing the prior generic `Error('API request failed with status ${status}')`.

#### Scenario: Non-2xx response with error envelope
- GIVEN the API responds non-2xx with a valid error envelope body
- WHEN `apiFetch` processes the response
- THEN it throws an `ApiError` whose `code`/`details` match the envelope, not a generic string-message `Error`

#### Scenario: Non-2xx response with unparseable body
- GIVEN the API responds non-2xx with a body that is not valid JSON or does not match the envelope shape
- WHEN `apiFetch` processes the response
- THEN it throws an `ApiError` with the response `status` and the fallback `code` `UNEXPECTED_RESPONSE`, without crashing

### Requirement: Login Screen
The system MUST provide a login screen on a public route using `react-hook-form` with a `zod` resolver validating `email`/`password`, submitting to `POST /api/auth/login`, and on success populating the session context and navigating into the protected shell (or to change-password, per `password-change`).

#### Scenario: Successful login
- GIVEN valid credentials for an active, non-locked user
- WHEN the login form is submitted
- THEN the session context is populated from the response `usuario` and the router navigates away from `/login`

#### Scenario: Server rejects credentials
- GIVEN the login form is submitted with wrong credentials
- WHEN `POST /api/auth/login` returns `401 INVALID_CREDENTIALS`
- THEN the screen displays an error derived from the `ApiError` and the user stays on `/login`

#### Scenario: Locked account surfaces retry guidance
- GIVEN the login form is submitted for a locked account
- WHEN `POST /api/auth/login` returns `423 ACCOUNT_LOCKED` with `details.retryAfter`
- THEN the screen displays a message reflecting `retryAfter`, distinct from the generic invalid-credentials message

### Requirement: Client-Side Forced-Password-Change Redirect
WHEN the session context's `usuario.debe_cambiar_password` is `true`, the protected layout's guard MUST redirect any route other than change-password to the change-password route. This is a UX convenience and MUST NOT be relied upon as the enforcement mechanism — that authority is server-side (see `password-change`).

#### Scenario: Forced-change user requests an unrelated protected route
- GIVEN an authenticated session with `debe_cambiar_password = true`
- WHEN the user navigates to any protected route other than change-password
- THEN the router redirects to the change-password route

#### Scenario: Forced-change user reaches change-password directly
- GIVEN an authenticated session with `debe_cambiar_password = true`
- WHEN the user navigates to the change-password route
- THEN the router renders it without redirecting

### Requirement: Screens Built From Design Tokens, No Approved Mockup
Login and change-password screens MUST be implemented from `docs/design.md`'s documented tokens (colors, typography, radii, input/button styles), since no `.dc.html` wireframe exists in the repository for either screen; this MUST be noted in code/PR as not visually approved.

#### Scenario: Login background matches documented token
- GIVEN the login screen renders
- WHEN its background color is inspected
- THEN it matches the documented `#16233c` token

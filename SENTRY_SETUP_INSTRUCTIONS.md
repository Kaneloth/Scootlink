# Sentry Setup Instructions

## Step 1 — Create a Sentry account & project

1. Go to https://sentry.io and sign up (free plan is fine)
2. Create a new project → choose **React**
3. Copy the **DSN** string (looks like `https://abc123@o123.ingest.sentry.io/456`)

---

## Step 2 — Add the DSN to Netlify

1. Netlify Dashboard → your site → **Site settings → Environment variables**
2. Add a new variable:
   - Key: `VITE_SENTRY_DSN`
   - Value: *(paste your DSN here)*
3. Save and re-deploy

---

## Step 3 — Install the package

In your repo, add `@sentry/react` to your `package.json` dependencies:

```json
"@sentry/react": "^8.0.0"
```

Then run `npm install` (or `pnpm install`) locally and commit the updated
`package.json` and `package-lock.json` (or `pnpm-lock.yaml`).

---

## Step 4 — Drop in the new file

Copy `src/lib/sentry.js` into your repo at `src/lib/sentry.js`.

---

## Step 5 — Edit your `main.jsx`

Add **two things** to the top of `src/main.jsx`:

### a) Import at the very top (before everything else)

```js
import { initSentry } from '@/lib/sentry';
initSentry();                    // ← call immediately after import
```

### b) Wrap your root component in the Sentry error boundary

Find your `ReactDOM.createRoot(...).render(...)` call. It probably looks like:

```jsx
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Change it to:

```jsx
import { Sentry } from '@/lib/sentry';

root.render(
  <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please refresh.</p>}>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </Sentry.ErrorBoundary>
);
```

---

## Optional — Tag the logged-in user

In whichever file handles your login success (e.g. `Auth.jsx`, after
`supabase.auth.signIn` resolves), add:

```js
import { setUser } from '@/lib/sentry';

// after login succeeds:
setUser({ id: session.user.id, email: session.user.email });

// after logout:
setUser(null);
```

This makes every error in Sentry show which user was affected.

---

## What you get

- All unhandled JS errors and promise rejections captured automatically
- A short screen-recording replay attached to every error report
- Route-change performance tracking
- User identity on every error (if you add the optional step)

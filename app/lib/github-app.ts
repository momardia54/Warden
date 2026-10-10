/**
 * The GitHub App of a Warden install, created with GitHub's app manifest flow: Warden describes the app it needs,
 * the admin confirms it on GitHub, and GitHub hands the app's credentials back to Warden. Pure and client-safe.
 */

/** The cookie that ties GitHub's redirect back to the manifest this dashboard posted. */
export const STATE_COOKIE = "wd_github_state"

/** GitHub limits app names to 34 characters, and names are unique across GitHub. */
export const MAX_APP_NAME = 34

/** A default app name that is unlikely to be taken: "Warden" and the first label of the install's host name. */
export function defaultAppName(origin: string): string {
  const host = new URL(origin).hostname.split(".")[0] || "install"
  return `Warden ${host}`.slice(0, MAX_APP_NAME)
}

/** GitHub account and organisation names: letters, digits and single hyphens, up to 39 characters. */
export const ACCOUNT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

/**
 * The manifest posted to GitHub. The app can read repository contents (to download archives) and receives push
 * events (to see new tags), nothing else.
 */
export function appManifest(origin: string, name: string) {
  return {
    name: name.trim().slice(0, MAX_APP_NAME) || defaultAppName(origin),
    url: origin,
    description: "Publishes version tags as releases in Warden.",
    hook_attributes: { url: `${origin}/hooks/github-app`, active: true },
    redirect_url: `${origin}/integrations/github/callback`,
    setup_url: `${origin}/integrations/github/installed`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: ["push"],
  }
}

/** Where the manifest is posted: the admin's personal account, or an organisation they administer. */
export function manifestTarget(organization: string, state: string): string {
  const base = organization ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new` : "https://github.com/settings/apps/new"
  return `${base}?state=${encodeURIComponent(state)}`
}

/** A repository the app can access, as listed in the dashboard. */
export type AppRepository = { id: number; full_name: string; private: boolean; account: string }

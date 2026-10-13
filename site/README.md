# FlowAId site

Static landing page for [flowaid](https://github.com/MoRohn/flowaid), deployed to GitHub Pages at <https://morohn.github.io/flowaid/>.

The page is HTML, CSS and a small script. It does not use the docs site or the app build. Brand files (`brand/`) and the product screenshots (`docs/assets/screenshots/`) are copied in at build time, so they are not duplicated in git.

## Version

The visible release is the first `## x.y.z` heading in the root `CHANGELOG.md`. In the browser the page also asks the GitHub releases API for `MoRohn/flowaid` and, if that tag is the same or newer, shows it. If the request fails, or the published release is older than the changelog, the changelog version stays.

## Build

```sh
node site/build.mjs
```

Output is `site/dist/`. Asset URLs are relative, so the same files work at the domain root and under the `/flowaid/` project path. `SITE_URL` overrides the canonical and social URLs (the Pages workflow passes the `base_url` from `actions/configure-pages`).

`node site/build.mjs --og` re-renders `site/og.png` from `site/og.html` with Chrome. The card is 1200×630: the lockup, the tagline, the probability ruler, and the overview screenshot. The built page points `og:image`, `og:url` and `twitter:image` at absolute `https://` URLs, and the Pages artifact includes `og.png`.

## Preview

```sh
node site/build.mjs
node site/serve.mjs
```

Serves the build at <http://127.0.0.1:4173/flowaid/>. A request to `/` redirects there. Anything outside `/flowaid/` is not found, which is how a project site behaves.

## Deploy

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds and deploys on pushes to `main` that touch this directory, the workflow, `brand/`, `docs/assets/screenshots/` or `CHANGELOG.md`, and when the workflow is run by hand.

Before the first deploy, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The repository homepage URL should be `https://morohn.github.io/flowaid/`.

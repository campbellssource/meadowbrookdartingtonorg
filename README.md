# Meadowbrook Dartington

Astro-based website for Meadowbrook and the Dartington Recreation Association.

## Stack

- **[Astro](https://astro.build/)** — SSR (server-side rendering) with the Node adapter
- **[Keystatic](https://keystatic.com/)** — git-based CMS; local mode in development, GitHub mode in production
- **[Square Web Payments SDK](https://developer.squareup.com/docs/web-payments/overview)** — donation payments on `/donate`
- **[Acuity Scheduling](https://acuityscheduling.com/)** — embedded booking widget for bookable facilities
- **[Brevo](https://www.brevo.com/)** — mailing list subscription (newsletter sign-up)
- **Docker + [Google Cloud Run](https://cloud.google.com/run)** — containerised hosting on `europe-west2`
- **[Google Artifact Registry](https://cloud.google.com/artifact-registry)** — Docker image storage

## Development

```bash
npm install
npm run dev      # dev server + Keystatic CMS
npm run build    # production build
npm run preview  # preview production build
```

## Content Management

Content is managed via Keystatic at `/keystatic` during local development. All content is stored as YAML files in `src/content/`.

### Collections

| Collection | Path | Notes |
|---|---|---|
| Pages | `src/content/content-pages/` | General content pages |
| Facilities | `src/content/facilities/` | Each facility has a type: bookable, link, or generic |
| Misc pages | `src/content/misc-pages/` | Privacy policy etc. |
| Partners | `src/content/partners/` | "In partnership with" logos on homepage |
| With thanks to | `src/content/supporters/` | Supporter logos on homepage |

### Singletons

| Singleton | Path | Notes |
|---|---|---|
| Homepage | `src/content/homepage.yaml` | Hero heading, about preview, banners, partners intro |

## Facility Types

Each facility has one of three types, set in Keystatic:

- **Bookable** - embeds an Acuity Scheduling widget. Requires a `bookingCategory` that matches exactly in Acuity (e.g. `Snooker`, `Studio - Large room`, `Lounge - Small room`).
- **Link** - links out to an external website (e.g. Pizzalogica, Things Happen Here). Opens in a new tab.
- **Generic** - a standard content page with intro and body text.

## Room Booking

Bookable facilities embed the Acuity widget via `AcuityBooking.astro`:

```astro
<AcuityBooking category="Studio - Large room" />
```

Current booking categories: `Studio - Large room`, `Lounge - Small room`, `Snooker`

## Project Structure

```
public/
├── assets/          # Photos, illustrations, logos, textures
├── fonts/           # Brand fonts (Rexton, Billiard, Lobster)
├── images/
│   ├── facilities/  # Facility card images (600×750px WebP recommended)
│   ├── partners/    # Partner logos
│   └── supporters/  # Supporter logos
└── styles/
    └── global.css   # Design tokens, zone themes, all component styles
src/
├── components/
│   └── AcuityBooking.astro
├── content/         # All CMS content (YAML + mdoc files)
├── layouts/
│   └── Layout.astro # Main layout with nav, mobile menu, footer
├── lib/
│   └── zones.ts     # Maps facility slugs to zone CSS class names
└── pages/
    ├── facilities/
    │   ├── index.astro
    │   └── [slug].astro
    ├── index.astro
    ├── about.astro
    ├── contact.astro
    └── content/[slug].astro
```

## Deployment

### How it works

Every push to `main` triggers the **Deploy to Cloud Run** GitHub Actions workflow (`.github/workflows/deploy.yml`), which:

1. Authenticates to Google Cloud via Workload Identity Federation (no long-lived keys)
2. Builds a Docker image and pushes it to Artifact Registry (`europe-west2-docker.pkg.dev/meadowbrookdartington/meadowbrook/site`)
3. Deploys the image to Cloud Run (`meadowbrook-site`, region `europe-west2`)

The site runs as a Node.js SSR server on port 8080 inside the container. The Dockerfile uses a two-stage build — dependencies and the Astro build happen in the first stage; only the compiled output and runtime files are copied into the final image.

### Environment variables

Environment variables are set on Cloud Run at deploy time via `--update-env-vars` in the workflow. Sensitive values are stored in **Google Secret Manager** and mounted via `--update-secrets`.

| Variable | Where set | Purpose |
|---|---|---|
| `NODE_ENV` | Cloud Run env var | `production` |
| `ORIGIN` | Cloud Run env var | `https://meadowbrookdartington.org` |
| `KEYSTATIC_GITHUB_STORAGE` | Cloud Run env var | Enables GitHub mode for Keystatic CMS |
| `PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` | Cloud Run env var (deploy workflow) | Keystatic GitHub App identifier |
| `PUBLIC_SQUARE_APPLICATION_ID` | Cloud Run env var (deploy workflow) | Square Web Payments client ID |
| `PUBLIC_SQUARE_LOCATION_ID` | Cloud Run env var (deploy workflow) | Square location for payments |
| `PUBLIC_SQUARE_ENVIRONMENT` | Cloud Run env var (deploy workflow) | `production` or `sandbox` |
| `BREVO_API_KEY` | Secret Manager | Brevo mailing list API key |
| `BREVO_LIST_ID` | Cloud Run env var | Brevo list to subscribe contacts to |
| `KEYSTATIC_GITHUB_CLIENT_ID` | Secret Manager | Keystatic GitHub OAuth app |
| `KEYSTATIC_GITHUB_CLIENT_SECRET` | Secret Manager | Keystatic GitHub OAuth app |
| `KEYSTATIC_SECRET` | Secret Manager | Keystatic session signing secret |
| `SQUARE_ACCESS_TOKEN` | Secret Manager | Square server-side payments token |

> **Note:** `cloudbuild.yaml` exists in the repo but the associated Cloud Build trigger has been deleted — GitHub Actions is the sole deployment pipeline. Do not recreate the Cloud Build trigger; it would overwrite environment variables set by the workflow.

### Manual deploy

If you need to redeploy without a code change (e.g. to restore env vars), you can re-run the latest workflow from the Actions tab on GitHub, or run:

```bash
gcloud run deploy meadowbrook-site \
  --image=europe-west2-docker.pkg.dev/meadowbrookdartington/meadowbrook/site:latest \
  --region=europe-west2 \
  --project=meadowbrookdartington \
  --update-env-vars="PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=meadowbrook-keystatic,PUBLIC_SQUARE_APPLICATION_ID=sq0idp-SJPH8U9hBP8q9dM97RSZmA,PUBLIC_SQUARE_LOCATION_ID=LT08J54D3THKE,PUBLIC_SQUARE_ENVIRONMENT=production" \
  --update-secrets="SQUARE_ACCESS_TOKEN=SQUARE_ACCESS_TOKEN:latest"
```

**Always use `--update-env-vars` (not `--set-env-vars`) for manual deploys.** Using `--set-env-vars` replaces the entire env var list and will silently remove anything not specified.

### Automated content workflow

`.github/workflows/create-dra-social.yml` runs on the 1st of each month and creates the DRA Social event file for that month if it doesn't exist, then commits and pushes — which triggers a normal deploy.

## Design System

Styles live in `public/styles/global.css`. Each facility has a **zone theme** - a unique colour palette and typography style applied via a CSS class (e.g. `.zone-pool`, `.zone-snooker`). The mapping from facility slug to zone class is in `src/lib/zones.ts`.

Facility card images should be **600×750px** (4:5 ratio), WebP format, under ~150KB.

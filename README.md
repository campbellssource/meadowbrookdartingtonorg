# Meadowbrook Dartington

Astro-based website for Meadowbrook and the Dartington Recreation Association.

## Migration from Squarespace

This project is a migration from the existing Squarespace site at `meadowbrookdartington.org`.

### Site Crawling Strategy

The crawler script extracts content from the existing site:

```bash
# Preview what will be crawled (dry run)
npm run crawl:dry

# Run the full crawl
npm run crawl
```

**What the crawler does:**
1. Fetches all known pages and converts HTML to Markdown
2. Downloads all PDF documents (constitution, meeting minutes, etc.)
3. Extracts image URLs for manual download
4. Generates a `crawl-report.json` with the complete site inventory

**Pages to crawl:**
- `/` - Homepage
- `/about` - About the DRA
- `/pool` - Swimming pool
- `/bike-track` - Bike track
- `/snooker-room` - Snooker room (bookable)
- `/large-room` - Large room (bookable)
- `/small-room` - Small room (bookable)
- `/playground` - Playground
- `/playing-fields` - Playing fields
- `/woodland-and-brook` - Woodland area
- `/energy-hub` - Energy hub
- `/contact` - Contact page
- `/subscribe-to-updates` - Mailing list signup
- `/volunteer` - Volunteer form
- `/be-a-trustee` - Trustee application

### Manual Steps After Crawling

1. **Review extracted content** in `src/content/pages/`
2. **Download images manually** - Squarespace images require authentication
3. **Set up headless CMS** - Migrate markdown content to chosen CMS
4. **Configure forms** - Replace Squarespace forms with Netlify Forms or similar

## Room Booking (Acuity/Squarespace Scheduling)

Room bookings use the existing Acuity Scheduling widget:

```astro
---
import AcuityBooking from '../components/AcuityBooking.astro';
---

<AcuityBooking category="Studio - Large room" />
```

**Booking categories:**
- `Studio - Large room`
- `Lounge - Small room`
- `Snooker`

The widget ID is `4f74cd39` (configured in the component).

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
├── public/
│   ├── documents/     # PDFs (constitution, minutes, etc.)
│   └── images/        # Site images
├── src/
│   ├── components/
│   │   └── AcuityBooking.astro
│   ├── content/
│   │   ├── facilities/
│   │   ├── documents/
│   │   └── pages/
│   ├── layouts/
│   │   └── Layout.astro
│   ├── pages/
│   │   ├── facilities/
│   │   │   ├── index.astro
│   │   │   ├── large-room.astro
│   │   │   ├── small-room.astro
│   │   │   └── snooker-room.astro
│   │   ├── about.astro
│   │   ├── contact.astro
│   │   └── index.astro
│   └── scripts/
│       └── crawl-site.mjs
└── package.json
```

## Next Steps

### Phase 1: Content Migration
- [ ] Run site crawler
- [ ] Download and organize images
- [ ] Review and clean up extracted content
- [ ] Add missing facility pages (pool, bike-track, etc.)

### Phase 2: CMS Integration
- [ ] Choose CMS (Sanity, Decap CMS, or Contentful)
- [ ] Define content schemas for facilities, pages, documents
- [ ] Migrate content to CMS
- [ ] Set up preview/editing workflow

### Phase 3: Forms & Features
- [ ] Set up contact form handler (Netlify Forms, Formspree, etc.)
- [ ] Add mailing list subscription form
- [ ] Add volunteer/trustee application forms
- [ ] Configure analytics

### Phase 4: Deployment
- [ ] Set up hosting (Vercel, Netlify, or Cloudflare Pages)
- [ ] Configure custom domain
- [ ] Set up redirects from old URLs
- [ ] DNS switchover

## CMS Options

### Sanity (Recommended)
- Real-time collaborative editing
- Great for non-technical editors
- Generous free tier
- [sanity.io](https://www.sanity.io/)

### Decap CMS (Free, Git-based)
- Content stored in Git as Markdown
- No external dependencies
- Simpler but less powerful
- [decapcms.org](https://decapcms.org/)

### Contentful
- Enterprise-grade
- Good free tier for small sites
- [contentful.com](https://www.contentful.com/)

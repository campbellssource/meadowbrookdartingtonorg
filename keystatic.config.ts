import { config, collection, singleton, fields } from '@keystatic/core';

const richText = (label: string) =>
  fields.document({
    label,
    formatting: true,
    links: true,
    dividers: true,
  });

const richTextWithImages = (label: string) =>
  fields.document({
    label,
    formatting: true,
    links: true,
    dividers: true,
    images: {
      directory: 'public/images/facilities',
      publicPath: '/images/facilities/',
    },
  });

export default config({
  storage: {
    kind: 'github',
    repo: 'campbellssource/meadowbrookdartingtonorg',
  },

  singletons: {
    homepage: singleton({
      label: 'Homepage',
      path: 'src/content/homepage',
      format: { data: 'yaml' },
      schema: {
        heroHeading: fields.text({ label: 'Hero heading' }),
        heroSubtitle: fields.text({ label: 'Hero subtitle' }),
        heroCtaPrimaryLabel: fields.text({ label: 'Primary button label' }),
        heroCtaPrimaryUrl: fields.text({ label: 'Primary button URL' }),
        heroCtaSecondaryLabel: fields.text({ label: 'Secondary button label' }),
        heroCtaSecondaryUrl: fields.text({ label: 'Secondary button URL' }),
        introText: richText('Intro text'),
        eventsHeading: fields.text({ label: 'Events section heading' }),
        energyHubEyebrow: fields.text({ label: 'Energy Hub eyebrow label' }),
        energyHubTitle: fields.text({ label: 'Energy Hub title' }),
        energyHubBody: fields.text({ label: 'Energy Hub body', multiline: true }),
        energyHubCtaLabel: fields.text({ label: 'Energy Hub button label' }),
        energyHubCtaUrl: fields.text({ label: 'Energy Hub button URL' }),
        energyHubImage: fields.image({
          label: 'Energy Hub image',
          directory: 'public/images/energy-hub',
          publicPath: '/images/energy-hub/',
        }),
        aboutSectionEyebrow: fields.text({ label: 'About section eyebrow' }),
        aboutPreview: richText('About preview text'),
        partnersEyebrow: fields.text({ label: 'Partners eyebrow label' }),
        partnersHeading: fields.text({ label: 'Partners section heading' }),
        partnersIntro: fields.text({ label: 'Partners section intro', multiline: true }),
        supportersEyebrow: fields.text({ label: 'Supporters eyebrow label' }),
        supportersHeading: fields.text({ label: 'Supporters section heading' }),
        banners: fields.array(
          fields.object({
            title: fields.text({ label: 'Title' }),
            body: fields.text({ label: 'Body text', multiline: true }),
            link: fields.text({ label: 'Link URL' }),
            linkLabel: fields.text({ label: 'Link label' }),
            image: fields.image({
              label: 'Image',
              description: 'Photo shown on the right side of the banner. Landscape format works best.',
              directory: 'public/images/banners',
              publicPath: '/images/banners/',
            }),
          }),
          {
            label: 'Banners',
            itemLabel: props => props.fields.title.value || 'Untitled banner',
          }
        ),
      },
    }),

    projectsPage: singleton({
      label: 'Projects & Ideas page',
      path: 'src/content/projects-page',
      format: { data: 'yaml' },
      schema: {
        eyebrow: fields.text({ label: 'Eyebrow label', defaultValue: 'Look after Meadowbrook' }),
        heading: fields.text({ label: 'Page heading', defaultValue: 'Projects & Ideas' }),
        intro: fields.text({
          label: 'Intro paragraph',
          multiline: true,
          description: 'Sets the tone. Frame it as an invitation to get involved, not a list of problems.',
        }),
        howItWorks: fields.text({
          label: '"How it works" text',
          multiline: true,
          description: 'Short explanation of how someone can put their hand up or contribute.',
        }),
        contactEmail: fields.text({
          label: 'Email for "I want to help" enquiries',
          description: 'Where the "Get involved" buttons send people when a project has no named lead. e.g. contact@meadowbrookdartington.org',
        }),
        ideasHeading: fields.text({ label: 'Ideas section heading', defaultValue: 'Got an idea?' }),
        ideasBody: fields.text({
          label: 'Ideas section text',
          multiline: true,
          description: 'Encourage people to share ideas for the space, however unformed.',
        }),
        ideasButtonLabel: fields.text({ label: 'Ideas button label', defaultValue: 'Share an idea' }),
        ideasEmail: fields.text({
          label: 'Email for idea submissions',
          description: 'Where the "Share an idea" button sends people. e.g. ideas@meadowbrookdartington.org',
        }),
      },
    }),
  },

  collections: {
    pages: collection({
      label: 'Pages',
      slugField: 'title',
      path: 'src/content/content-pages/*',
      format: { data: 'yaml' },
      columns: ['seoDescription'],
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        seoDescription: fields.text({
          label: 'SEO description',
          multiline: true,
          description: 'Used in meta tags. Keep under 160 characters.',
        }),
        intro: richText('Introduction (lead text)'),
        body: richText('Main content'),
      },
    }),

    facilities: collection({
      label: 'Facilities',
      slugField: 'name',
      path: 'src/content/facilities/*',
      format: { data: 'yaml' },
      columns: ['image', 'order', 'shortDescription'],
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        order: fields.number({
          label: 'Display order',
          description: 'Controls the order facilities appear in listings and navigation. Lower numbers appear first.',
        }),
        shortDescription: fields.text({ label: 'Short description (used in listings)', multiline: true }),
        image: fields.image({
          label: 'Image',
          description: 'Shown on the facilities grid and facility page. Landscape format, ideally under 500KB.',
          directory: 'public/images/facilities',
          publicPath: '/images/facilities/',
        }),
        facilityType: fields.conditional(
          fields.select({
            label: 'Facility type',
            options: [
              { label: 'Bookable (embedded booking widget)', value: 'bookable' },
              { label: 'Linked (points to external site)', value: 'link' },
              { label: 'Generic page', value: 'generic' },
            ],
            defaultValue: 'generic',
          }),
          {
            bookable: fields.object({
              intro: richText('Introduction'),
              secondImage: fields.image({
                label: 'Second image (optional — shown below main image in header)',
                description: 'A second photo displayed stacked below the main facility image.',
                directory: 'public/images/facilities',
                publicPath: '/images/facilities/',
              }),
              amenities: fields.array(
                fields.text({ label: 'Amenity' }),
                {
                  label: 'Amenities',
                  itemLabel: props => props.value || 'Amenity',
                }
              ),
              bookingCategory: fields.text({
                label: 'Acuity booking category',
                description: 'Must match the category name exactly in Acuity Scheduling (e.g. "Lounge - Small room").',
                validation: { isRequired: true },
              }),
              body: richTextWithImages('Main content (shown below amenities, before booking)'),
            }),
            link: fields.object({
              externalUrl: fields.text({ label: 'External URL' }),
              intro: richText('Description'),
            }),
            generic: fields.object({
              intro: richText('Introduction'),
              body: richText('Main content'),
            }),
          }
        ),
      },
    }),

    miscPages: collection({
      label: 'Misc pages',
      slugField: 'title',
      path: 'src/content/misc-pages/*',
      format: { data: 'yaml' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        body: richText('Content'),
      },
    }),

    partners: collection({
      label: 'Partners',
      slugField: 'name',
      path: 'src/content/partners/*',
      format: { data: 'yaml' },
      columns: ['image', 'order'],
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        url: fields.text({ label: 'Website URL' }),
        image: fields.image({
          label: 'Logo',
          description: 'Upload a colour logo. PNG with a transparent background is ideal — avoid white backgrounds. If the logo has white text it will disappear on the site. Higher resolution is better. Logos without text work best.',
          directory: 'public/images/partners',
          publicPath: '/images/partners/',
        }),
        order: fields.number({
          label: 'Display order',
          description: 'Lower numbers appear first.',
        }),
      },
    }),

    events: collection({
      label: 'Events',
      slugField: 'title',
      path: 'src/content/events/*',
      format: { data: 'yaml' },
      columns: ['date', 'location'],
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        date: fields.date({ label: 'Date', validation: { isRequired: true } }),
        startTime: fields.text({ label: 'Start time', description: 'e.g. 12pm' }),
        endTime: fields.text({ label: 'End time (optional)', description: 'e.g. 2pm' }),
        location: fields.text({ label: 'Location' }),
        summary: fields.text({
          label: 'Summary',
          multiline: true,
          description: 'Short description shown in listings and on the homepage.',
        }),
        image: fields.image({
          label: 'Hero / poster image',
          description: 'Used as the hero on the event page and as the social media preview image (shown when the link is shared on Facebook, WhatsApp, etc.). Aim for 1200×630px landscape. Keep the file under 1MB - phone photos straight from camera are usually 5–10MB and will be ignored by social platforms.',
          directory: 'public/images/events',
          publicPath: '/images/events/',
        }),
        body: richText('Event details'),
        ctaLabel: fields.text({
          label: 'Button label',
          description: 'e.g. "Volunteer to help" - leave blank to hide the button.',
        }),
        ctaUrl: fields.text({
          label: 'Button URL',
          description: 'Where the button links to (URL or mailto:).',
        }),
      },
    }),

    supporters: collection({
      label: 'With thanks to',
      slugField: 'name',
      path: 'src/content/supporters/*',
      format: { data: 'yaml' },
      columns: ['image', 'order'],
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        url: fields.text({ label: 'Website URL' }),
        image: fields.image({
          label: 'Logo',
          description: 'Upload a colour logo. PNG with a transparent background is ideal — avoid white backgrounds. If the logo has white text it will disappear on the site. Higher resolution is better. Logos without text work best.',
          directory: 'public/images/supporters',
          publicPath: '/images/supporters/',
        }),
        order: fields.number({
          label: 'Display order',
          description: 'Lower numbers appear first.',
        }),
      },
    }),

    projects: collection({
      label: 'Projects & Ideas',
      slugField: 'title',
      path: 'src/content/projects/*',
      format: { data: 'yaml' },
      columns: ['category', 'status'],
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        category: fields.select({
          label: 'Type',
          description: 'Jobs are practical tasks. Bigger projects need funding, expertise or planning. Ideas are early thoughts.',
          options: [
            { label: 'Job — a practical task someone can take on', value: 'job' },
            { label: 'Bigger project — needs funding, expertise or planning', value: 'project' },
            { label: 'Idea — an early thought, not yet a plan', value: 'idea' },
          ],
          defaultValue: 'job',
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Open — looking for people', value: 'open' },
            { label: 'Lead found — someone is coordinating', value: 'lead' },
            { label: 'In progress', value: 'progress' },
            { label: 'Done — completed', value: 'done' },
          ],
          defaultValue: 'open',
        }),
        order: fields.number({
          label: 'Display order',
          description: 'Within its group, lower numbers appear first. Use this to surface priorities.',
          defaultValue: 50,
        }),
        scope: fields.select({
          label: 'Rough effort',
          description: 'Helps people judge what they are signing up for.',
          options: [
            { label: 'Quick win — a couple of hours', value: 'quick' },
            { label: 'Half a day', value: 'half-day' },
            { label: 'A full workday', value: 'day' },
            { label: 'Major — multi-day or specialist', value: 'major' },
            { label: 'Not sure yet', value: 'unknown' },
          ],
          defaultValue: 'unknown',
        }),
        summary: fields.text({
          label: 'Summary',
          multiline: true,
          description: 'One or two sentences shown on the listing. Frame it as an opportunity.',
        }),
        image: fields.image({
          label: 'Main image (optional)',
          description: 'The first image shown on the listing card and project page. Landscape works best. Keep under 1MB.',
          directory: 'public/images/projects',
          publicPath: '/images/projects/',
        }),
        gallery: fields.array(
          fields.image({
            label: 'Image',
            directory: 'public/images/projects',
            publicPath: '/images/projects/',
          }),
          {
            label: 'More images',
            description: 'Extra photos people can flick through on the card and the project page, without opening it.',
            itemLabel: props => props.value || 'Image',
          }
        ),
        body: richTextWithImages('Full description'),
        helpNeeded: fields.array(
          fields.text({ label: 'Item' }),
          {
            label: 'Help, skills or materials needed',
            description: 'e.g. "A plumber", "Concrete and a mixer", "Two people for a morning".',
            itemLabel: props => props.value || 'Item',
          }
        ),
        lead: fields.object(
          {
            name: fields.text({ label: 'Lead name' }),
            contact: fields.text({
              label: 'Lead contact',
              description: 'Email address or mailto: link. Leave blank to use the page default.',
            }),
          },
          { label: 'Project lead (optional)' }
        ),
        completedDate: fields.date({
          label: 'Completed date',
          description: 'Set this when the project is done. Used on the thank-you version of the page.',
        }),
        contributors: fields.array(
          fields.object({
            name: fields.text({ label: 'Name' }),
            business: fields.text({ label: 'Business or organisation (optional)' }),
            url: fields.text({ label: 'Website (optional)' }),
            logo: fields.image({
              label: 'Business logo (optional)',
              description: 'PNG with a transparent background is ideal. Shown in the thank-you strip.',
              directory: 'public/images/projects/contributors',
              publicPath: '/images/projects/contributors/',
            }),
          }),
          {
            label: 'Contributors (shown when the project is done)',
            itemLabel: props => props.fields.name.value || 'Contributor',
          }
        ),
      },
    }),
  },
});

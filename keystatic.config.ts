import { config, collection, singleton, fields } from '@keystatic/core';

const richText = (label: string) =>
  fields.document({
    label,
    formatting: true,
    links: true,
    dividers: true,
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
        heroSubtitle: fields.text({ label: 'Hero subtitle', multiline: true }),
        aboutPreview: richText('About preview text'),
        partnersIntro: fields.text({ label: 'Partners section intro', multiline: true }),
        banners: fields.array(
          fields.object({
            title: fields.text({ label: 'Title' }),
            body: fields.text({ label: 'Body text', multiline: true }),
            link: fields.text({ label: 'Link URL' }),
            linkLabel: fields.text({ label: 'Link label' }),
          }),
          {
            label: 'Banners',
            itemLabel: props => props.fields.title.value || 'Untitled banner',
          }
        ),
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
              body: richText('Main content (shown below amenities, before booking)'),
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
          description: 'Used as the hero on the event page and as the social media preview image (shown when the link is shared on Facebook, WhatsApp, etc.). Aim for 1200×630px landscape. Keep the file under 1MB — phone photos straight from camera are usually 5–10MB and will be ignored by social platforms.',
          directory: 'public/images/events',
          publicPath: '/images/events/',
        }),
        body: richText('Event details'),
        ctaLabel: fields.text({
          label: 'Button label',
          description: 'e.g. "Volunteer to help" — leave blank to hide the button.',
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
          directory: 'public/images/supporters',
          publicPath: '/images/supporters/',
        }),
        order: fields.number({
          label: 'Display order',
          description: 'Lower numbers appear first.',
        }),
      },
    }),
  },
});

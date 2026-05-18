import { config, collection, singleton, fields } from '@keystatic/core';

const richText = (label: string) =>
  fields.document({
    label,
    formatting: true,
    links: true,
    dividers: true,
  });

export default config({
  storage: { kind: 'local' },

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
    facilities: collection({
      label: 'Facilities',
      slugField: 'name',
      path: 'src/content/facilities/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        order: fields.number({
          label: 'Display order',
          description: 'Controls the order facilities appear in listings and navigation. Lower numbers appear first.',
        }),
        shortDescription: fields.text({ label: 'Short description (used in listings)', multiline: true }),
        image: fields.image({
          label: 'Image',
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
                description: 'Must match the category name exactly in Acuity Scheduling',
              }),
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

    pages: collection({
      label: 'Pages',
      slugField: 'title',
      path: 'src/content/content-pages/*',
      format: { data: 'yaml' },
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
  },
});
